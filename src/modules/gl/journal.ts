/**
 * Deníky (obdoba General journal v AX): řádky s druhem účtu a protiúčtu,
 * rozdělení na doklady podle nastavení názvu deníku, Ověřit (bez účtování)
 * a Zaúčtovat. Jeden standard pro obecný, platební, pokladní i bankovní deník.
 *
 * Druh účtu → účet hlavní knihy:
 *   hlavní kniha = účet řádku; odběratel / dodavatel = saldokontní účet skupiny
 *   partnera (a zápis do salda, platba podle VS se spáruje s fakturou);
 *   banka = účet hlavní knihy bankovního účtu; pokladna = účet pokladny.
 */
import { lineTax, taxOnMain, taxTransParts } from "@/modules/tax/tax-groups";
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type EventContext, type ObjectHandlers, type RecordData } from "@/core/module";
import { allocateVoucher, checkText, convertLines, postVoucher, resolveJournalName, type PostingLine } from "./posting";
import { dimsOf, offsetDimsOf } from "./dimensions";
import { applySettlements, checkSettlements, linePartner, settleRef, settlementsOf } from "./settlement";
import { advanceAccount, recordAdvancePayment } from "@/modules/tax/orders";
import { activateScheduleByPayment, agreementAdvancePaid, agreementInvoicePaid, recordAgreementPayment } from "@/modules/tax/agreements";

const zero = BigInt(0);

type Kind = "ledger" | "customer" | "vendor" | "bank" | "cash";

/** pole odkazu podle druhu (účet / protiúčet) */
const REF: Record<Kind, { main: string; offset: string }> = {
  ledger: { main: "accountId", offset: "offsetAccountId" },
  customer: { main: "customerId", offset: "offsetCustomerId" },
  vendor: { main: "vendorId", offset: "offsetVendorId" },
  bank: { main: "bankAccountId", offset: "offsetBankAccountId" },
  cash: { main: "cashDeskId", offset: "offsetCashDeskId" },
};

interface Leg {
  line: RecordData;
  lineNo: number;
  accountId: string;
  /** v účetní měně (přepočteno kurzem k datu řádku) */
  amount: bigint;
  /** cizí měna řádku a částka v ní */
  currencyId: string | null;
  amountCur: string | null;
  viaSubledger: boolean;
  partner: { kind: "customer" | "vendor"; rec: RecordData } | null;
  /** dimenze strany (protiúčet může mít vlastní) */
  dims?: ReturnType<typeof dimsOf>;
  /** daňové transakce řádku (modul DPH), vzniknou po zaúčtování dokladu */
  taxes?: Record<string, unknown>[];
}

/** Účet hlavní knihy pro druh a odkaz (plus partner pro saldo). */
async function resolveLeg(data: DataApi, kind: Kind, refId: string | null): Promise<Omit<Leg, "line" | "lineNo" | "amount" | "currencyId" | "amountCur"> | null> {
  if (!refId) return null;
  switch (kind) {
    case "ledger":
      return { accountId: refId, viaSubledger: false, partner: null };
    case "customer":
    case "vendor": {
      const obj = kind === "customer" ? "ar.customer" : "ap.vendor";
      const rec = await data.get(obj, refId);
      if (!rec) return null;
      const group = await data.get(kind === "customer" ? "ar.group" : "ap.group", String(rec.groupId));
      const acc = group?.[kind === "customer" ? "receivableAccountId" : "payableAccountId"];
      if (!acc) throw new UserError("@SYS:InvalidValue");
      return { accountId: String(acc), viaSubledger: true, partner: { kind, rec } };
    }
    case "bank": {
      const b = await data.get("bank.account", refId);
      return b ? { accountId: String(b.glAccountId), viaSubledger: true, partner: null } : null;
    }
    case "cash": {
      const c = await data.get("cash.desk", refId);
      return c ? { accountId: String(c.accountId), viaSubledger: true, partner: null } : null;
    }
  }
}

interface Group {
  key: string;
  manualNum: string | null;
  date: string;
  legs: Leg[];
}

