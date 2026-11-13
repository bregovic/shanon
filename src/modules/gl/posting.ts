/**
 * Účtování do hlavní knihy. Jediná cesta, jak vzniká gl.voucher + gl.trans.
 * Volají ho deníky, a později i pomocné knihy (odběratelé, dodavatelé,
 * pokladna, majetek) — každá transakce má tak obraz v hlavní knize.
 */
import { runJournal } from "./journal";
import { fromCents, sumCents, toCents } from "@/core/money";
import { UserError, type ValidationErrors, type DataApi, type EventContext, type ObjectHandlers, type RecordData } from "@/core/module";
import { convertCents, rateFor } from "@/modules/sys/currency";
import { activeDimensions, dimsOf, requirementsFor, resolveDims, type Dims } from "./dimensions";

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

/** Název deníku: zadaný, jinak GEN, jinak první nezablokovaný. */
async function resolveJournalName(data: DataApi, id: unknown): Promise<RecordData> {
  if (id) {
    const jn = await data.get("gl.journalName", String(id));
    if (jn) return jn;
  }
  const [gen] = await data.find("gl.journalName", { code: "GEN", blocked: false }, { take: 1 });
  const [first] = gen ? [gen] : await data.find("gl.journalName", { blocked: false }, { take: 1 });
  if (!first) throw new UserError("@GL:MissingJournalName");
  return first;
}

async function assertJournalOpen(data: DataApi, journalId: unknown) {
  const j = journalId ? await data.get("gl.journal", String(journalId)) : null;
  if (j?.status === "posted") throw new UserError("@GL:Locked");
}

/** Výsledek Ověřit / Zaúčtovat pro hlavičku deníku. */
function checkText(ctx: EventContext, r: { vouchers: number; debit: string; credit: string; errors: string[] }) {
  return (r.errors.length ? ctx.t("@GL:CheckErrors", { n: String(r.errors.length), list: r.errors.slice(0, 5).join(" | ") }) : ctx.t("@GL:CheckOk", { n: String(r.vouchers), debit: r.debit, credit: r.credit })).slice(0, 255);
}

/** pole odkazu účtu a protiúčtu podle druhu */
const LINE_REFS: Record<string, { main: string; offset: string }> = {
  ledger: { main: "accountId", offset: "offsetAccountId" },
  customer: { main: "customerId", offset: "offsetCustomerId" },
  vendor: { main: "vendorId", offset: "offsetVendorId" },
  bank: { main: "bankAccountId", offset: "offsetBankAccountId" },
  cash: { main: "cashDeskId", offset: "offsetCashDeskId" },
};

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
  "gl.journal": {
    async beforeSave(ctx, data) {
      const jn = await resolveJournalName(ctx.data, data.journalNameId);
      if (jn.blocked) return { journalNameId: "@GL:JournalNameBlocked" };
      data.journalNameId = jn.id;
    },
    actions: {
      /** Ověřit: rozdělení na doklady, vyrovnanost, účty, období, dimenze — bez účtování */
      async validate(ctx, journal) {
        const r = await runJournal(ctx, journal, true);
        await ctx.data.update("gl.journal", String(journal.id), { checkResult: checkText(ctx, r) });
      },
      async post(ctx, journal) {
        if (journal.status !== "draft") throw new UserError("@GL:Locked");
        const jn = await resolveJournalName(ctx.data, journal.journalNameId);
        if (jn.blocked) throw new UserError("@GL:JournalNameBlocked", { name: String(jn.code) });
        const r = await runJournal(ctx, journal, false);
        await ctx.data.update("gl.journal", String(journal.id), { checkResult: checkText(ctx, r) });
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
      if (isNew) {
        // pořadí řádku, výchozí protiúčet z názvu deníku
        const last = await ctx.data.find("gl.journalLine", { journalId: data.journalId }, { take: 1, orderBy: { lineNum: "desc" } });
        data.lineNum ??= Number(last[0]?.lineNum ?? 0) + 1;
        const jn = journal?.journalNameId ? await ctx.data.get("gl.journalName", String(journal.journalNameId)) : null;
        const defType = (jn?.offsetType as string) || (jn?.offsetAccountId ? "ledger" : null);
        if (!data.offsetType && defType) {
          data.offsetType = defType;
          data.offsetAccountId ??= jn?.offsetAccountId ?? null;
          data.offsetBankAccountId ??= jn?.offsetBankAccountId ?? null;
          data.offsetCashDeskId ??= jn?.offsetCashDeskId ?? null;
        }
      }
      data.accountType ||= "ledger";
      // jen odkaz odpovídající druhu (ostatní vyčistit)
      for (const [kind, f] of Object.entries(LINE_REFS)) if (data.accountType !== kind) data[f.main] = null;
      for (const [kind, f] of Object.entries(LINE_REFS)) if (data.offsetType !== kind) data[f.offset] = null;
      // účet hlavní knihy: kontrola ručního zápisu a dimenzí hned při zadání
      if (data.accountType === "ledger" && data.accountId) {
        const acc = await assertPostable(ctx.data, String(data.accountId), true);
        const dims = dimsOf(data);
        for (const n of [1, 2, 3, 4, 5, 6]) if (!dims[`dim${n}`] && acc[`dim${n}`] && acc[`dim${n}Req`] !== "notAllowed") dims[`dim${n}`] = String(acc[`dim${n}`]);
        Object.assign(data, await resolveDims(ctx.data, acc, dims, { manual: true }));
      }
      if (data.offsetType === "ledger" && data.offsetAccountId) await assertPostable(ctx.data, String(data.offsetAccountId), true);
    },
    beforeDelete: (ctx, data) => assertJournalOpen(ctx.data, data.journalId),
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
    cashMethod: (String(cur?.cashRoundingMethod ?? "nearest") as "nearest" | "up" | "down"),
  };
}
