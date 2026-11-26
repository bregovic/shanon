/**
 * Vyrovnání řádku deníku s otevřenými položkami salda (faktury odběratelů a dodavatelů) — obdoba
 * „Vyrovnat transakce“ v AX. Řádek deníku s partnerem (účet nebo protiúčet odběratel / dodavatel) si nese
 * seznam vyrovnání `gl.journalSettlement` (položka salda + částka v měně položky); stav řádku
 * `settleStatus` = žádné / částečně / vyrovnáno podle součtu proti částce řádku.
 *
 * Zaúčtování deníku úhradu rozdělí přesně podle vyrovnání (`partnerTrans` v journal.ts); řádek bez
 * vyrovnání se dál páruje jednoznačným VS. Nic se nehádá: vyrovnání vybírá člověk v dialogu.
 */
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type RecordData } from "@/core/module";

const zero = BigInt(0);
export type PartnerKind = "customer" | "vendor";

const TRANS: Record<PartnerKind, { obj: string; field: string; transField: string; partnerObj: string; invoiceObj: string }> = {
  customer: { obj: "ar.trans", field: "customerId", transField: "customerTransId", partnerObj: "ar.customer", invoiceObj: "ar.invoice" },
  vendor: { obj: "ap.trans", field: "vendorId", transField: "vendorTransId", partnerObj: "ap.vendor", invoiceObj: "ap.invoice" },
};

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

/** Zbývá uhradit u položky salda (se znaménkem položky: faktura +, dobropis −). */
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

/**
 * Kontrola vyrovnání při Ověřit / Zaúčtovat: položka patří partnerovi řádku, je otevřená, částka nepřesáhne
 * zbytek položky a součet nepřesáhne částku řádku; měna položky = měna řádku.
 */
export async function checkSettlements(data: DataApi, line: RecordData, list: RecordData[], lineNo: number): Promise<{ ref: string; params?: Record<string, string> }[]> {
  if (!list.length) return [];
  const p = linePartner(line);
  const n = String(lineNo);
  if (!p) return [{ ref: "@GL:SettleNoPartner", params: { line: n } }];
  const t = TRANS[p.kind];
  const ids = list.map((s) => String(s[t.transField] ?? "")).filter(Boolean);
  if (ids.length !== list.length) return [{ ref: "@GL:SettleNoPartner", params: { line: n } }];
  const trans = new Map((await data.find(t.obj, { id: { in: ids } }, { take: 500 })).map((x) => [String(x.id), x]));
  const errors: { ref: string; params?: Record<string, string> }[] = [];
  let sum = zero;
  for (const s of list) {
    const tr = trans.get(String(s[t.transField]));
    const amt = toCents(String(s.amount ?? 0));
    sum += amt;
    if (!tr || String(tr[t.field]) !== p.id) {
      errors.push({ ref: "@GL:SettleOtherPartner", params: { line: n } });
      continue;
    }
    const rem = transRemaining(tr);
    const doc = String(tr.documentNum ?? tr.vs ?? "");
    if (tr.closed || rem === zero) errors.push({ ref: "@GL:SettleClosed", params: { line: n, doc } });
    else if ((rem > zero && (amt <= zero || amt > rem)) || (rem < zero && (amt >= zero || amt < rem))) errors.push({ ref: "@GL:SettleTooMuch", params: { line: n, doc, rest: fromCents(rem) } });
    if ((tr.currencyId ?? null) !== (line.currencyId ?? null) && line.currencyId) errors.push({ ref: "@GL:SettleCurrency", params: { line: n, doc } });
  }
  if (abs(sum) > lineAmount(line)) errors.push({ ref: "@GL:SettleOverLine", params: { line: n } });
  return errors;
}

