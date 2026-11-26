/**
 * Vyrovnání řádku deníku s otevřenými položkami (obdoba „Vyrovnat transakce“ v AX). Řádek s partnerem
 * (účet nebo protiúčet odběratel / dodavatel) nese seznam vyrovnání `gl.journalSettlement` a stav
 * `settleStatus` = žádné / částečně / vyrovnáno podle součtu proti částce řádku. Druhy:
 *  - faktury a dobropisy (položky salda) – i víc najednou, i částečně;
 *  - záloha – jedna na řádek a na celou částku řádku; řádek se účtuje na účet záloh (324 / 314) jako z výpisu;
 *  - smlouva (první platba, režim Kalendář) – jedna na řádek, částka = první splátka; zaúčtování smlouvu
 *    aktivuje (faktura první splátky) a platba ji uhradí.
 * Zaúčtování deníku úhradu rozdělí přesně podle vyrovnání (`journal.ts`); řádek bez vyrovnání se dál páruje
 * jednoznačným VS. Nic se nehádá: vyrovnání vybírá člověk v dialogu.
 */
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type RecordData } from "@/core/module";

const zero = BigInt(0);
export type PartnerKind = "customer" | "vendor";
export type SettleKind = "invoice" | "advance" | "agreement";

const P: Record<PartnerKind, { trans: string; advance: string; field: string; transField: string; advField: string; partnerObj: string; invoiceObj: string }> = {
  customer: { trans: "ar.trans", advance: "ar.advance", field: "customerId", transField: "customerTransId", advField: "customerAdvanceId", partnerObj: "ar.customer", invoiceObj: "ar.invoice" },
  vendor: { trans: "ap.trans", advance: "ap.advance", field: "vendorId", transField: "vendorTransId", advField: "vendorAdvanceId", partnerObj: "ap.vendor", invoiceObj: "ap.invoice" },
};

/** Odkaz vyrovnání na položku podle druhu. */
export function settleRef(s: RecordData): string {
  const kind = s.partnerType as PartnerKind;
  if (s.settleKind === "advance") return String(s[P[kind].advField] ?? "");
  if (s.settleKind === "agreement") return String(s.agreementId ?? "");
  return String(s[P[kind].transField] ?? "");
}

/** Partner řádku deníku: účet, jinak protiúčet (odběratel / dodavatel). */
export function linePartner(l: RecordData): { kind: PartnerKind; id: string; side: "main" | "offset" } | null {
  if (l.accountType === "customer" && l.customerId) return { kind: "customer", id: String(l.customerId), side: "main" };
  if (l.accountType === "vendor" && l.vendorId) return { kind: "vendor", id: String(l.vendorId), side: "main" };
  if (l.offsetType === "customer" && l.offsetCustomerId) return { kind: "customer", id: String(l.offsetCustomerId), side: "offset" };
  if (l.offsetType === "vendor" && l.offsetVendorId) return { kind: "vendor", id: String(l.offsetVendorId), side: "offset" };
  return null;
}

/** Částka řádku (kladná, haléře). */
export const lineAmount = (l: RecordData) => {
  const d = toCents(String(l.debit ?? 0));
  const c = toCents(String(l.credit ?? 0));
  return d > zero ? d : c;
};

/** Zbývá uhradit u položky salda / zálohy (se znaménkem položky: faktura +, dobropis −). */
export const transRemaining = (t: RecordData) => toCents(String(t.amountCur ?? t.amount ?? 0)) - toCents(String(t.paidAmount ?? 0));

const abs = (v: bigint) => (v < zero ? -v : v);

/** Stav vyrovnání řádku podle součtu vyrovnání proti částce řádku. */
export function settleStatusOf(amount: bigint, settled: bigint): "none" | "partial" | "full" {
  const s = abs(settled);
  if (s === zero) return "none";
  return amount > zero && s >= amount ? "full" : "partial";
}

/** Vyrovnání řádků deníku (jednou za deník). */
export async function settlementsOf(data: DataApi, journalId: string): Promise<Map<string, RecordData[]>> {
  const m = new Map<string, RecordData[]>();
  let list: RecordData[] = [];
  try {
    list = await data.find("gl.journalSettlement", { journalId }, { take: 5000 });
  } catch {
    list = [];
  }
  for (const s of list) {
    const k = String(s.journalLineId);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(s);
  }
  return m;
}

