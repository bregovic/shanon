/**
 * Účtování do hlavní knihy. Jediná cesta, jak vzniká gl.voucher + gl.trans.
 * Volají ho deníky, a později i pomocné knihy (odběratelé, dodavatelé,
 * pokladna, majetek) — každá transakce má tak obraz v hlavní knize.
 */
import { fromCents, sumCents, toCents } from "@/core/money";
import { UserError, type ValidationErrors, type DataApi, type EventContext, type ObjectHandlers, type RecordData } from "@/core/module";
import { convertCents, rateFor } from "@/modules/sys/currency";
import { clearSettlements, lineAmount, linePartner, settleStatusOf } from "./settlement";
import { activeDimensions, defaultDimsOf, dimsOf, LINE_REF_FIELDS, requirementsFor, resolveDims, type Dims } from "./dimensions";

export interface PostingLine {
  accountId: string;
  /** kladná = MD, záporná = D */
  amount: string;
  /** finanční dimenze dim1…dim6 (kontroluje je postVoucher podle účtu) */
  dims?: Dims;
  text?: string | null;
  /** cizí měna řádku (null = účetní měna) a částka v ní */
  currencyId?: string | null;
  amountCur?: string | null;
  /** účet přes pomocnou knihu (odběratel, dodavatel, banka, pokladna) — smí i na účet se zákazem ručního zápisu */
  viaSubledger?: boolean;
}

export interface PostingRequest {
  date: string;
  description?: string | null;
  sourceObject?: string;
  sourceId?: string;
  /** konkrétní řada dokladů (z názvu deníku); jinak řada s Použitím „Účetní doklady“ */
  voucherSeqId?: string | null;
  lines: PostingLine[];
  /** partner dokladu (číslo odběratele / dodavatele) pro dimenzi Partner */
  partner?: string | null;
  /** výchozí dimenze partnera (dodavatel / odběratel) */
  partnerDims?: Record<string, unknown>;
  /** číslo dokladu zadané ručně (deník s ručním číslováním) */
  voucherNum?: string | null;
  /** jen kontroly (Ověřit deník) — nic se nezapíše */
  dryRun?: boolean;
}

/** Kontrola bez přístupu k datům — vyrovnanost a neprázdnost. */
export function checkBalanced(lines: PostingLine[]): void {
  const nonZero = lines.filter((l) => toCents(l.amount) !== BigInt(0));
  if (nonZero.length === 0) throw new UserError("@GL:NoLines");
  const diff = sumCents(nonZero.map((l) => toCents(l.amount)));
  if (diff !== BigInt(0)) throw new UserError("@GL:NotBalanced", { diff: fromCents(diff) });
}

/** Řádky deníku (MD/D) → řádky účtování (znaménková částka). */
export function journalLinesToPosting(lines: RecordData[]): PostingLine[] {
  return lines.map((l, i) => {
    const debit = toCents(l.debit);
    const credit = toCents(l.credit);
    if (debit !== BigInt(0) && credit !== BigInt(0))
      throw new UserError("@GL:LineBothSides", { line: String(i + 1) });
    return {
      accountId: String(l.accountId),
      amount: fromCents(debit - credit),
      dims: dimsOf(l),
      text: (l.text as string) ?? null,
      currencyId: (l.currencyId as string) ?? null,
    };
  });
}

/** Účetní měna firmy jako záznam sys.currency (podle kódu ve firmě). */
/** Parametry hlavní knihy firmy (nebo null, když ještě nejsou). */
export async function ledgerParameters(data: DataApi): Promise<RecordData | null> {
  return (await data.find("gl.parameters", {}, { take: 1 }))[0] ?? null;
}

/** Účetní měna: z parametrů hlavní knihy, jinak měna firmy. */
export async function accountingCurrencyId(data: DataApi, companyId: string | null): Promise<string | null> {
  const p = await ledgerParameters(data);
  if (p?.accountingCurrencyId) return String(p.accountingCurrencyId);
  const company = companyId ? await data.get("sys.company", companyId) : null;
  const [cur] = company ? await data.find("sys.currency", { code: company.currency }, { take: 1 }) : [];
  return cur ? String(cur.id) : null;
}