/** Rozdělení řádků deníku na doklady podle číslování v názvu deníku. */
export async function planJournal(data: DataApi, journal: RecordData, companyId: string | null) {
  const jn = journal.journalNameId ? await data.get("gl.journalName", String(journal.journalNameId)) : null;
  const mode = String(jn?.voucherAllocation ?? "balance");
  const lines = await data.find("gl.journalLine", { journalId: journal.id }, { take: 5000, orderBy: { lineNum: "asc" } });
  // řádky bez čísla dokladu (starší deníky, import) dostanou číslo stejně jako při zadání
  if (jn && mode !== "manual") {
    for (const [i, l] of lines.entries()) {
      if (l.voucherNum) continue;
      const num = await allocateVoucher(data, journal, jn, l, lines.slice(0, i));
      if (num) {
        l.voucherNum = num;
        await data.update("gl.journalLine", String(l.id), { voucherNum: num });
      }
    }
  }
  const errors: { ref: string; params?: Record<string, string>; prefix?: string }[] = [];
  if (!lines.length) errors.push({ ref: "@GL:JournalEmpty" });
  const legsByLine: Leg[][] = [];
  // vyrovnání řádků s otevřenými položkami salda (dialog Vyrovnat) – jednou za deník
  const settles = await settlementsOf(data, String(journal.id));
  for (const [i, l] of lines.entries()) {
    const n = Number(l.lineNum ?? i + 1);
    errors.push(...(await checkSettlements(data, l, settles.get(String(l.id)) ?? [], n)));
    const debit = toCents(l.debit ?? 0);
    const credit = toCents(l.credit ?? 0);
    if (debit !== zero && credit !== zero) errors.push({ ref: "@GL:LineBothSides", params: { line: String(n) } });
    // cizí měna: přepočet kurzem k datu řádku už tady (vyrovnanost dokladu v účetní měně)
    let amount = debit - credit;
    let amountCur: string | null = null;
    const currencyId = (l.currencyId as string) ?? null;
    if (currencyId) {
      try {
        const [c] = await convertLines(data, companyId, String(l.date ?? journal.date), [{ accountId: "-", amount: fromCents(amount), currencyId }]);
        amountCur = c.amountCur ?? null;
        amount = toCents(c.amount);
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        errors.push({ ref: e.label, params: e.params });
      }
    }
    const neg = (v: string | null) => (v === null ? null : fromCents(-toCents(v)));
    const kind = String(l.accountType ?? "ledger") as Kind;
    const main = await resolveLeg(data, kind, (l[REF[kind]?.main] as string) ?? null);
    if (!main) {
      errors.push({ ref: "@GL:LineAccountMissing", params: { line: String(n) } });
      legsByLine.push([]);
      continue;
    }
    const legs: Leg[] = [{ ...main, line: l, lineNo: n, amount, currencyId, amountCur }];
    // protiúčet jen když je vyplněný (druh má výchozí Hlavní kniha)
    if (l.offsetType && l[REF[String(l.offsetType) as Kind]?.offset]) {
      const ok = String(l.offsetType) as Kind;
      const off = await resolveLeg(data, ok, (l[REF[ok]?.offset] as string) ?? null);
      if (!off) errors.push({ ref: "@GL:LineAccountMissing", params: { line: String(n) } });
      else legs.push({ ...off, line: l, lineNo: n, amount: -amount, currencyId, amountCur: neg(amountCur), dims: offsetDimsOf(l) });
    }
    // vyrovnání se zálohou: strana partnera na účet záloh (324 / 314), jako úhrada zálohy z výpisu
    const advSettle = (settles.get(String(l.id)) ?? []).find((x) => x.settleKind === "advance");
    if (advSettle)
      for (const x of legs)
        if (x.partner && x.partner.kind === advSettle.partnerType) x.accountId = await advanceAccount(data, x.partner.kind, settleRef(advSettle));
    // úhrada s VS otevřené faktury partnera: účet salda, na kterém faktura vznikla (účtovací profil, např. dar 379)
    if (l.vs && !advSettle) {
      for (const x of legs) {
        if (!x.partner) continue;
        const obj = x.partner.kind === "customer" ? "ar.trans" : "ap.trans";
        const field = x.partner.kind === "customer" ? "customerId" : "vendorId";
        const [tr] = await data.find(obj, { [field]: x.partner.rec.id, kind: "invoice", vs: l.vs, closed: false }, { take: 1 });
        if (tr?.accountId) x.accountId = String(tr.accountId);
      }
    }
    // DPH: základ na straně účtu hlavní knihy, řádek daně (u samovyměření MD i D), protistrana s daní
    if (l.taxCodeId) {
      let code: RecordData | null = null;
      try {
        code = await data.get("tax.taxCode", String(l.taxCodeId));
      } catch {
        code = null; // modul DPH vypnutý
      }
      if (code) {
        const ti = !taxOnMain(l) && legs.length > 1 ? 1 : 0;
        const side = legs[ti];
        const a = side.amount;
        const t = lineTax(code, a, !!jn?.amountsIncludeTax);
        const aCur = side.amountCur !== null ? toCents(side.amountCur) : null;
        const tc = aCur !== null ? lineTax(code, aCur, !!jn?.amountsIncludeTax) : null;
        side.amount = t.base;
        if (tc) side.amountCur = fromCents(tc.base);
        const other = legs[1 - ti];
        if (legs.length > 1 && other) {
          other.amount = -(a + t.extra);
          if (tc && aCur !== null && other.amountCur !== null) other.amountCur = fromCents(-(aCur + tc.extra));
        }
        const taxLeg = (accountId: unknown, amt: bigint, cur: bigint | null): Leg => ({
          accountId: String(accountId),
          viaSubledger: true, // automatický řádek daně (účet DPH má zákaz ručního zápisu)
          partner: null,
          line: l,
          lineNo: n,
          amount: amt,
          currencyId,
          amountCur: cur === null ? null : fromCents(cur),
          dims: {},
        });
        if (t.tax !== zero) {
          legs.push(taxLeg(code.accountId, t.tax, tc ? tc.tax : null));
          if (code.reverseCharge) legs.push(taxLeg(code.outputAccountId ?? code.accountId, -t.tax, tc ? -tc.tax : null));
        }
        // daňové transakce: základ a daň kladné pro běžný doklad (výstup = výnos v D, vstup = náklad v MD)
        const sign = code.direction === "output" && !code.reverseCharge ? BigInt(-1) : BigInt(1);
        legs[0].taxes = taxTransParts(code, fromCents(sign * t.base), fromCents(sign * t.tax)).map((x) => ({
          ...x,
          taxDate: String(l.date ?? journal.date),
          documentNum: (l.taxDocNum as string) || null,
          currencyId,
          baseCur: tc ? fromCents(sign * tc.base) : null,
          taxCur: tc ? fromCents(sign * tc.tax) : null,
        }));
      }
    }
    legsByLine.push(legs);
  }

  // doklady
  const groups: Group[] = [];
  const dateOf = (l: RecordData) => String(l.date ?? journal.date);
  const open = (key: string, l: RecordData, manualNum: string | null = null): Group => {
    const g = { key, manualNum, date: dateOf(l), legs: [] as Leg[] };
    groups.push(g);
    return g;
  };
  if (jn && lines.every((l) => l.voucherNum)) {
    // čísla dokladů jsou na řádcích (přidělená při zadání, nebo ručně)
    const byNum = new Map<string, Group>();
    for (const [i, legs] of legsByLine.entries()) {
      const num = String(lines[i].voucherNum);
      const g = byNum.get(num) ?? open(`N${num}`, lines[i], num);
      byNum.set(num, g);
      g.legs.push(...legs);
    }
  } else if (mode === "journal") {
    const g = lines.length ? open("J", lines[0]) : null;
    for (const legs of legsByLine) g?.legs.push(...legs);
  } else if (mode === "line") {
    for (const [i, legs] of legsByLine.entries()) {
      if (!legs.length) continue;
      if (legs.length < 2) errors.push({ ref: "@GL:LineNotBalanced", params: { line: String(legs[0].lineNo) } });
      open(`L${i}`, lines[i]).legs.push(...legs);
    }
  } else if (mode === "manual") {
    const byNum = new Map<string, Group>();
    for (const [i, legs] of legsByLine.entries()) {
      const num = String(lines[i].voucherNum ?? "").trim();
      if (!num) {
        errors.push({ ref: "@GL:VoucherNumMissing", params: { line: String(lines[i].lineNum ?? i + 1) } });
        continue;
      }
      const g = byNum.get(num) ?? open(`M${num}`, lines[i], num);
      byNum.set(num, g);
      g.legs.push(...legs);
    }
  } else {
    // nový doklad vždy, když jsou dosavadní řádky vyrovnané
    let g: Group | null = null;
    let sum = zero;
    for (const [i, legs] of legsByLine.entries()) {
      if (!legs.length) continue;
      if (!g) g = open(`B${groups.length}`, lines[i]);
      g.legs.push(...legs);
      sum += legs.reduce((a, x) => a + x.amount, zero);
      if (sum === zero) g = null;
    }
  }
  for (const [k, g] of groups.entries()) {
    const label = g.manualNum ?? String(k + 1);
    const diff = g.legs.reduce((a, x) => a + x.amount, zero);
    if (diff !== zero) errors.push({ ref: "@GL:NotBalanced", params: { diff: fromCents(diff) }, prefix: label });
    if (new Set(g.legs.map((x) => dateOf(x.line))).size > 1) errors.push({ ref: "@GL:VoucherDates", params: { voucher: label } });
  }
  return { jn, groups, errors, lines, settles };
}