/** Přepočet stavu řádku po změně vyrovnání nebo částky. */
export async function refreshSettleStatus(data: DataApi, line: RecordData) {
  const list = await data.find("gl.journalSettlement", { journalLineId: line.id }, { take: 500 });
  const settled = list.reduce((a, s) => a + toCents(String(s.amount ?? 0)), zero);
  const st = settleStatusOf(lineAmount(line), settled);
  if (line.settleStatus !== st) await data.update("gl.journalLine", String(line.id), { settleStatus: st });
  return st;
}

/** Smazat vyrovnání řádku (změna partnera, smazání řádku, Zrušit vyrovnání). */
export async function clearSettlements(data: DataApi, lineId: string) {
  for (const s of await data.find("gl.journalSettlement", { journalLineId: lineId }, { take: 500 })) await data.remove("gl.journalSettlement", String(s.id));
}

/** První plánovaná splátka smluv (částka první platby) – hromadně. */
async function firstInstalments(data: DataApi, agreementIds: string[]): Promise<Map<string, bigint>> {
  const m = new Map<string, bigint>();
  if (!agreementIds.length) return m;
  const lines = await data.find("ar.agreementLine", { agreementId: { in: agreementIds }, status: "planned" }, { take: 5000, orderBy: { lineNum: "asc" } }).catch(() => [] as RecordData[]);
  for (const l of lines) if (!m.has(String(l.agreementId))) m.set(String(l.agreementId), toCents(String(l.amount ?? 0)));
  return m;
}

/** Načte položky vyrovnání podle druhu (hromadně). */
async function targetsOf(data: DataApi, kind: PartnerKind, list: RecordData[]) {
  const ids = (k: SettleKind) => list.filter((s) => (s.settleKind ?? "invoice") === k).map(settleRef).filter(Boolean);
  const get = async (obj: string, xs: string[]) => (xs.length ? await data.find(obj, { id: { in: xs } }, { take: 500 }).catch(() => [] as RecordData[]) : []);
  const map = new Map<string, RecordData>();
  for (const r of await get(P[kind].trans, ids("invoice"))) map.set(`invoice|${r.id}`, r);
  for (const r of await get(P[kind].advance, ids("advance"))) map.set(`advance|${r.id}`, r);
  for (const r of await get("ar.agreement", kind === "customer" ? ids("agreement") : [])) map.set(`agreement|${r.id}`, r);
  return map;
}

/**
 * Kontrola vyrovnání při Ověřit / Zaúčtovat: položka patří partnerovi řádku, je otevřená, částka nepřesáhne
 * zbytek položky a součet nepřesáhne částku řádku; záloha / smlouva jedna na řádek a na celou částku řádku.
 */
export async function checkSettlements(data: DataApi, line: RecordData, list: RecordData[], lineNo: number): Promise<{ ref: string; params?: Record<string, string> }[]> {
  if (!list.length) return [];
  const p = linePartner(line);
  const n = String(lineNo);
  if (!p) return [{ ref: "@GL:SettleNoPartner", params: { line: n } }];
  const t = P[p.kind];
  const targets = await targetsOf(data, p.kind, list);
  const errors: { ref: string; params?: Record<string, string> }[] = [];
  const special = list.filter((s) => s.settleKind === "advance" || s.settleKind === "agreement");
  if (special.length && (list.length > 1 || abs(toCents(String(special[0].amount ?? 0))) !== lineAmount(line))) errors.push({ ref: "@GL:SettleWhole", params: { line: n } });
  const firsts = await firstInstalments(data, list.filter((s) => s.settleKind === "agreement").map(settleRef));
  let sum = zero;
  for (const s of list) {
    const k = (s.settleKind ?? "invoice") as SettleKind;
    const tr = targets.get(`${k}|${settleRef(s)}`);
    const amt = toCents(String(s.amount ?? 0));
    sum += amt;
    const partnerOf = tr ? String(k === "agreement" ? tr.customerId : tr[t.field]) : "";
    if (!tr || partnerOf !== p.id) {
      errors.push({ ref: "@GL:SettleOtherPartner", params: { line: n } });
      continue;
    }
    if (k === "agreement") {
      const first = firsts.get(String(tr.id));
      if (tr.status !== "awaiting" || first === undefined) errors.push({ ref: "@GL:SettleClosed", params: { line: n, doc: String(tr.agreementNum ?? "") } });
      else if (first !== amt) errors.push({ ref: "@GL:SettleAgreementAmount", params: { line: n, doc: String(tr.agreementNum ?? ""), rest: fromCents(first) } });
      continue;
    }
    const rem = transRemaining(tr);
    const doc = String((k === "advance" ? tr.advanceNum : tr.documentNum) ?? tr.vs ?? "");
    if (tr.closed || tr.status === "settled" || tr.status === "cancelled" || rem === zero) errors.push({ ref: "@GL:SettleClosed", params: { line: n, doc } });
    else if ((rem > zero && (amt <= zero || amt > rem)) || (rem < zero && (amt >= zero || amt < rem))) errors.push({ ref: "@GL:SettleTooMuch", params: { line: n, doc, rest: fromCents(rem) } });
    if ((tr.currencyId ?? null) !== (line.currencyId ?? null) && line.currencyId) errors.push({ ref: "@GL:SettleCurrency", params: { line: n, doc } });
  }
  if (abs(sum) > lineAmount(line)) errors.push({ ref: "@GL:SettleOverLine", params: { line: n } });
  return errors;
}

