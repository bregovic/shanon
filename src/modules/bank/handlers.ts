/**
 * Banka: import výpisu, párování a zaúčtování úhrad.
 *
 * Párování (automat) — jen jednoznačné: příjem → otevřená faktura odběratele
 * se stejným VS, výdej → faktura dodavatele se stejným VS; když VS sedí na
 * víc faktur, nechá řádek na ručním párování (jeden VS mívá víc dokladů).
 *
 * Zaúčtování: banka proti pohledávce / závazku (účet ze skupiny partnera)
 * nebo proti zadanému účtu; úhrada se zapíše do salda (položka „Úhrada“)
 * a u faktury se navýší Uhrazeno, při plné úhradě se položka vyrovná.
 */
import { csvMatchesAccount, decodeText, parseCsvStatement, toCsvFormat } from "./csv-statement";
import { ibanFor } from "@/core/print";
import { fromCents, sumCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData, type ValidationErrors } from "@/core/module";
import { qrGlAccount } from "./qr-account";
import { accountingCurrencyId, convertLines, postVoucher, type PostingLine } from "@/modules/gl/posting";
import { checkStatement, decodeGpc, parseGpc } from "./gpc";
import type { GpcStatement } from "./gpc";
import { advanceAccount, recordAdvancePayment } from "@/modules/tax/orders";
import { activateScheduleByPayment, agreementAdvancePaid, agreementInvoicePaid, awaitingScheduleByVs } from "@/modules/tax/agreements";
import { checkStatementChain, journalFromStatement } from "./payments";

const zero = BigInt(0);

/** "19-123456789/0800" → "19000123456789" (jako číslo účtu v GPC, bez vodicích nul). */
export function gpcAccountKey(accountNum: string): string {
  const [left] = accountNum.split("/");
  const [prefix, num] = left.includes("-") ? left.split("-") : ["", left];
  return (prefix.padStart(6, "0") + num.padStart(10, "0")).replace(/^0+/, "");
}

async function assertDraft(data: DataApi, statementId: unknown) {
  const st = statementId ? await data.get("bank.statement", String(statementId)) : null;
  if (st?.status === "posted") throw new UserError("@GL:Locked");
  return st;
}

/** Obraty a konečný zůstatek výpisu z jeho řádků. */
export async function recalcStatement(data: DataApi, statementId: string) {
  const st = await data.get("bank.statement", statementId);
  if (!st) return;
  const lines = await data.find("bank.statementLine", { statementId });
  const amounts = lines.map((l) => toCents(l.amount));
  const credit = sumCents(amounts.filter((a) => a > zero));
  const debit = -sumCents(amounts.filter((a) => a < zero));
  await data.update("bank.statement", statementId, {
    credit: fromCents(credit),
    debit: fromCents(debit),
    closingBalance: fromCents(toCents(st.openingBalance) + credit - debit),
  });
}

/** Otevřená položka: zbývá uhradit (v měně faktury). */
const remaining = (t: RecordData) => toCents(t.amountCur ?? t.amount) - toCents(t.paidAmount);

/** Výchozí pořadí, když firma kroky nemá (starší firmy před nasazením nastavení). */
const DEFAULT_STEPS = [{ method: "vsInvoice", requireAmount: false }, { method: "vsAdvance", requireAmount: false }, { method: "vsAgreement", requireAmount: true }, { method: "vsPosReceipt", requireAmount: true }, { method: "counterPartner", requireAmount: false }, { method: "rules", requireAmount: false }];

/** Účet QR plateb pokladny účtenky (analytika bankovního účtu pro QR) — proti němu jde úhrada z výpisu. */
async function posReceiptAccount(data: DataApi, receiptId: string): Promise<string> {
  const r = await data.get("pos.receipt", receiptId);
  const reg = r?.registerId ? await data.get("pos.register", String(r.registerId)) : null;
  if (!reg) throw new UserError("@SYS:InvalidValue");
  return qrGlAccount(data, reg);
}

/** Číslo účtu pro porovnání: bez kódu banky, mezer a vodicích nul (předčíslí-číslo jako GPC). */
const accountKey = (v: unknown) => {
  const s = String(v ?? "").replace(/\s/g, "").split("/")[0];
  return s.includes("-") ? gpcAccountKey(s) : s.replace(/\D/g, "").replace(/^0+/, "");
};