function postingLines(g: Group): PostingLine[] {
  return g.legs.map((x) => ({
    accountId: x.accountId,
    amount: fromCents(x.amount),
    text: (x.line.text as string) ?? null,
    dims: x.dims ?? dimsOf(x.line),
    currencyId: x.currencyId,
    amountCur: x.amountCur,
    viaSubledger: x.viaSubledger,
  }));
}

/**
 * Ověřit (`dryRun`) nebo zaúčtovat deník. Vrací počet dokladů a součty;
 * chyby: při ověření seznam, při účtování první chyba jako výjimka.
 */
/**
 * Čtení číselníků, které účtování nemění (účty, období, dimenze, měny, partneři),
 * jednou za běh deníku — stovky dokladů by je jinak četly pořád dokola.
 */
const STATIC = new Set(["gl.account", "gl.period", "gl.dimension", "gl.dimensionValue", "gl.dimensionRule", "gl.parameters", "sys.currency", "sys.company", "ar.customer", "ap.vendor", "ar.group", "ap.group", "bank.account", "cash.desk", "gl.systemAccount"]);
export function cachedReads(data: DataApi): DataApi {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, fn: () => Promise<T>) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key) as Promise<T>;
  };
  return {
    ...data,
    get: (o, id) => (STATIC.has(o) ? once(`g:${o}:${id}`, () => data.get(o, id)) : data.get(o, id)),
    find: (o, where, opts) => (STATIC.has(o) ? once(`f:${o}:${JSON.stringify(where)}:${JSON.stringify(opts ?? {})}`, () => data.find(o, where, opts)) : data.find(o, where, opts)),
  };
}