/** Úhrada faktur podle vyrovnání (zaúčtování deníku): položky salda a faktury dostanou zaplacenou částku. */
export async function applySettlements(data: DataApi, kind: PartnerKind, list: RecordData[]) {
  const t = P[kind];
  for (const s of list.filter((x) => (x.settleKind ?? "invoice") === "invoice")) {
    const tr = await data.get(t.trans, settleRef(s));
    if (!tr) throw new UserError("@GL:SettleClosed", { line: "", doc: "" });
    const paid = toCents(String(tr.paidAmount ?? 0)) + toCents(String(s.amount ?? 0));
    const total = toCents(String(tr.amountCur ?? tr.amount ?? 0));
    await data.update(t.trans, String(tr.id), { paidAmount: fromCents(paid), closed: total >= zero ? paid >= total : paid <= total });
    if (tr.invoiceId) await data.update(t.invoiceObj, String(tr.invoiceId), { paidAmount: fromCents(paid) });
  }
}

export interface SettleCriteria {
  /** co vyrovnat: faktury (výchozí), zálohy, smlouvy – první platba */
  type?: SettleKind;
  /** jen partner řádku (výchozí, když ho řádek má) */
  partnerOnly?: boolean;
  kind?: PartnerKind | "";
  vs?: string;
  amount?: string;
  dateFrom?: string;
  dateTo?: string;
  /** číslo dokladu / název partnera */
  text?: string;
}

export interface SettleCandidate {
  kind: PartnerKind;
  type: SettleKind;
  transId: string;
  partnerId: string;
  partnerName: string;
  documentNum: string;
  vs: string;
  date: string;
  dueDate: string;
  amount: string;
  remaining: string;
  /** částka už vybraná na tomto řádku */
  selected: string | null;
}

const fold = (x: unknown) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const iso = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : "");

/**
 * Otevřené položky k vyrovnání podle druhu: partner řádku (nebo všichni podle kritérií), VS, zbývající
 * částka, datum, text. Nejvýš 200 řádků; již vybrané na řádku vždy navrch.
 */