/**
 * Automatické párování nespárovaných řádků výpisu podle pořadí párování (Banka → Pořadí párování):
 * jednoznačný VS → otevřená faktura, VS → záloha, bankovní účet protistrany → dodavatel / odběratel,
 * předkontace. První úspěšný krok vyhrává; víc kandidátů párování řádku zastaví (rozhodne člověk).
 * Vrací počet spárovaných.
 */
export async function autoMatch(data: DataApi, statementId: string): Promise<number> {
  let n = 0;
  const safe = async <T,>(fn: () => Promise<T>, fb: T) => {
    try {
      return await fn();
    } catch {
      return fb;
    }
  };
  const configured = await safe(() => data.find("bank.matchStep", { active: true }, { take: 20, orderBy: { sequence: "asc" } }), [] as RecordData[]);
  const steps = configured.length ? configured : DEFAULT_STEPS;
  const rules = await safe(() => data.find("bank.postingRule", { active: true }, { take: 200, orderBy: { priority: "asc" } }), [] as RecordData[]);
  const fold = (x: unknown) => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // bankovní účty subjektů (adresář) jednou za běh
  let subjectAccounts: Map<string, string> | null = null;
  const subjectByAccount = async (counter: unknown) => {
    if (!subjectAccounts) {
      subjectAccounts = new Map();
      for (const a of await safe(() => data.find("gab.bankAccount", {}, { take: 10000 }), [] as RecordData[])) {
        if (a.accountNum) subjectAccounts.set(`n:${accountKey(a.accountNum)}`, String(a.subjectId));
        if (a.iban) subjectAccounts.set(`i:${String(a.iban).replace(/\s/g, "").toUpperCase()}`, String(a.subjectId));
      }
    }
    const raw = String(counter ?? "").replace(/\s/g, "").toUpperCase();
    if (!raw) return null;
    return subjectAccounts.get(`i:${raw}`) ?? subjectAccounts.get(`n:${accountKey(raw)}`) ?? null;
  };
  const vsOf = (t: RecordData) => (t.vs as string) || String(t.documentNum ?? "").replace(/\D/g, "").slice(-10);

  type Outcome = "matched" | "stop" | "next";
  const tryStep = async (step: RecordData | (typeof DEFAULT_STEPS)[number], line: RecordData): Promise<Outcome> => {
    const amount = toCents(line.amount);
    const incoming = amount > zero;
    const set = async (patch: RecordData): Promise<Outcome> => {
      await data.update("bank.statementLine", String(line.id), patch);
      return "matched";
    };
    switch (step.method) {
      case "vsInvoice": {
        if (!line.vs) return "next";
        // VS položky; u starších faktur bez VS číslice z čísla dokladu (stejně jako se VS dopočítává)
        let cands = (await safe(() => data.find(incoming ? "ar.trans" : "ap.trans", { kind: "invoice", closed: false }, { take: 5000 }), [] as RecordData[])).filter(
          (t) => vsOf(t) === line.vs && remaining(t) > zero,
        );
        if (step.requireAmount) cands = cands.filter((t) => remaining(t) === (incoming ? amount : -amount));
        // faktury jedné smlouvy (kalendář splátek) mají stejný VS → nejstarší neuhrazená; jinak víc dokladů = ručně
        if (cands.length > 1 && incoming) {
          const invs = await safe(() => data.find("ar.invoice", { id: { in: cands.map((t) => String(t.invoiceId ?? "")) } }, { take: 100 }), [] as RecordData[]);
          const agr = new Set(invs.map((x) => String(x.agreementId ?? "")));
          if (invs.length === cands.length && agr.size === 1 && !agr.has("")) cands = [...cands].sort((a, b) => String(a.dueDate ?? a.date).localeCompare(String(b.dueDate ?? b.date))).slice(0, 1);
        }
        if (cands.length > 1) return "stop"; // víc dokladů se stejným VS → ručně
        if (!cands.length) return "next";
        return set({ [incoming ? "customerTransId" : "vendorTransId"]: cands[0].id, matchKind: incoming ? "customer" : "vendor" });
      }
      case "vsAdvance": {
        if (!line.vs) return "next";
        const advs = await safe(() => data.find(incoming ? "ar.advance" : "ap.advance", { vs: line.vs, status: "open" }, { take: 2 }), [] as RecordData[]);
        if (advs.length > 1) return "stop";
        if (!advs.length) return "next";
        return set({ [incoming ? "customerAdvanceId" : "vendorAdvanceId"]: advs[0].id, matchKind: incoming ? "customerAdvance" : "vendorAdvance" });
      }
      case "vsAgreement": {
        // první platba smlouvy (režim Kalendář): VS smlouvy, smlouva čeká na aktivaci, částka = první splátka
        if (!line.vs || !incoming) return "next";
        const w = await safe(() => awaitingScheduleByVs(data, String(line.vs)), null);
        if (!w) return "next";
        if (step.requireAmount && toCents(w.amount) !== amount) return "next";
        return set({ agreementId: w.agreement.id, customerId: w.agreement.customerId, matchKind: "customerAgreement" });
      }
      case "vsPosReceipt": {
        // účtenka z pokladny placená QR platbou: stejný VS a přesně částka účtenky (jen příjem)
        if (!line.vs || !incoming) return "next";
        const rs = await safe(() => data.find("pos.receipt", { vs: line.vs, paymentMethod: "qr", payStatus: "awaiting" }, { take: 2 }), [] as RecordData[]);
        if (rs.length > 1) return "stop";
        if (!rs.length || toCents(rs[0].amountPaid) !== amount) return "next";
        return set({ posReceiptId: rs[0].id, matchKind: "posReceipt" });
      }
      case "counterPartner": {
        const subjectId = await subjectByAccount(line.counterAccount);
        if (!subjectId) return "next";
        // příjem → odběratel, výdaj → dodavatel subjektu
        const obj = incoming ? "ar.customer" : "ap.vendor";
        const ps = await safe(() => data.find(obj, { subjectId, blocked: false }, { take: 2 }), [] as RecordData[]);
        if (ps.length !== 1) return ps.length > 1 ? "stop" : "next";
        return set({ [incoming ? "customerId" : "vendorId"]: ps[0].id, matchKind: incoming ? "customerAccount" : "vendorAccount" });
      }
      case "rules": {
        const r = rules.find(
          (x) =>
            (x.direction === "any" || (x.direction === "in" ? incoming : !incoming)) &&
            (!x.textContains || fold(line.message).includes(fold(x.textContains))) &&
            (!x.counterContains || fold(line.counterAccount).includes(fold(x.counterContains))) &&
            (x.textContains || x.counterContains),
        );
        if (!r) return "next";
        return set({ matchKind: "rule", offsetAccountId: r.offsetAccountId, postingRuleId: r.id });
      }
    }
    return "next";
  };

  for (const line of await data.find("bank.statementLine", { statementId })) {
    if (line.matchKind && line.matchKind !== "none") continue;
    for (const step of steps) {
      const r = await tryStep(step, line);
      if (r === "matched") n++;
      if (r !== "next") break;
    }
  }
  return n;
}