export async function runJournal(ctx: EventContext, journal: RecordData, dryRun: boolean) {
  const data = cachedReads(ctx.data);
  const plan = await planJournal(data, journal, ctx.companyId);
  // chyby: pro Ověřit text, pro Zaúčtovat první chyba jako výjimka (původní hláška)
  const raw: { ref: string; params?: Record<string, string>; prefix?: string }[] = [...plan.errors];
  let debit = zero;
  let credit = zero;
  for (const g of plan.groups)
    for (const x of g.legs) {
      if (x.amount > zero) debit += x.amount;
      else credit -= x.amount;
    }

  // Ověřit: každý doklad nanečisto (účty, období, dimenze). Zaúčtovat to nepotřebuje —
  // běží v jedné transakci, první chyba vrátí všechno zpět.
  if (!raw.length && dryRun) {
    for (const [k, g] of plan.groups.entries()) {
      try {
        const lines = await convertLines(data, ctx.companyId, g.date, postingLines(g));
        await postVoucher(data, {
          date: g.date,
          description: (journal.description as string) ?? null,
          sourceObject: "gl.journal",
          sourceId: String(journal.id),
          voucherSeqId: (plan.jn?.voucherSeqId as string) ?? null,
          voucherNum: g.manualNum,
          partner: partnerNum(g),
          lines,
          dryRun: true,
        });
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        raw.push({ ref: e.label, params: e.params, prefix: String(g.manualNum ?? k + 1) });
      }
    }
  }
  const errors = raw.map((e) => `${e.prefix ? `${e.prefix}: ` : ""}${ctx.t(e.ref, translateParams(ctx, e.params))}`);
  const summary = { vouchers: plan.groups.length, debit: fromCents(debit), credit: fromCents(credit), errors };
  if (dryRun) return summary;
  if (raw.length) throw new UserError(raw[0].ref, raw[0].params);

  let first: RecordData | null = null;
  for (const g of plan.groups) {
    const lines = await convertLines(data, ctx.companyId, g.date, postingLines(g));
    const voucher = await postVoucher(data, {
      date: g.date,
      description: (journal.description as string) ?? null,
      sourceObject: "gl.journal",
      sourceId: String(journal.id),
      voucherSeqId: (plan.jn?.voucherSeqId as string) ?? null,
      voucherNum: g.manualNum,
      partner: partnerNum(g),
      lines,
    });
    first ??= voucher;
    // číslo dokladu zpět na řádky deníku (jen kde ještě není — obvykle je už od zadání)
    for (const l of new Map(g.legs.map((x) => [String(x.line.id), x.line])).values())
      if (l.voucherNum !== voucher.voucherNum) await data.update("gl.journalLine", String(l.id), { voucherNum: voucher.voucherNum });
    // saldo odběratelů a dodavatelů
    for (const [i, x] of g.legs.entries()) if (x.partner) await partnerTrans(data, x, lines[i], voucher, plan.settles.get(String(x.line.id)) ?? []);
    // daňové transakce (modul DPH): partner dokladu pro KH
    const partnerLeg = g.legs.find((x) => x.partner);
    const subject = partnerLeg?.partner?.rec.subjectId ? await data.get("gab.subject", String(partnerLeg.partner.rec.subjectId)) : null;
    for (const x of g.legs)
      for (const t of x.taxes ?? [])
        await data.create("tax.trans", {
          ...t,
          documentNum: t.documentNum ?? voucher.voucherNum ?? null,
          subjectId: subject?.id ?? null,
          vatId: subject?.vatId ?? null,
          voucherId: voucher.id,
          sourceObject: "gl.journal",
          sourceId: String(journal.id),
        });
  }
  // vyrovnání provedené zaúčtováním: Označeno → Vyrovnáno
  for (const id of plan.settles.keys()) await data.update("gl.journalLine", id, { settleStatus: "settled" });
  await data.update("gl.journal", String(journal.id), { status: "posted", voucherId: first?.id ?? null });
  return summary;
}