export async function settleCandidates(data: DataApi, line: RecordData, c: SettleCriteria): Promise<SettleCandidate[]> {
  const type: SettleKind = c.type ?? "invoice";
  const p = linePartner(line);
  let kinds: PartnerKind[] = p && c.partnerOnly !== false ? [p.kind] : c.kind ? [c.kind] : ["customer", "vendor"];
  if (type === "agreement") kinds = kinds.filter((k) => k === "customer"); // smlouvy s první platbou: odběratelé
  const chosen = (await data.find("gl.journalSettlement", { journalLineId: line.id }, { take: 500 })).filter((s) => (s.settleKind ?? "invoice") === type);
  const amount = c.amount?.trim() ? toCents(c.amount.replace(/\s/g, "").replace(",", ".")) : null;
  const out: SettleCandidate[] = [];
  for (const kind of kinds) {
    const t = P[kind];
    const obj = type === "invoice" ? t.trans : type === "advance" ? t.advance : "ar.agreement";
    const pf = type === "agreement" ? "customerId" : t.field;
    const where: Record<string, unknown> = type === "invoice" ? { kind: "invoice", closed: false } : type === "advance" ? { status: { in: ["open", "paid"] } } : { status: "awaiting" };
    if (p && c.partnerOnly !== false && p.kind === kind) where[pf] = p.id;
    if (c.vs?.trim()) where.vs = c.vs.trim().replace(/\D/g, "");
    let rows: RecordData[] = [];
    try {
      rows = await data.find(obj, where, { take: 1000 });
    } catch {
      continue; // modul vypnutý
    }
    const picked = chosen.filter((s) => s.partnerType === kind).map(settleRef);
    const extra = picked.filter((id) => !rows.some((r) => String(r.id) === id));
    if (extra.length) rows = [...(await data.find(obj, { id: { in: extra } }, { take: 500 })), ...rows];
    const firsts = type === "agreement" ? await firstInstalments(data, rows.map((r) => String(r.id))) : new Map<string, bigint>();
    const partners = new Map((await data.find(t.partnerObj, { id: { in: [...new Set(rows.map((r) => String(r[pf])))] } }, { take: 1000 })).map((x) => [String(x.id), x]));
    const subjects = new Map((await data.find("gab.subject", { id: { in: [...new Set([...partners.values()].map((x) => String(x.subjectId ?? "")).filter(Boolean))] } }, { take: 1000 })).map((x) => [String(x.id), x]));
    for (const r of rows) {
      const sel = chosen.find((s) => s.partnerType === kind && settleRef(s) === String(r.id));
      const total = type === "agreement" ? (firsts.get(String(r.id)) ?? zero) : toCents(String(r.amountCur ?? r.amount ?? 0));
      const rem = type === "agreement" ? total : transRemaining(r);
      const pr = partners.get(String(r[pf]));
      const name = String(subjects.get(String(pr?.subjectId ?? ""))?.name ?? pr?.accountNum ?? "");
      const docNum = String((type === "invoice" ? r.documentNum : type === "advance" ? r.advanceNum : r.agreementNum) ?? "");
      const date = iso(type === "invoice" ? r.date : type === "advance" ? r.issueDate : r.startDate);
      if (!sel) {
        if (rem === zero) continue;
        if (amount !== null && abs(rem) !== abs(amount) && abs(total) !== abs(amount)) continue;
        if (c.dateFrom && date < c.dateFrom) continue;
        if (c.dateTo && date > c.dateTo) continue;
        if (c.text?.trim() && !fold(`${docNum} ${name} ${pr?.accountNum ?? ""}`).includes(fold(c.text.trim()))) continue;
      }
      out.push({
        kind,
        type,
        transId: String(r.id),
        partnerId: String(r[pf]),
        partnerName: name,
        documentNum: docNum,
        vs: String(r.vs ?? ""),
        date,
        dueDate: iso(r.dueDate),
        amount: fromCents(total),
        remaining: fromCents(rem),
        selected: sel ? String(sel.amount) : null,
      });
    }
  }
  return out.sort((a, b) => (a.selected ? 0 : 1) - (b.selected ? 0 : 1) || a.date.localeCompare(b.date)).slice(0, 200);
}

/**
 * Uložit vyrovnání řádku: nahradí dosavadní výběr. Řádek bez partnera dostane partnera vybraných položek
 * na stranu účtu (účet prázdný / hlavní kniha bez účtu), prázdný VS = VS jediné položky, prázdná částka = součet
 * (úhrada odběratele = Dal, dodavateli = Má dáti). Všechny položky jednoho partnera a jednoho druhu.
 */