/** Řádky nezaúčtovaných výpisů spárované na doklad → nespárované; u zaúčtovaného výpisu smazání odmítne. */
async function unmatchLines(data: DataApi, field: "customerAdvanceId" | "vendorAdvanceId" | "agreementId", id: string): Promise<string | void> {
  let lines: RecordData[] = [];
  try {
    lines = await data.find("bank.statementLine", { [field]: id }, { take: 200 });
  } catch {
    return; // Banka vypnutá
  }
  if (!lines.length) return;
  const sts = new Map((await data.find("bank.statement", { id: { in: [...new Set(lines.map((l) => String(l.statementId)))] } }, { take: 200 })).map((x) => [String(x.id), x]));
  const posted = lines.find((l) => sts.get(String(l.statementId))?.status === "posted");
  if (posted) throw new UserError("@BANK:DocInPostedStatement", { num: String(sts.get(String(posted.statementId))?.statementNum ?? ""), line: String(posted.lineNum ?? "") });
  for (const l of lines) await data.update("bank.statementLine", String(l.id), { [field]: null, matchKind: "none", ...(field === "agreementId" ? { customerId: null } : {}) });
}

/** Vazby výpisů na deník pryč (podle výpisu nebo deníku); zaúčtovaný deník se neodpojí. */
async function unlinkStatementJournals(data: DataApi, by: { statementId?: string; journalId?: string }) {
  const sts = by.statementId ? [await data.get("bank.statement", by.statementId)].filter((x): x is RecordData => !!x) : await data.find("bank.statement", { journalId: by.journalId }, { take: 100 });
  const lines = by.statementId ? await data.find("bank.statementLine", { statementId: by.statementId }, { take: 5000 }) : await data.find("bank.statementLine", { journalId: by.journalId }, { take: 5000 });
  const ids = new Set([...sts.map((s) => s.journalId), ...lines.map((l) => l.journalId)].filter(Boolean).map(String));
  for (const id of ids) {
    const j = await data.get("gl.journal", id);
    if (j && j.status !== "draft") throw new UserError("@BANK:UnlinkJournalPosted", { journal: String(j.journalNum ?? "") });
  }
  for (const l of lines) if (l.journalId && (!by.journalId || String(l.journalId) === by.journalId)) await data.update("bank.statementLine", String(l.id), { journalId: null });
  for (const s of sts) if (s.journalId) await data.update("bank.statement", String(s.id), { journalId: null });
}