const partnerNum = (g: Group) => (g.legs.find((x) => x.partner)?.partner?.rec.accountNum as string) ?? null;

function translateParams(ctx: EventContext, p?: Record<string, string>) {
  return Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, v.startsWith("@") ? ctx.t(v) : v]));
}

/**
 * Zápis do salda: odběratel MD = pohledávka (faktura), D = úhrada; dodavatel
 * D = závazek, MD = úhrada. Úhrada s VS se spáruje s otevřenou fakturou partnera.
 */
async function partnerTrans(data: DataApi, x: Leg, posted: PostingLine, voucher: RecordData, settles: RecordData[]) {
  const p = x.partner!;
  const obj = p.kind === "customer" ? "ar.trans" : "ap.trans";
  const field = p.kind === "customer" ? "customerId" : "vendorId";
  const sign = p.kind === "customer" ? BigInt(1) : BigInt(-1);
  const acc = toCents(posted.amount) * sign; // + = faktura, − = úhrada
  const cur = posted.amountCur ? toCents(posted.amountCur) * sign : acc;
  const vs = (x.line.vs as string) || null;
  const isPayment = acc < zero;
  // vyrovnání z dialogu: přesně vybrané doklady a částky (jen strana řádku s partnerem vyrovnání)
  const lp = linePartner(x.line);
  const own = settles.length && lp && lp.kind === p.kind && lp.id === String(p.rec.id) ? settles : [];
  // záloha: úhrada zálohy (Uhrazeno, položka „Záloha“ v saldu, DPH zálohy) a případně aktivace smlouvy – bez další položky salda
  // smlouva (první platba): aktivace (objednávka K fakturaci, den platby) a platba smlouvy v saldu – uhradí fakturu splátky
  const agrSettle = own.find((s) => s.settleKind === "agreement");
  if (agrSettle && isPayment) {
    const agr = await activateScheduleByPayment(data, String(agrSettle.agreementId), String(voucher.date).slice(0, 10));
    await recordAgreementPayment(data, agr, { paid: -cur, paidAcc: -acc, voucherId: String(voucher.id), documentNum: String(voucher.voucherNum ?? ""), date: voucher.date, vs, currencyId: posted.currencyId ?? null });
    return;
  }
  const adv = own.find((s) => s.settleKind === "advance");
  if (adv) {
    await recordAdvancePayment(data, p.kind, settleRef(adv), { paidCur: -cur, paidAcc: -acc, voucherId: String(voucher.id), documentNum: String(voucher.voucherNum ?? ""), date: voucher.date, vs, currencyId: posted.currencyId ?? null });
    await agreementAdvancePaid(data, p.kind, settleRef(adv));
    return;
  }
  // uhrazené faktury smluv (kalendář): stav smlouvy – zaplaceno do, odblokování
  const paidInvoices: string[] = [];
  if (own.length) {
    await applySettlements(data, p.kind, own);
    const ids = own.filter((x) => (x.settleKind ?? "invoice") === "invoice").map(settleRef);
    for (const t of ids.length ? await data.find(obj, { id: { in: ids } }, { take: 200 }) : []) if (t.invoiceId) paidInvoices.push(String(t.invoiceId));
  } else if (isPayment && vs) {
    const [inv] = (await data.find(obj, { [field]: p.rec.id, kind: "invoice", vs, closed: false }, { take: 1 })) as RecordData[];
    if (inv) {
      const paid = toCents(inv.paidAmount ?? 0) - cur;
      await data.update(obj, String(inv.id), { paidAmount: fromCents(paid), closed: paid >= toCents(inv.amountCur ?? inv.amount) });
      if (inv.invoiceId) {
        await data.update(p.kind === "customer" ? "ar.invoice" : "ap.invoice", String(inv.invoiceId), { paidAmount: fromCents(paid) });
        paidInvoices.push(String(inv.invoiceId));
      }
    }
  }
  for (const id of paidInvoices) await agreementInvoicePaid(data, p.kind, id);
  await data.create(obj, {
    [field]: p.rec.id,
    kind: isPayment ? "payment" : "invoice",
    voucherId: voucher.id,
    documentNum: String(voucher.voucherNum ?? ""),
    vs,
    date: voucher.date,
    dueDate: isPayment ? null : voucher.date,
    currencyId: posted.currencyId ?? null,
    amount: fromCents(acc),
    amountCur: fromCents(cur),
    // vrácení / zápočet vyrovnaný v dialogu je spotřebovaný celý
    paidAmount: own.length && !isPayment ? fromCents(cur) : "0",
    closed: isPayment || own.length > 0,
  });
}