/** Kurz cizí měny vůči účetní měně firmy podle parametrů hlavní knihy (zdroj, stáří). */
export async function ledgerRate(data: DataApi, companyId: string | null, currencyId: string, date: string) {
  const p = await ledgerParameters(data);
  const baseId = await accountingCurrencyId(data, companyId);
  const base = baseId ? String((await data.get("sys.currency", baseId))?.code ?? "CZK") : "CZK";
  return rateFor(data, currencyId, date, {
    base,
    source: p?.rateSource === "ecb" ? "ecb" : p?.rateSource === "cnb" ? "cnb" : undefined,
    maxAgeDays: p?.rateMaxAgeDays ? Number(p.rateMaxAgeDays) : undefined,
  });
}

/**
 * Cena z jedné měny do druhé (položka v EUR → faktura v CZK i naopak) kurzem
 * k datu přes účetní měnu. Prázdná měna = účetní měna firmy.
 */
export async function convertPrice(data: DataApi, companyId: string | null, price: unknown, fromCur: string | null | undefined, toCur: string | null | undefined, date: string): Promise<string> {
  if (price === null || price === undefined || price === "") return price as string;
  const base = await accountingCurrencyId(data, companyId);
  const f = fromCur || base;
  const t = toCur || base;
  if (f === t) return String(price);
  let cents = toCents(price);
  if (f !== base) {
    const r = await ledgerRate(data, companyId, f!, date);
    cents = convertCents(fromCents(cents), r.rate, r.amount);
  }
  if (t !== base) {
    // účetní měna → cizí: částka × počet jednotek / kurz (zaokrouhleno na haléře)
    const r = await ledgerRate(data, companyId, t!, date);
    const rate = BigInt(Math.round(Number(r.rate) * 1_000_000));
    const num = cents * BigInt(r.amount || 1) * BigInt(1_000_000);
    cents = (num + rate / BigInt(2)) / rate;
  }
  return fromCents(cents);
}

/** Řádky v cizí měně přepočte kurzem k datu; částka v měně zůstane v amountCur. */
export async function convertLines(data: DataApi, companyId: string | null, date: string, lines: PostingLine[]): Promise<PostingLine[]> {
  const base = await accountingCurrencyId(data, companyId);
  const out: PostingLine[] = [];
  for (const l of lines) {
    if (!l.currencyId || l.currencyId === base) {
      out.push({ ...l, currencyId: base, amountCur: l.amountCur ?? l.amount });
      continue;
    }
    const r = await ledgerRate(data, companyId, l.currencyId, date);
    const cur = l.amountCur ?? l.amount;
    out.push({ ...l, amountCur: cur, amount: fromCents(convertCents(cur, r.rate, r.amount)) });
  }
  return out;
}

/** Kontrola duplicitního čísla podle nastavení (přijmout / varovat / odmítnout / odmítnout ve stejném roce). */
export async function checkDuplicate(data: DataApi, mode: unknown, found: RecordData[], date: string | null, dateField: string, label: string, params: Record<string, string>): Promise<void> {
  const m = String(mode ?? "reject");
  if (m === "accept" || !found.length) return;
  const year = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 4);
  const hits = m === "rejectYear" && date ? found.filter((r) => year(r[dateField]) === date.slice(0, 4)) : found;
  if (!hits.length) return;
  if (m === "warn") data.warn?.(`${label}Warn`, params);
  else throw new UserError(label, params);
}

async function checkVoucherDuplicate(data: DataApi, voucherNum: string, date: string) {
  const p = await ledgerParameters(data);
  const found = await data.find("gl.voucher", { voucherNum }, { take: 20 });
  await checkDuplicate(data, p?.voucherDupCheck, found, date, "date", "@GL:VoucherDuplicate", { num: voucherNum });
}