/** Import GPC: kontrola součtů, kontrola účtu, výpis s řádky, automatické párování. */
export async function importStatement(data: DataApi, account: RecordData, file: Buffer, fileName = ""): Promise<string[]> {
  let statements: GpcStatement[] = [];
  try {
    statements = parseGpc(decodeGpc(file));
  } catch {
    statements = [];
  }
  // CSV podle specifikace výpisu na účtu
  if (!statements.length && account.statementFormatId) {
    const fmt = await data.get("bank.statementFormat", String(account.statementFormatId));
    if (fmt) {
      const def = toCsvFormat(fmt, await data.find("bank.statementFormatField", { formatId: fmt.id }, { take: 200 }));
      const st = parseCsvStatement(decodeText(file, def.encoding), def, fileName);
      if (!csvMatchesAccount(st, account) && (st.account || st.iban)) throw new UserError("@BANK:ImportOtherAccount", { file: st.iban ?? st.account, account: String(account.accountNum ?? account.iban ?? "") });
      if (st.opening + st.credit - st.debit !== st.closing) throw new UserError("@BANK:ImportCheck", { num: st.statementNum, detail: "≠" });
      statements = [st];
    }
  }
  if (!statements.length) throw new UserError("@BANK:ImportNoStatement");
  // nejdřív zkontrolovat všechny — vadný soubor se neuloží ani zčásti
  for (const s of statements) {
    const csv = "fileAccount" in s;
    const problem = csv ? null : checkStatement(s);
    if (problem) throw new UserError("@BANK:ImportCheck", { num: s.statementNum, detail: problem });
    if (!csv && account.accountNum && gpcAccountKey(String(account.accountNum)) !== s.account) {
      throw new UserError("@BANK:ImportOtherAccount", { file: s.account, account: String(account.accountNum) });
    }
    if ((await data.find("bank.statement", { bankAccountId: account.id, statementNum: s.statementNum }, { take: 1 })).length) {
      throw new UserError("@BANK:ImportDuplicate", { num: s.statementNum });
    }
  }
  const ids: string[] = [];
  for (const s of statements) {
    const st = await data.create("bank.statement", {
      bankAccountId: account.id,
      statementNum: s.statementNum,
      date: s.date,
      openingBalance: fromCents(s.opening),
    });
    for (const l of s.lines) {
      await data.create("bank.statementLine", {
        statementId: st.id,
        lineNum: l.lineNum,
        date: l.date,
        amount: fromCents(l.cents),
        vs: l.vs && /^\d{1,10}$/.test(l.vs) ? l.vs : null,
        counterAccount: l.counterAccount?.slice(0, 60) ?? null,
        message: l.message,
      });
    }
    await recalcStatement(data, String(st.id));
    await autoMatch(data, String(st.id));
    ids.push(String(st.id));
  }
  return ids;
}