/**
 * Obsluha deníku (Ověřit, Zaúčtovat). Je tady, ne v posting.ts: deník importuje
 * účtování, ne naopak — kruhový import posting ↔ journal produkční bundler
 * sloučil a funkce z dimensions.ts byly při načtení ještě nedefinované.
 */
export const journalHandlers: Record<string, ObjectHandlers> = {
  "gl.journal": {
    async beforeSave(ctx, data, isNew) {
      // deník z nabídky banky / pokladny… dostane název svého druhu
      const jn = await resolveJournalName(ctx.data, data.journalNameId, data.journalType);
      if (jn.blocked) return { journalNameId: "@GL:JournalNameBlocked" };
      const before = !isNew && data.id ? await ctx.data.get("gl.journal", String(data.id)) : null;
      const nameChanged = !!before && before.journalNameId !== jn.id;
      data.journalNameId = jn.id;
      data.journalType = jn.journalType;
      // výchozí protiúčet a dimenze řádků z názvu deníku (nový deník / jiný název; jinak drží změny uživatele)
      const DEF = ["offsetType", "offsetAccountId", "offsetBankAccountId", "offsetCashDeskId", "dim1", "dim2", "dim3", "dim4", "dim5", "dim6"];
      if (isNew || nameChanged) {
        for (const f of DEF) if (nameChanged || data[f] === undefined || data[f] === null || data[f] === "") data[f] = jn[f] ?? null;
        if (!data.offsetType && jn.offsetAccountId) data.offsetType = "ledger";
        if (nameChanged) data.offsetCustomerId = data.offsetVendorId = null;
      }
      // jen odkaz protiúčtu odpovídající druhu
      const refs: Record<string, string> = { ledger: "offsetAccountId", customer: "offsetCustomerId", vendor: "offsetVendorId", bank: "offsetBankAccountId", cash: "offsetCashDeskId" };
      for (const [kind, f] of Object.entries(refs)) if (data.offsetType !== kind) data[f] = null;
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
};