/** Úhrada podle vyrovnání (zaúčtování deníku): položky salda a faktury dostanou zaplacenou částku. */
export async function applySettlements(data: DataApi, kind: PartnerKind, list: RecordData[]) {
  const t = TRANS[kind];
  for (const s of list) {
    const tr = await data.get(t.obj, String(s[t.transField]));
    if (!tr) throw new UserError("@GL:SettleClosed", { line: "", doc: "" });
    const paid = toCents(String(tr.paidAmount ?? 0)) + toCents(String(s.amount ?? 0));
    const total = toCents(String(tr.amountCur ?? tr.amount ?? 0));
    await data.update(t.obj, String(tr.id), { paidAmount: fromCents(paid), closed: total >= zero ? paid >= total : paid <= total });
    if (tr.invoiceId) await data.update(t.invoiceObj, String(tr.invoiceId), { paidAmount: fromCents(paid) });
  }
}

export interface SettleCriteria {
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
 * Otevřené položky k vyrovnání: partner řádku (nebo všichni podle kritérií), VS, zbývající částka, datum,
 * text. Nejvýš 200 řádků; již vybrané na řádku vždy navrch.
 */
export async function settleCandidates(data: DataApi, line: RecordData, c: SettleCriteria): Promise<SettleCandidate[]> {
  const p = linePartner(line);
  const kinds: PartnerKind[] = p && c.partnerOnly !== false ? [p.kind] : c.kind ? [c.kind] : ["customer", "vendor"];
  const chosen = await data.find("gl.journalSettlement", { journalLineId: line.id }, { take: 500 });
  const out: SettleCandidate[] = [];
  for (const kind of kinds) {
    const t = TRANS[kind];
    const where: Record<string, unknown> = { kind: "invoice", closed: false };
    if (p && c.partnerOnly !== false && p.kind === kind) where[t.field] = p.id;
    if (c.vs?.trim()) where.vs = c.vs.trim().replace(/\D/g, "");
    let rows: RecordData[] = [];
    try {
      rows = await data.find(t.obj, where, { take: 1000, orderBy: { date: "asc" } });
    } catch {
      continue; // modul vypnutý
    }
    const picked = chosen.filter((s) => s.partnerType === kind).map((s) => String(s[t.transField] ?? ""));
    const extra = picked.filter((id) => !rows.some((r) => String(r.id) === id));
    if (extra.length) rows = [...(await data.find(t.obj, { id: { in: extra } }, { take: 500 })), ...rows];
    const partners = new Map((await data.find(t.partnerObj, { id: { in: [...new Set(rows.map((r) => String(r[t.field])))] } }, { take: 1000 })).map((x) => [String(x.id), x]));
    const subjects = new Map((await data.find("gab.subject", { id: { in: [...new Set([...partners.values()].map((x) => String(x.subjectId ?? "")).filter(Boolean))] } }, { take: 1000 })).map((x) => [String(x.id), x]));
    const amount = c.amount?.trim() ? toCents(c.amount.replace(/\s/g, "").replace(",", ".")) : null;
    for (const r of rows) {
      const sel = chosen.find((s) => s.partnerType === kind && String(s[t.transField]) === String(r.id));
      const rem = transRemaining(r);
      const pr = partners.get(String(r[t.field]));
      const name = String(subjects.get(String(pr?.subjectId ?? ""))?.name ?? pr?.accountNum ?? "");
      if (!sel) {
        if (rem === zero) continue;
        if (amount !== null && abs(rem) !== abs(amount) && abs(toCents(String(r.amountCur ?? r.amount ?? 0))) !== abs(amount)) continue;
        if (c.dateFrom && iso(r.date) < c.dateFrom) continue;
        if (c.dateTo && iso(r.date) > c.dateTo) continue;
        if (c.text?.trim() && !fold(`${r.documentNum ?? ""} ${name} ${pr?.accountNum ?? ""}`).includes(fold(c.text.trim()))) continue;
      }
      out.push({
        kind,
        transId: String(r.id),
        partnerId: String(r[t.field]),
        partnerName: name,
        documentNum: String(r.documentNum ?? ""),
        vs: String(r.vs ?? ""),
        date: iso(r.date),
        dueDate: iso(r.dueDate),
        amount: String(r.amountCur ?? r.amount ?? "0"),
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
 * (úhrada odběratele = Dal, dodavateli = Má dáti). Všechny položky musí patřit jednomu partnerovi.
 */
export async function saveSettlement(data: DataApi, line: RecordData, items: { kind: PartnerKind; transId: string; amount: string }[]) {
  if (!items.length) {
    await clearSettlements(data, String(line.id));
    await refreshSettleStatus(data, (await data.get("gl.journalLine", String(line.id)))!);
    return;
  }
  const kinds = new Set(items.map((i) => i.kind));
  if (kinds.size > 1) throw new UserError("@GL:SettleOnePartner");
  const kind = items[0].kind;
  const t = TRANS[kind];
  const trans = await data.find(t.obj, { id: { in: items.map((i) => i.transId) } }, { take: 500 });
  const partnerIds = new Set(trans.map((x) => String(x[t.field])));
  if (trans.length !== items.length || partnerIds.size !== 1) throw new UserError("@GL:SettleOnePartner");
  const partnerId = [...partnerIds][0];
  let p = linePartner(line);
  const patch: RecordData = {};
  if (!p) {
    // partner na stranu účtu (banka zůstane protiúčtem)
    const mainEmpty = !line.accountType || (line.accountType === "ledger" && !line.accountId);
    if (!mainEmpty) throw new UserError("@GL:SettleNoPartner", { line: String(line.lineNum ?? "") });
    Object.assign(patch, { accountType: kind, [t.field]: partnerId, accountId: null });
    p = { kind, id: partnerId, side: "main" };
  } else if (p.kind !== kind || p.id !== partnerId) throw new UserError("@GL:SettleOtherPartner", { line: String(line.lineNum ?? "") });
  let sum = zero;
  for (const i of items) {
    const tr = trans.find((x) => String(x.id) === i.transId)!;
    const rem = transRemaining(tr);
    let amt = toCents(String(i.amount || fromCents(rem)).replace(/\s/g, "").replace(",", "."));
    if (rem < zero && amt > zero) amt = -amt; // dobropis: se znaménkem položky
    if (amt === zero || (rem > zero && amt > rem) || (rem < zero && amt < rem)) throw new UserError("@GL:SettleTooMuch", { line: String(line.lineNum ?? ""), doc: String(tr.documentNum ?? ""), rest: fromCents(rem) });
    sum += amt;
  }
  if (!line.vs && items.length === 1) {
    const vs = String(trans[0].vs ?? "");
    if (/^\d{1,10}$/.test(vs)) patch.vs = vs;
  }
  if (lineAmount(line) === zero) {
    // úhrada snižuje saldo: odběratel na straně účtu = Dal, dodavatel = Má dáti; na protiúčtu opačně; dobropis obráceně
    const pay = sum > zero;
    const creditSide = (kind === "customer") === (p.side === "main") ? pay : !pay;
    Object.assign(patch, creditSide ? { credit: fromCents(abs(sum)), debit: null } : { debit: fromCents(abs(sum)), credit: null });
  } else if (abs(sum) > lineAmount(line)) throw new UserError("@GL:SettleOverLine", { line: String(line.lineNum ?? "") });
  if (Object.keys(patch).length) await data.update("gl.journalLine", String(line.id), patch);
  await clearSettlements(data, String(line.id));
  for (const i of items) {
    const tr = trans.find((x) => String(x.id) === i.transId)!;
    const rem = transRemaining(tr);
    let amt = toCents(String(i.amount || fromCents(rem)).replace(/\s/g, "").replace(",", "."));
    if (rem < zero && amt > zero) amt = -amt;
    await data.create("gl.journalSettlement", { journalId: line.journalId, journalLineId: line.id, partnerType: kind, [t.transField]: i.transId, amount: fromCents(amt) });
  }
  await refreshSettleStatus(data, (await data.get("gl.journalLine", String(line.id)))!);
}