/** Účet pohledávek / závazků otevřené položky (účet, na kterém vznikla — profil; jinak ze skupiny partnera). */
async function summaryAccount(data: DataApi, trans: RecordData, kind: "customer" | "vendor") {
  if (trans.accountId) return String(trans.accountId);
  const partner = await data.get(kind === "customer" ? "ar.customer" : "ap.vendor", String(trans[`${kind}Id`]));
  const group = partner ? await data.get(kind === "customer" ? "ar.group" : "ap.group", String(partner.groupId)) : null;
  const acc = group?.[kind === "customer" ? "receivableAccountId" : "payableAccountId"];
  if (!acc) throw new UserError("@SYS:InvalidValue");
  return String(acc);
}

export async function postStatement(data: DataApi, companyId: string | null, st: RecordData) {
  if (st.status !== "draft") throw new UserError("@GL:Locked");
  const account = await data.get("bank.account", String(st.bankAccountId));
  if (!account) throw new UserError("@SYS:InvalidValue");
  const lines = await data.find("bank.statementLine", { statementId: st.id }, { orderBy: { lineNum: "asc" } });
  if (!lines.length) throw new UserError("@GL:NoLines");
  const open = lines.filter((l) => !l.matchKind || l.matchKind === "none");
  if (open.length) throw new UserError("@BANK:Unmatched", { lines: open.map((l) => String(l.lineNum ?? "?")).join(", ") });

  const cur = (account.currencyId as string) ?? null;
  const posting: PostingLine[] = [];
  for (const l of lines) {
    const text = [l.vs ? `VS ${l.vs}` : null, l.message].filter(Boolean).join(" · ") || null;
    // první platba smlouvy: aktivace (objednávka K fakturaci, den platby); platba = úhrada smlouvy v saldu,
    // uhradí fakturu splátky, až se vystaví
    if (l.matchKind === "customerAgreement") {
      const agr = await activateScheduleByPayment(data, String(l.agreementId), String(l.date).slice(0, 10));
      Object.assign(l, { matchKind: "customerAccount", customerId: agr.customerId, _agreementId: agr.id });
    }
    let other: string;
    if (l.matchKind === "customer") other = await summaryAccount(data, (await data.get("ar.trans", String(l.customerTransId)))!, "customer");
    else if (l.matchKind === "vendor") other = await summaryAccount(data, (await data.get("ap.trans", String(l.vendorTransId)))!, "vendor");
    else if (l.matchKind === "customerAdvance") other = await advanceAccount(data, "customer", String(l.customerAdvanceId));
    else if (l.matchKind === "vendorAdvance") other = await advanceAccount(data, "vendor", String(l.vendorAdvanceId));
    else if (l.matchKind === "customerAccount") other = await summaryAccount(data, { customerId: l.customerId }, "customer");
    else if (l.matchKind === "vendorAccount") other = await summaryAccount(data, { vendorId: l.vendorId }, "vendor");
    else if (l.matchKind === "posReceipt") other = await posReceiptAccount(data, String(l.posReceiptId));
    else other = String(l.offsetAccountId);
    posting.push({ accountId: String(account.glAccountId), amount: String(l.amount), currencyId: cur, text });
    posting.push({ accountId: other, amount: fromCents(-toCents(l.amount)), currencyId: cur, text });
  }
  const converted = await convertLines(data, companyId, String(st.date), posting);
  const voucher = await postVoucher(data, {
    date: String(st.date),
    description: `${account.code} · ${st.statementNum}`,
    sourceObject: "bank.statement",
    sourceId: String(st.id),
    lines: converted,
  });

  // úhrady do salda: položka „Úhrada“ + navýšení Uhrazeno u faktury
  const pendingAgreements: ["customer" | "vendor", string][] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // QR platba účtenky z pokladny: účtenka je zaplacená
    if (l.matchKind === "posReceipt") {
      await data.update("pos.receipt", String(l.posReceiptId), { payStatus: "paid", paidDate: l.date });
      continue;
    }
    if (l.matchKind === "customerAdvance" || l.matchKind === "vendorAdvance") {
      const isCust = l.matchKind === "customerAdvance";
      const sign = isCust ? BigInt(1) : BigInt(-1);
      await recordAdvancePayment(data, isCust ? "customer" : "vendor", String(isCust ? l.customerAdvanceId : l.vendorAdvanceId), {
        paidCur: sign * toCents(l.amount),
        paidAcc: sign * toCents(converted[i * 2].amount),
        voucherId: String(voucher.id),
        documentNum: `${account.code}/${st.statementNum}/${l.lineNum ?? i + 1}`,
        date: l.date,
        vs: l.vs ?? null,
        currencyId: cur,
      });
      // výzva smlouvy: aktivace na zaplacené období + faktura (výnos / náklad)
      await agreementAdvancePaid(data, isCust ? "customer" : "vendor", String(isCust ? l.customerAdvanceId : l.vendorAdvanceId));
      continue;
    }
    // úhrada partnera bez faktury: položka „Úhrada“ v saldu (spáruje se později)
    if (l.matchKind === "customerAccount" || l.matchKind === "vendorAccount") {
      const isCust = l.matchKind === "customerAccount";
      const paid = isCust ? toCents(l.amount) : -toCents(l.amount);
      const paidAcc = isCust ? toCents(converted[i * 2].amount) : -toCents(converted[i * 2].amount);
      await data.create(isCust ? "ar.trans" : "ap.trans", {
        [isCust ? "customerId" : "vendorId"]: isCust ? l.customerId : l.vendorId,
        kind: "payment",
        ...(isCust && l._agreementId ? { agreementId: l._agreementId } : {}),
        voucherId: voucher.id,
        documentNum: `${account.code}/${st.statementNum}/${l.lineNum ?? i + 1}`,
        vs: l.vs ?? null,
        date: l.date,
        currencyId: cur,
        amount: fromCents(-paidAcc),
        amountCur: fromCents(-paid),
        paidAmount: "0",
        closed: false,
      });
      continue;
    }
    if (l.matchKind !== "customer" && l.matchKind !== "vendor") continue;
    const isCust = l.matchKind === "customer";
    const obj = isCust ? "ar.trans" : "ap.trans";
    const partnerField = isCust ? "customerId" : "vendorId";
    const inv = (await data.get(obj, String(isCust ? l.customerTransId : l.vendorTransId)))!;
    const paid = isCust ? toCents(l.amount) : -toCents(l.amount); // kladná uhrazená částka
    const paidAcc = isCust ? toCents(converted[i * 2].amount) : -toCents(converted[i * 2].amount);
    const newPaid = toCents(inv.paidAmount) + paid;
    await data.update(obj, String(inv.id), {
      paidAmount: fromCents(newPaid),
      closed: newPaid >= toCents(inv.amountCur ?? inv.amount),
    });
    if (inv.invoiceId) await data.update(isCust ? "ar.invoice" : "ap.invoice", String(inv.invoiceId), { paidAmount: fromCents(newPaid) });
    // faktura smlouvy (kalendář): zaplaceno do, odblokování
    if (inv.invoiceId) pendingAgreements.push([isCust ? "customer" : "vendor", String(inv.invoiceId)]);
    await data.create(obj, {
      [partnerField]: inv[partnerField],
      kind: "payment",
      invoiceId: inv.invoiceId ?? null,
      voucherId: voucher.id,
      documentNum: `${account.code}/${st.statementNum}/${l.lineNum ?? i + 1}`,
      vs: l.vs ?? null,
      date: l.date,
      currencyId: cur ?? inv.currencyId ?? null,
      amount: fromCents(-paidAcc),
      amountCur: fromCents(-paid),
      paidAmount: "0",
      closed: true,
    });
  }
  for (const [kind, invoiceId] of pendingAgreements) await agreementInvoicePaid(data, kind, invoiceId);
  await data.update("bank.statement", String(st.id), { status: "posted", voucherId: voucher.id });
}

