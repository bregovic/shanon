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
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type EventContext, type RecordData } from "@/core/module";
import { convertLines, postVoucher, type PostingLine } from "./posting";
import { dimsOf } from "./dimensions";

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
  const errors: { ref: string; params?: Record<string, string>; prefix?: string }[] = [];
  if (!lines.length) errors.push({ ref: "@GL:JournalEmpty" });
  const legsByLine: Leg[][] = [];
  for (const [i, l] of lines.entries()) {
    const n = Number(l.lineNum ?? i + 1);
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
    if (l.offsetType) {
      const ok = String(l.offsetType) as Kind;
      const off = await resolveLeg(data, ok, (l[REF[ok]?.offset] as string) ?? null);
      if (!off) errors.push({ ref: "@GL:LineAccountMissing", params: { line: String(n) } });
      else legs.push({ ...off, line: l, lineNo: n, amount: -amount, currencyId, amountCur: neg(amountCur) });
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
  if (mode === "journal") {
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
  return { jn, groups, errors, lines };
}

function postingLines(g: Group): PostingLine[] {
  return g.legs.map((x) => ({
    accountId: x.accountId,
    amount: fromCents(x.amount),
    text: (x.line.text as string) ?? null,
    dims: dimsOf(x.line),
    currencyId: x.currencyId,
    amountCur: x.amountCur,
    viaSubledger: x.viaSubledger,
  }));
}

/**
 * Ověřit (`dryRun`) nebo zaúčtovat deník. Vrací počet dokladů a součty;
 * chyby: při ověření seznam, při účtování první chyba jako výjimka.
 */
export async function runJournal(ctx: EventContext, journal: RecordData, dryRun: boolean) {
  const data = ctx.data;
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

  // každý doklad zkontroluje účtování nanečisto (účty, období, dimenze)
  if (!raw.length) {
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
    // číslo dokladu zpět na řádky deníku
    for (const id of new Set(g.legs.map((x) => String(x.line.id)))) await data.update("gl.journalLine", id, { voucherNum: voucher.voucherNum });
    // saldo odběratelů a dodavatelů
    for (const [i, x] of g.legs.entries()) if (x.partner) await partnerTrans(data, x, lines[i], voucher);
  }
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
async function partnerTrans(data: DataApi, x: Leg, posted: PostingLine, voucher: RecordData) {
  const p = x.partner!;
  const obj = p.kind === "customer" ? "ar.trans" : "ap.trans";
  const field = p.kind === "customer" ? "customerId" : "vendorId";
  const sign = p.kind === "customer" ? BigInt(1) : BigInt(-1);
  const acc = toCents(posted.amount) * sign; // + = faktura, − = úhrada
  const cur = posted.amountCur ? toCents(posted.amountCur) * sign : acc;
  const vs = (x.line.vs as string) || null;
  const isPayment = acc < zero;
  if (isPayment && vs) {
    const [inv] = (await data.find(obj, { [field]: p.rec.id, kind: "invoice", vs, closed: false }, { take: 1 })) as RecordData[];
    if (inv) {
      const paid = toCents(inv.paidAmount ?? 0) - cur;
      await data.update(obj, String(inv.id), { paidAmount: fromCents(paid), closed: paid >= toCents(inv.amountCur ?? inv.amount) });
      if (inv.invoiceId) await data.update(p.kind === "customer" ? "ar.invoice" : "ap.invoice", String(inv.invoiceId), { paidAmount: fromCents(paid) });
    }
  }
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
    paidAmount: "0",
    closed: isPayment,
  });
}