/** Datum musí patřit do otevřeného účetního období. */
export async function assertOpenPeriod(data: DataApi, date: string): Promise<void> {
  const [p] = await data.find("gl.period", { startDate: { lte: date }, endDate: { gte: date } }, { take: 1 });
  if (!p) throw new UserError("@GL:NoPeriod", { date });
  if (p.status !== "open") throw new UserError("@GL:PeriodClosed", { period: String(p.code) });
}

/** Vytvoří měsíční období fiskálního roku (pokud žádná nemá). */
export async function createPeriods(data: DataApi, fy: RecordData): Promise<number> {
  if ((await data.find("gl.period", { fiscalYearId: fy.id }, { take: 1 })).length) throw new UserError("@GL:PeriodsExist");
  let n = 0;
  let d = new Date(`${fy.startDate}T00:00:00Z`);
  const end = new Date(`${fy.endDate}T00:00:00Z`);
  while (d <= end) {
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const to = last < end ? last : end;
    const code = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    await data.create("gl.period", {
      fiscalYearId: fy.id,
      code,
      startDate: d.toISOString().slice(0, 10),
      endDate: to.toISOString().slice(0, 10),
      status: "open",
    });
    n++;
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return n;
}

/**
 * Účet musí být účtovatelný: nezablokovaný, bez analytiky (jinak na ni),
 * a u ručního zápisu (deník) bez zákazu ručního zápisu.
 */
export async function assertPostable(data: DataApi, accountId: string, manual: boolean): Promise<RecordData> {
  const acc = await data.get("gl.account", accountId);
  if (!acc) throw new UserError("@SYS:InvalidValue");
  const account = `${acc.accountNum} ${acc.name}`;
  if (acc.blocked) throw new UserError("@GL:AccountBlocked", { account: String(acc.accountNum) });
  if (manual && acc.noManualEntry) throw new UserError("@GL:ManualEntryDenied", { account });
  return acc;
}

export async function postVoucher(data: DataApi, req: PostingRequest): Promise<RecordData> {
  checkBalanced(req.lines);
  await assertOpenPeriod(data, req.date);
  // ruční zápis = účetní deník; doklady modulů (faktury, banka, pokladna) smí i na saldokonto
  const manual = req.sourceObject === "gl.journal";
  const accounts = new Map<string, RecordData>();
  for (const l of req.lines) {
    // ruční řádek na saldokonto/banku/pokladnu jen přes pomocnou knihu (druh účtu odběratel, banka…)
    const strict = manual && !l.viaSubledger;
    const acc = await assertPostable(data, l.accountId, strict);
    if (!accounts.has(l.accountId)) accounts.set(l.accountId, acc);
  }
  // dimenze podle nastavení účtu (partner z dokladu se doplní sám)
  const defs = await activeDimensions(data);
  // výchozí hodnoty: řádek → partner → účet (jen kde účet dimenzi nezakazuje)
  const withDefaults = (l: PostingLine) => {
    const acc = accounts.get(l.accountId)!;
    const out: Record<string, string | null> = { ...((l.dims ?? {}) as Record<string, string | null>) };
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const f = `dim${n}`;
      if (out[f] || acc[`dim${n}Req`] === "notAllowed") continue;
      const v = req.partnerDims?.[f] || acc[f];
      if (v) out[f] = String(v);
    }
    return out;
  };
  const dims = await Promise.all(req.lines.map((l) => resolveDims(data, accounts.get(l.accountId)!, withDefaults(l), { manual, partner: req.partner, defs })));
  // ručně zadané číslo dokladu, které už v účetnictví je (Parametry HK → Kontroly; opravné deníky)
  if (req.voucherNum) await checkVoucherDuplicate(data, String(req.voucherNum), req.date);
  if (req.dryRun) return {} as RecordData;
  const voucher = await data.create("gl.voucher", {
    // ruční číslo, jinak řada deníku, jinak datová služba podle Použití (gl.voucher)
    voucherNum: req.voucherNum || (req.voucherSeqId ? await data.nextNumber({ id: req.voucherSeqId }, new Date(req.date)) : null),
    date: req.date,
    description: req.description ?? null,
    sourceObject: req.sourceObject ?? null,
    sourceId: req.sourceId ?? null,
  });
  for (const [i, l] of req.lines.entries()) {
    if (toCents(l.amount) === BigInt(0)) continue;
    await data.create("gl.trans", {
      ...dims[i],
      voucherId: voucher.id,
      date: req.date,
      accountId: l.accountId,
      amount: l.amount,
      currencyId: l.currencyId ?? null,
      amountCur: l.amountCur ?? null,
      text: l.text ?? req.description ?? null,
    });
  }
  return voucher;
}