export const bankHandlers: Record<string, ObjectHandlers> = {
  "bank.importLog": {
    actions: {
      /** z protokolu importu: smazat nahraný výpis (i hromadně), jinak jen řádek protokolu */
      async deleteStatement(ctx, log) {
        if (log.statementId) await ctx.data.remove("bank.statement", String(log.statementId));
        if (await ctx.data.get("bank.importLog", String(log.id))) await ctx.data.remove("bank.importLog", String(log.id));
      },
    },
  },
  "bank.account": {
    async beforeSave(ctx, d) {
      // české číslo účtu → IBAN (dopočítá se sám)
      d.iban = ibanFor(d, d.id ? await ctx.data.get("bank.account", String(d.id)) : null);
      // výchozí jen jeden na měnu (prázdná měna = účetní měna)
      if (d.isDefault) {
        const base = await accountingCurrencyId(ctx.data, ctx.companyId);
        const cur = (d.currencyId as string) || base;
        for (const o of await ctx.data.find("bank.account", { isDefault: true }, { take: 50 }))
          if (o.id !== d.id && ((o.currencyId as string) || base) === cur) await ctx.data.update("bank.account", String(o.id), { isDefault: false });
      }
    },
    actions: {
      async import(ctx, account, file) {
        if (!file) throw new UserError("@SYS:Required");
        await importStatement(ctx.data, account, file.data, file.name);
      },
    },
  },
  /** Smazání rozpracovaného deníku vytvořeného z výpisu: výpis a jeho řádky zapomenou vazbu (deník jde vytvořit znovu). */
  // smazání nezaplacené zálohy / smlouvy: řádky nezaúčtovaných výpisů spárované na ni se odpárují (zaúčtovaný výpis ji drží)
  "ar.advance": { beforeDelete: (ctx, d) => unmatchLines(ctx.data, "customerAdvanceId", String(d.id)) },
  "ap.advance": { beforeDelete: (ctx, d) => unmatchLines(ctx.data, "vendorAdvanceId", String(d.id)) },
  "ar.agreement": { beforeDelete: (ctx, d) => unmatchLines(ctx.data, "agreementId", String(d.id)) },
  "gl.journal": {
    async beforeDelete(ctx, j) {
      if (j.status && j.status !== "draft") return;
      await unlinkStatementJournals(ctx.data, { journalId: String(j.id) });
    },
  },
  "bank.statement": {
    /**
     * Smazání importovaného výpisu (nezaúčtovaného): rozpracovaný deník z výpisu se smaže s ním,
     * zaúčtovaný deník výpis drží; protokol importu výpisu se smaže (výpis jde nahrát znovu).
     */
    async beforeDelete(ctx, st) {
      if (st.journalId) {
        const j = await ctx.data.get("gl.journal", String(st.journalId));
        if (j && j.status !== "draft") return "@BANK:StatementJournalPosted";
      }
      // odpoutat řádky od deníku, pak deník smazat
      for (const l of await ctx.data.find("bank.statementLine", { statementId: st.id }, { take: 5000 }))
        if (l.journalId) await ctx.data.update("bank.statementLine", String(l.id), { journalId: null });
      if (st.journalId) {
        await ctx.data.update("bank.statement", String(st.id), { journalId: null });
        await ctx.data.remove("gl.journal", String(st.journalId)).catch(() => undefined);
      }
      for (const log of await ctx.data.find("bank.importLog", { statementId: st.id }, { take: 50 })) await ctx.data.remove("bank.importLog", String(log.id));
    },
    actions: {
      async match(ctx, st) {
        await autoMatch(ctx.data, String(st.id));
      },
      async post(ctx, st) {
        await postStatement(ctx.data, ctx.companyId, st);
      },
      async createJournal(ctx, st) {
        await journalFromStatement(ctx.data, st, ctx.t);
      },
      /** Odpojit deník: výpis i řádky bez vazby na deník (deník zůstane); zaúčtovaný deník ne */
      async unlinkJournal(ctx, st) {
        await unlinkStatementJournals(ctx.data, { statementId: String(st.id) });
      },
      async recheck(ctx, st) {
        await checkStatementChain(ctx.data, st, ctx.t);
      },
    },
  },
  "bank.statementLine": {
    actions: {
      /** vybrané řádky → deník banky (doplní se do rozpracovaného deníku výpisu) */
      async createJournal(ctx, line) {
        const st = await ctx.data.get("bank.statement", String(line.statementId));
        if (!st) throw new UserError("@SYS:InvalidValue");
        await journalFromStatement(ctx.data, st, ctx.t, [line]);
      },
    },
    /** nejvýš jedna vazba; druh párování podle vyplněné vazby; směr musí sedět */
    async beforeSave(ctx, data): Promise<ValidationErrors | void> {
      await assertDraft(ctx.data, data.statementId);
      // ruční vazba na doklad nahradí účet z předkontace
      if (data.postingRuleId && ["customerTransId", "vendorTransId", "customerAdvanceId", "vendorAdvanceId", "customerId", "vendorId", "posReceiptId"].some((f) => data[f])) {
        data.offsetAccountId = null;
        data.postingRuleId = null;
      }
      // konkrétní doklad má přednost před partnerem bez faktury
      if ((data.customerTransId || data.customerAdvanceId) && data.customerId) data.customerId = null;
      if ((data.vendorTransId || data.vendorAdvanceId) && data.vendorId) data.vendorId = null;
      const filled = ["customerTransId", "vendorTransId", "customerAdvanceId", "vendorAdvanceId", "customerId", "vendorId", "posReceiptId", "offsetAccountId"].filter((f) => data[f]);
      if (filled.length > 1) return { [filled[1]]: "@BANK:OneMatch" };
      const amount = toCents(data.amount);
      if (data.customerTransId && amount < zero) return { customerTransId: "@BANK:WrongDirection" };
      if (data.vendorTransId && amount > zero) return { vendorTransId: "@BANK:WrongDirection" };
      if (data.customerAdvanceId && amount < zero) return { customerAdvanceId: "@BANK:WrongDirection" };
      if (data.vendorAdvanceId && amount > zero) return { vendorAdvanceId: "@BANK:WrongDirection" };
      if (data.customerId && amount < zero) return { customerId: "@BANK:WrongDirection" };
      if (data.vendorId && amount > zero) return { vendorId: "@BANK:WrongDirection" };
      if (data.posReceiptId) {
        if (amount < zero) return { posReceiptId: "@BANK:WrongDirection" };
        const r = await ctx.data.get("pos.receipt", String(data.posReceiptId));
        if (!r || r.paymentMethod !== "qr" || r.payStatus !== "awaiting") throw new UserError("@BANK:PosReceiptClosed", { doc: String(r?.receiptNum ?? "") });
        if (toCents(r.amountPaid) !== amount) throw new UserError("@BANK:PosReceiptAmount", { doc: String(r.receiptNum), amount: String(r.amountPaid) });
      }
      for (const [f, obj] of [["customerAdvanceId", "ar.advance"], ["vendorAdvanceId", "ap.advance"]] as const) {
        if (!data[f]) continue;
        const a = await ctx.data.get(obj, String(data[f]));
        if (!a || a.status === "settled" || a.status === "cancelled") throw new UserError("@BANK:AdvanceClosed", { doc: String(a?.advanceNum ?? "") });
      }
      for (const [f, obj] of [["customerTransId", "ar.trans"], ["vendorTransId", "ap.trans"]] as const) {
        if (!data[f]) continue;
        const t = await ctx.data.get(obj, String(data[f]));
        if (t?.closed) throw new UserError("@BANK:TransClosed", { doc: String(t.documentNum) });
      }
      data.matchKind = data.customerTransId
        ? "customer"
        : data.vendorTransId
          ? "vendor"
          : data.customerAdvanceId
            ? "customerAdvance"
            : data.vendorAdvanceId
              ? "vendorAdvance"
              : data.agreementId
                ? "customerAgreement"
              : data.customerId
                ? "customerAccount"
                : data.vendorId
                  ? "vendorAccount"
                  : data.posReceiptId
                    ? "posReceipt"
                  : data.offsetAccountId
                ? data.postingRuleId
                  ? "rule"
                  : "ledger"
                : "none";
      if (!data.offsetAccountId) data.postingRuleId = null;
    },
    async afterSave(ctx, data) {
      await recalcStatement(ctx.data, String(data.statementId));
    },
    beforeDelete: async (ctx, data) => {
      await assertDraft(ctx.data, data.statementId);
    },
    async afterDelete(ctx, data) {
      await recalcStatement(ctx.data, String(data.statementId));
    },
  },
};