export async function saveSettlement(data: DataApi, line: RecordData, items: { kind: PartnerKind; type?: SettleKind; transId: string; amount: string }[]) {
  if (!items.length) {
    await clearSettlements(data, String(line.id));
    await refreshSettleStatus(data, (await data.get("gl.journalLine", String(line.id)))!);
    return;
  }
  const kinds = new Set(items.map((i) => i.kind));
  const types = new Set(items.map((i) => i.type ?? "invoice"));
  if (kinds.size > 1 || types.size > 1) throw new UserError("@GL:SettleOnePartner");
  const kind = items[0].kind;
  const type = (items[0].type ?? "invoice") as SettleKind;
  if (type === "agreement" && kind !== "customer") throw new UserError("@SYS:InvalidValue");
  if (type !== "invoice" && items.length > 1) throw new UserError("@GL:SettleWhole", { line: String(line.lineNum ?? "") });
  const t = P[kind];
  const obj = type === "invoice" ? t.trans : type === "advance" ? t.advance : "ar.agreement";
  const pf = type === "agreement" ? "customerId" : t.field;
  const rows = await data.find(obj, { id: { in: items.map((i) => i.transId) } }, { take: 500 });
  const partnerIds = new Set(rows.map((x) => String(x[pf])));
  if (rows.length !== items.length || partnerIds.size !== 1) throw new UserError("@GL:SettleOnePartner");
  const partnerId = [...partnerIds][0];
  const firsts = type === "agreement" ? await firstInstalments(data, rows.map((r) => String(r.id))) : new Map<string, bigint>();
  let p = linePartner(line);
  const patch: RecordData = {};
  if (!p) {
    // partner na stranu účtu (banka zůstane protiúčtem)
    const mainEmpty = !line.accountType || (line.accountType === "ledger" && !line.accountId);
    if (!mainEmpty) throw new UserError("@GL:SettleNoPartner", { line: String(line.lineNum ?? "") });
    Object.assign(patch, { accountType: kind, [t.field]: partnerId, accountId: null });
    p = { kind, id: partnerId, side: "main" };
  } else if (p.kind !== kind || p.id !== partnerId) throw new UserError("@GL:SettleOtherPartner", { line: String(line.lineNum ?? "") });
  const amounts: bigint[] = [];
  for (const i of items) {
    const tr = rows.find((x) => String(x.id) === i.transId)!;
    const rem = type === "agreement" ? (firsts.get(String(tr.id)) ?? zero) : transRemaining(tr);
    let amt = type === "agreement" ? rem : toCents(String(i.amount || fromCents(rem)).replace(/\s/g, "").replace(",", "."));
    if (rem < zero && amt > zero) amt = -amt; // dobropis: se znaménkem položky
    const doc = String((type === "invoice" ? tr.documentNum : type === "advance" ? tr.advanceNum : tr.agreementNum) ?? "");
    if (amt === zero || (rem > zero && amt > rem) || (rem < zero && amt < rem)) throw new UserError("@GL:SettleTooMuch", { line: String(line.lineNum ?? ""), doc, rest: fromCents(rem) });
    amounts.push(amt);
  }
  const sum = amounts.reduce((a, b) => a + b, zero);
  if (!line.vs && items.length === 1) {
    const vs = String(rows[0].vs ?? "");
    if (/^\d{1,10}$/.test(vs)) patch.vs = vs;
  }
  if (lineAmount(line) === zero) {
    // úhrada snižuje saldo: odběratel na straně účtu = Dal, dodavatel = Má dáti; na protiúčtu opačně; dobropis obráceně
    const pay = sum > zero;
    const creditSide = (kind === "customer") === (p.side === "main") ? pay : !pay;
    Object.assign(patch, creditSide ? { credit: fromCents(abs(sum)), debit: null } : { debit: fromCents(abs(sum)), credit: null });
  } else if (abs(sum) > lineAmount(line)) throw new UserError("@GL:SettleOverLine", { line: String(line.lineNum ?? "") });
  else if (type !== "invoice" && abs(sum) !== lineAmount(line)) throw new UserError("@GL:SettleWhole", { line: String(line.lineNum ?? "") });
  if (Object.keys(patch).length) await data.update("gl.journalLine", String(line.id), patch);
  await clearSettlements(data, String(line.id));
  for (const [k, i] of items.entries()) {
    const ref = type === "invoice" ? { [t.transField]: i.transId } : type === "advance" ? { [t.advField]: i.transId } : { agreementId: i.transId };
    await data.create("gl.journalSettlement", { journalId: line.journalId, journalLineId: line.id, partnerType: kind, settleKind: type, ...ref, amount: fromCents(amounts[k]) });
  }
  await refreshSettleStatus(data, (await data.get("gl.journalLine", String(line.id)))!);
}