/** Název deníku: zadaný, jinak první daného druhu (deníky banky, pokladny…), jinak GEN, jinak první nezablokovaný. */
export async function resolveJournalName(data: DataApi, id: unknown, journalType?: unknown): Promise<RecordData> {
  if (id) {
    const jn = await data.get("gl.journalName", String(id));
    if (jn) return jn;
  }
  if (journalType) {
    const [typed] = await data.find("gl.journalName", { journalType: String(journalType), blocked: false }, { take: 1, orderBy: { code: "asc" } });
    if (typed) return typed;
  }
  const [gen] = await data.find("gl.journalName", { code: "GEN", blocked: false }, { take: 1 });
  const [first] = gen ? [gen] : await data.find("gl.journalName", { blocked: false }, { take: 1 });
  if (!first) throw new UserError("@GL:MissingJournalName");
  return first;
}

const voucherSeq = (jn: RecordData) => ({ id: (jn.voucherSeqId as string) || undefined, usedFor: "gl.voucher", code: "GLVOUCHER" });
const OFFSET_REFS = ["offsetAccountId", "offsetCustomerId", "offsetVendorId", "offsetBankAccountId", "offsetCashDeskId"];
// řádek s vyplněným protiúčtem je vyrovnaný sám
const lineDiff = (l: RecordData) => (OFFSET_REFS.some((f) => l[f]) ? BigInt(0) : toCents(l.debit ?? 0) - toCents(l.credit ?? 0) + toCents(l.taxExtra ?? 0));

/**
 * Číslo dokladu pro nový řádek deníku podle číslování názvu deníku (jako v AX):
 * po vyrovnání = číslo předchozího řádku, dokud jeho doklad není vyrovnaný;
 * jeden za deník = číslo prvního řádku; řádek = vždy nové; ručně = nic.
 */
export async function allocateVoucher(data: DataApi, journal: RecordData, jn: RecordData, line: RecordData, before?: RecordData[]): Promise<string | null> {
  const mode = String(jn.voucherAllocation ?? "balance");
  if (mode === "manual") return null;
  const date = new Date(String(line.date ?? journal.date ?? new Date().toISOString().slice(0, 10)));
  if (mode === "line") return data.nextNumber(voucherSeq(jn), date);
  // jen poslední doklad (ne celý deník — u stovek řádků by každý nový řádek četl všechny)
  let last: RecordData | undefined;
  let group: RecordData[] = [];
  if (before) {
    const prev = before.filter((l) => l.id !== line.id && l.voucherNum);
    last = mode === "journal" ? prev[0] : prev[prev.length - 1];
    group = last ? prev.filter((l) => l.voucherNum === last!.voucherNum) : [];
  } else {
    const ordered = await data.find("gl.journalLine", { journalId: journal.id }, { take: 50, orderBy: { lineNum: mode === "journal" ? "asc" : "desc" } });
    last = ordered.find((l) => l.id !== line.id && l.voucherNum);
    if (last && mode === "balance") group = (await data.find("gl.journalLine", { journalId: journal.id, voucherNum: last.voucherNum }, { take: 5000 })).filter((l) => l.id !== line.id);
  }
  if (mode === "journal") return last ? String(last.voucherNum) : data.nextNumber(voucherSeq(jn), date);
  if (last && group.reduce((a, l) => a + lineDiff(l), BigInt(0)) !== BigInt(0)) return String(last.voucherNum);
  return data.nextNumber(voucherSeq(jn), date);
}

async function assertJournalOpen(data: DataApi, journalId: unknown) {
  const j = journalId ? await data.get("gl.journal", String(journalId)) : null;
  if (j?.status === "posted") throw new UserError("@GL:Locked");
}

/** Výsledek Ověřit / Zaúčtovat pro hlavičku deníku. */
export function checkText(ctx: EventContext, r: { vouchers: number; debit: string; credit: string; errors: string[] }) {
  return (r.errors.length ? ctx.t("@GL:CheckErrors", { n: String(r.errors.length), list: r.errors.slice(0, 5).join(" | ") }) : ctx.t("@GL:CheckOk", { n: String(r.vouchers), debit: r.debit, credit: r.credit })).slice(0, 255);
}

const LINE_REFS = LINE_REF_FIELDS;

/**
 * Výchozí dimenze řádku deníku (prázdná pole, nebo ta, která měla výchozí hodnotu předchozího účtu):
 * účet = řádek → účet / partner → hlavička deníku; protiúčet = řádek → protiúčet / partner → dimenze účtu.
 */
async function applyDefaultDims(data: DataApi, line: RecordData, journal: RecordData | null, isNew: boolean) {
  const ref = (r: RecordData, side: "main" | "offset") => {
    const t = String((side === "main" ? r.accountType : r.offsetType) ?? "");
    const f = LINE_REFS[t]?.[side];
    return { t, id: f ? (r[f] as string | null) : null };
  };
  const old = !isNew && line.id ? await data.get("gl.journalLine", String(line.id)) : null;
  const m = ref(line, "main");
  const o = ref(line, "offset");
  const om = old ? ref(old, "main") : null;
  const oo = old ? ref(old, "offset") : null;
  const mainChanged = !!om && (om.t !== m.t || om.id !== m.id);
  const offChanged = !!oo && (oo.t !== o.t || oo.id !== o.id);
  const def = await defaultDimsOf(data, m.t, m.id);
  const oldDef = mainChanged && om ? await defaultDimsOf(data, om.t, om.id) : null;
  const head = journal ? dimsOf(journal) : {};
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const f = `dim${n}`;
    const cur = (line[f] as string) || null;
    // změna účtu: hodnota, kterou dal předchozí účet, nahradí výchozí nového
    const stale = !!cur && !!oldDef && cur === oldDef.dims[f];
    // účet dimenzi zakazuje: výchozí hodnotu nedávat (ručně zadanou odmítne kontrola dimenzí)
    if (def.notAllowed.has(f)) {
      if (stale) line[f] = null;
    } else if (!cur || stale) line[f] = def.dims[f] ?? head[f] ?? (stale ? null : cur);
  }
  if (!o.id) return;
  const odef = await defaultDimsOf(data, o.t, o.id);
  const oldOdef = offChanged && oo ? await defaultDimsOf(data, oo.t, oo.id) : null;
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const f = `offsetDim${n}`;
    const mf = `dim${n}`;
    const cur = (line[f] as string) || null;
    // protiúčet drží dimenzi účtu, dokud ji uživatel nezmění; změna protiúčtu = jeho výchozí
    const followsMain = !!cur && !!old && cur === ((old[mf] as string) || null) && line[mf] !== old[mf];
    const stale = !!cur && ((!!oldOdef && cur === oldOdef.dims[mf]) || followsMain);
    if (odef.notAllowed.has(mf)) {
      if (!cur || stale) line[f] = null;
    } else if (!cur || stale) line[f] = odef.dims[mf] ?? ((line[mf] as string) || null);
  }
}

export const glHandlers: Record<string, ObjectHandlers> = {
  "gl.fiscalYear": {
    beforeSave(_ctx, data) {
      if (data.startDate && data.endDate && String(data.endDate) < String(data.startDate)) return { endDate: "@SYS:InvalidDate" };
    },
    actions: {
      async periods(ctx, fy) {
        await createPeriods(ctx.data, fy);
      },
    },
  },
  "gl.parameters": {
    async beforeSave(ctx, data, isNew): Promise<ValidationErrors | void> {
      if (isNew && (await ctx.data.find("gl.parameters", {}, { take: 1 })).length) throw new UserError("@GL:OneParameters");
      if (!isNew) {
        // účetní měnu nejde změnit, když už jsou zápisy
        const before = await ledgerParameters(ctx.data);
        if (before && before.accountingCurrencyId !== data.accountingCurrencyId && (await ctx.data.find("gl.trans", {}, { take: 1 })).length)
          return { accountingCurrencyId: "@GL:CurrencyLocked" };
      }
    },
    async afterSave(ctx, data) {
      // měna firmy = účetní měna (přepínač firem, výchozí měna dokladů)
      const cur = await ctx.data.get("sys.currency", String(data.accountingCurrencyId));
      if (ctx.companyId && cur) await ctx.data.update("sys.company", ctx.companyId, { currency: cur.code });
    },
  },
  "gl.account": {
    async beforeSave(ctx, data): Promise<ValidationErrors | void> {
      let num = String(data.accountNum ?? "");
      if (/^\d{3}$/.test(num)) num = data.accountNum = `${num}000`;
      if (!/^\d{6}$/.test(num)) return;
      data.synthetic = num.slice(0, 3);
      data.accountClass = Number(num[0]);
      Object.assign(data, await requirementsFor(ctx.data, num));
      // nový účet stejné syntetiky převezme typ a druh od existujícího
      if (!data.type || !data.postingType) {
        const [sib] = (await ctx.data.find("gl.account", { synthetic: data.synthetic }, { take: 5, orderBy: { accountNum: "asc" } })).filter((a) => a.id !== data.id);
        if (sib && !data.type) data.type = sib.type;
        if (sib && !data.postingType && data.postingType !== null) data.postingType = sib.postingType ?? null;
      }
      if (!data.type) {
        const byClass: Record<string, string> = { "5": "expense", "6": "revenue", "7": "equity" };
        data.type = byClass[num[0]] ?? null;
        if (!data.type) return { type: "@SYS:Required" };
      }
    },
  },
  "gl.journalLine": {
    async beforeSave(ctx, data, isNew) {
      const journal = data.journalId ? await ctx.data.get("gl.journal", String(data.journalId)) : null;
      if (journal?.status === "posted") throw new UserError("@GL:Locked");
      // záporná částka = druhá strana (−100 v MD → 100 v D)
      for (const [a, b] of [["debit", "credit"], ["credit", "debit"]] as const) {
        if (data[a] !== null && data[a] !== undefined && data[a] !== "" && toCents(data[a]) < BigInt(0)) {
          data[b] = fromCents(-toCents(data[a]));
          data[a] = null;
        }
      }
      if (isNew) {
        // pořadí řádku, výchozí protiúčet z názvu deníku
        const last = await ctx.data.find("gl.journalLine", { journalId: data.journalId }, { take: 1, orderBy: { lineNum: "desc" } });
        data.lineNum ??= Number(last[0]?.lineNum ?? 0) + 1;
        // datum jako předchozí řádek, jinak datum deníku
        data.date ??= last[0]?.date ?? journal?.date ?? null;
        const jn = journal?.journalNameId ? await ctx.data.get("gl.journalName", String(journal.journalNameId)) : null;
        // číslo dokladu hned (vidět, co k čemu patří a jestli je doklad vyrovnaný)
        if (journal && jn && !data.voucherNum) data.voucherNum = await allocateVoucher(ctx.data, journal, jn, data);
        // výchozí protiúčet z hlavičky deníku (ta ho má z názvu deníku); starší deníky přímo z názvu
        const src = journal?.offsetType ? journal : jn;
        const defType = (src?.offsetType as string) || (src?.offsetAccountId ? "ledger" : null);
        // ne stejného druhu jako účet řádku (řádek výpisu = banka, protiúčet banka nedává smysl)
        if (defType && !((defType === "bank" || defType === "cash") && defType === data.accountType) && (!data.offsetType || !OFFSET_REFS.some((f) => data[f]))) {
          data.offsetType = defType;
          const f = LINE_REFS[defType]?.offset;
          if (f) data[f] ??= src?.[f] ?? null;
          // jediný bankovní účet / pokladna firmy = protiúčet sám
          if ((defType === "bank" || defType === "cash") && f && !data[f]) {
            const obj = defType === "bank" ? "bank.account" : "cash.desk";
            try {
              const all = await ctx.data.find(obj, { blocked: false }, { take: 2 });
              if (all.length === 1) data[f] = all[0].id;
            } catch {
              // modul vypnutý
            }
          }
        }
      }
      data.accountType ||= "ledger";
      // jen odkaz odpovídající druhu (ostatní vyčistit)
      for (const [kind, f] of Object.entries(LINE_REFS)) if (data.accountType !== kind) data[f.main] = null;
      for (const [kind, f] of Object.entries(LINE_REFS)) if (data.offsetType !== kind) data[f.offset] = null;
      await applyDefaultDims(ctx.data, data, journal, isNew);
      // účet hlavní knihy: kontrola ručního zápisu a dimenzí hned při zadání
      if (data.accountType === "ledger" && data.accountId) {
        const acc = await assertPostable(ctx.data, String(data.accountId), true);
        Object.assign(data, await resolveDims(ctx.data, acc, dimsOf(data), { manual: true }));
      }
      if (data.offsetType === "ledger" && data.offsetAccountId) await assertPostable(ctx.data, String(data.offsetAccountId), true);
      // vyrovnání: jiný partner = vyrovnání pryč; stav podle částky řádku
      if (!isNew && data.id) {
        const before = await ctx.data.get("gl.journalLine", String(data.id));
        const a = before ? linePartner(before) : null;
        const b = linePartner(data);
        if (a && (!b || a.kind !== b.kind || a.id !== b.id)) {
          await clearSettlements(ctx.data, String(data.id));
          data.settleStatus = "none";
        } else if (a) {
          const list = await ctx.data.find("gl.journalSettlement", { journalLineId: data.id }, { take: 500 });
          // po zaúčtování zůstane Vyrovnáno
          if (list.length && data.settleStatus !== "settled") data.settleStatus = settleStatusOf(lineAmount(data), list.reduce((x, y) => x + toCents(String(y.amount ?? 0)), BigInt(0)));
        }
      }
    },
    async beforeDelete(ctx, data) {
      await assertJournalOpen(ctx.data, data.journalId);
      await clearSettlements(ctx.data, String(data.id));
    },
  },
};

/** Účet pro automatickou transakci (Hlavní kniha → Systémové účty). */
export async function systemAccount(data: DataApi, type: string): Promise<string> {
  const [row] = await data.find("gl.systemAccount", { postingType: type }, { take: 1 });
  if (!row?.accountId) throw new UserError("@GL:SystemAccountMissing", { type: `@GL:Sp${type[0].toUpperCase()}${type.slice(1)}` });
  return String(row.accountId);
}

/** Zaokrouhlení měny (obecné a hotovosti); bez měny haléře / beze změny. */
export async function currencyRounding(data: DataApi, currencyId: string | null) {
  const cur = currencyId ? await data.get("sys.currency", currencyId) : null;
  return {
    unit: String(cur?.roundingUnit ?? "0.01"),
    cashUnit: String(cur?.cashRoundingUnit ?? "0.01"),
    invoiceUnit: String(cur?.invoiceRoundingUnit ?? "0.01"),
    cashMethod: (String(cur?.cashRoundingMethod ?? "nearest") as "nearest" | "up" | "down"),
  };
}
