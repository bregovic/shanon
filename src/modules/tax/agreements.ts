/**
 * Smlouvy partnerů (prodejní / nákupní) — předplatné na období (členství, nájem, servis).
 * Stavba společná pro odběratele i dodavatele, objekt vzniká v továrně `partner-ledger.ts`.
 *
 * Smlouva:  Koncept → Vyzvat k platbě (objednávka + záloha s VS a QR na jedno období) → Čeká na platbu
 *           → banka spáruje zálohu → Aktivní do konce zaplaceného období (faktura z objednávky se sama
 *           zaúčtuje proti záloze = výnos / náklad) → dávka před koncem období vystaví další výzvu
 *           → nezaplacená výzva po lhůtě (parametry) = Blokovaná; zaplacením se smlouva zase aktivuje.
 *
 * Objednávka, záloha a faktura jsou ty běžné — smlouva jen řídí, kdy vzniknou (`agreementId`).
 *
 * Režim „Kalendář“ (parametr `agreementMode = schedule`, např. fitness): bez zálohy. Výzva = kalendář splátek
 * (`<m>.agreementLine`, měsíční / roční podle `periodMonths`) a VS smlouvy (číslice čísla smlouvy). První platba
 * s VS smlouvy (banka, krok „VS smlouvy“) nebo ruční Aktivovat → objednávka + zaúčtovaná faktura první splátky,
 * smlouva Aktivní. Dávka pak vystavuje další splátky podle kalendáře (objednávka → faktura = pohledávka, VS smlouvy).
 * Neuhrazená faktura po splatnosti + lhůtě (parametry) = Blokovaná: další splátky se nevystavují, úhradou se odblokuje.
 */
import { fromCents, toCents } from "@/core/money";
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { UserError, type DataApi, type EventContext, type ObjectHandlers, type RecordData, type ValidationErrors } from "@/core/module";
import { defineObject } from "@/core/object";
import { accountingCurrencyId } from "@/modules/gl/posting";
import { postInvoice } from "./document";
import { invoiceFromOrder, type OrderDocs } from "./orders";

export const AgreementStatus = defineEnum({
  id: "AgreementStatus",
  label: "@TAX:AgreementStatus",
  values: [
    { value: "draft", label: "@TAX:AgrDraft" },
    { value: "awaiting", label: "@TAX:AgrAwaiting", color: "warning" },
    { value: "active", label: "@TAX:AgrActive", color: "success" },
    { value: "blocked", label: "@TAX:AgrBlocked", color: "danger" },
    { value: "ended", label: "@TAX:AgrEnded" },
  ],
});

export const AgreementLineStatus = defineEnum({
  id: "AgreementLineStatus",
  label: "@TAX:AgrLineStatus",
  values: [
    { value: "planned", label: "@TAX:AgrLinePlanned" },
    { value: "invoiced", label: "@TAX:AgrLineInvoiced", color: "warning" },
    { value: "paid", label: "@TAX:AgrLinePaid", color: "success" },
    { value: "cancelled", label: "@TAX:AgrLineCancelled" },
  ],
});

export const AgreementMode = defineEnum({
  id: "AgreementMode",
  label: "@TAX:AgrMode",
  values: [
    { value: "advance", label: "@TAX:AgrModeAdvance" },
    { value: "schedule", label: "@TAX:AgrModeSchedule" },
  ],
});

export interface AgreementDocs extends OrderDocs {
  agreementLine: string;
  agreement: string;
  parameters: string;
  partnerField: string;
  /** prodej: cena za období je s DPH (objednávka `pricesInclTax`) */
  sales: boolean;
}

/** Továrna partnerů zapíše své smlouvy sem — banka pak podle druhu zálohy najde, co aktivovat. */
const REGISTRY: Partial<Record<"customer" | "vendor", AgreementDocs>> = {};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: unknown) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const addDays = (date: string, n: number) => {
  const d = day(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
/** konec období: od + N měsíců − 1 den (31. 1. + 1 měsíc → 28./29. 2.) */
export function periodEnd(from: string, months: number): string {
  const d = day(from);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return addDays(iso(target), -1);
}

export function agreementObject(m: string, L: (k: string) => string, partnerId: string, partnerObject: string, seq: string) {
  return defineObject({
    id: `${m}.agreement`,
    table: `${m}_agreement`,
    label: L("Agreement"),
    labelPlural: L("Agreements"),
    scope: "company",
    fields: {
      agreementNum: { edt: Edts.Code, label: "@TAX:AgreementNum", mandatory: true, readOnly: true },
      [partnerId]: { edt: refEdt(partnerObject, L("Partner")), mandatory: true },
      itemId: { edt: refEdt("inv.item", "@TAX:AgrTariff"), optionalRef: true },
      description: { edt: Edts.Description },
      // povinná, ale doplní se z tarifu — kontrola až v beforeSave
      amount: { edt: Edts.Amount, label: "@TAX:AgrAmount", help: "@TAX:AgrAmountHelp" },
      currencyId: { edt: refEdt("sys.currency", "@SYS:Currency") },
      periodMonths: { edt: Edts.Int, label: "@TAX:AgrMonths", mandatory: true, default: 1 },
      /** počet karet / osob – u tarifu „za kartu“ je cena smlouvy cena tarifu × počet */
      quantity: { edt: Edts.Int, label: "@TAX:AgrQuantity", default: 1, help: "@TAX:AgrQuantityHelp" },
      startDate: { edt: Edts.TransDate, label: "@TAX:AgrStart", mandatory: true, default: "$today" },
      /** začátek dnem první platby (portál bez zadaného počátku): aktivace posune začátek i kalendář */
      startOnPayment: { edt: Edts.NoYes, label: "@TAX:AgrStartOnPayment", help: "@TAX:AgrStartOnPaymentHelp" },
      endDate: { edt: Edts.TransDate, label: "@TAX:AgrEnd", help: "@TAX:AgrEndHelp" },
      autoRenew: { edt: Edts.NoYes, label: "@TAX:AgrAutoRenew", default: true },
      status: { edt: enumEdt(AgreementStatus), mandatory: true, default: "draft", readOnly: true },
      paidUntil: { edt: Edts.TransDate, label: "@TAX:AgrPaidUntil", readOnly: true },
      periodFrom: { edt: Edts.TransDate, label: "@TAX:AgrPeriodFrom", readOnly: true },
      periodTo: { edt: Edts.TransDate, label: "@TAX:AgrPeriodTo", readOnly: true },
      dueDate: { edt: Edts.TransDate, label: "@TAX:DueDate", readOnly: true },
      /** VS plateb (číslice čísla smlouvy) – platby i faktury kalendáře */
      /** VS z čísla smlouvy, jde přepsat (jen číslice); páruje platby smlouvy */
      vs: { edt: defineEdt({ id: "AgrVs", kind: "string", label: "@TAX:Vs", maxLength: 10, pattern: /^\d{0,10}$/ }), help: "@TAX:AgrVsHelp" },
      /** číslo členské karty (fitness, klub) */
      cardNumber: { edt: defineEdt({ id: "AgrCardNumber", kind: "string", label: "@TAX:AgrCardNumber", maxLength: 40, transform: "trim" }) },
      orderId: { edt: refEdt(`${m}.order`, L("Order")), readOnly: true },
      advanceId: { edt: refEdt(`${m}.advance`, L("Advance")), readOnly: true },
      blockedDate: { edt: Edts.TransDate, label: "@TAX:AgrBlockedDate", readOnly: true },
      /** platba kartou bránou (portál): zahájení v protokolu napojení */
      paymentLogId: { edt: refEdt("int.log", "@TAX:AgrPaymentLog"), readOnly: true, optionalRef: true },
      signedAt: { edt: Edts.DateTime, label: "@TAX:AgrSignedAt", readOnly: true },
      terms: { edt: Edts.Notes, label: "@TAX:AgrTerms", readOnly: true },
      /** odpovědi z formuláře portálu: JSON {klíč: hodnota} (tisk {form.<klíč>}) a čitelně „Popisek: hodnota“ */
      formData: { edt: Edts.Notes, label: "@TAX:AgrFormData", readOnly: true },
      formText: { edt: Edts.Notes, label: "@TAX:AgrFormText", readOnly: true },
      notes: { edt: Edts.Notes },
    },
    titleField: "agreementNum",
    titleRef: partnerId,
    list: ["agreementNum", partnerId, "itemId", "amount", "periodMonths", "startDate", "paidUntil", "dueDate", "status"],
    form: [
      { label: "@TAX:Header", fields: ["agreementNum", partnerId, "itemId", "description", "status", "vs", "cardNumber"] },
      { label: "@TAX:AgrTerm", fields: ["quantity", "amount", "currencyId", "periodMonths", "startDate", "startOnPayment", "endDate", "autoRenew"] },
      { label: "@TAX:AgrPayment", fields: ["paidUntil", "periodFrom", "periodTo", "dueDate", "orderId", "advanceId", "blockedDate", "paymentLogId"] },
      { label: "@TAX:AgrSigned", fields: ["signedAt", "formText", "terms", "notes"] },
    ],
    numberSeq: { field: "agreementNum", seq },
    lines: [{ object: `${m}.agreementLine`, field: "agreementId", label: "@TAX:AgrSchedule" }],
    defaultSort: { field: "startDate", dir: "desc" },
    indexes: [["status"]],
    related: [
      { object: `${m}.order`, field: "agreementId", label: L("Orders") },
      { object: `${m}.advance`, field: "agreementId", label: L("Advances") },
      { object: `${m}.invoice`, field: "agreementId", label: L("Invoices") },
    ],
    actions: [
      { id: "requestPayment", label: "@TAX:AgrRequestPayment" },
      { id: "activate", label: "@TAX:AgrActivate" },
      { id: "end", label: "@TAX:AgrEndAction" },
    ],
    lockedWhen: { field: "status", equals: "ended" },
  });
}

/** Kalendář splátek smlouvy (režim Kalendář): co se kdy vystaví a jestli je zaplaceno. */
export function agreementLineObject(m: string, L: (k: string) => string) {
  return defineObject({
    id: `${m}.agreementLine`,
    table: `${m}_agreement_line`,
    label: "@TAX:AgrScheduleLine",
    labelPlural: "@TAX:AgrSchedule",
    scope: "company",
    systemOnly: true,
    fields: {
      agreementId: { edt: refEdt(`${m}.agreement`, L("Agreement")), mandatory: true },
      lineNum: { edt: Edts.Int, label: "@TAX:AgrLineNum", mandatory: true },
      periodFrom: { edt: Edts.TransDate, label: "@TAX:AgrPeriodFrom", mandatory: true },
      periodTo: { edt: Edts.TransDate, label: "@TAX:AgrPeriodTo", mandatory: true },
      amount: { edt: Edts.Amount, label: "@TAX:AgrAmount", mandatory: true },
      status: { edt: enumEdt(AgreementLineStatus), mandatory: true, default: "planned" },
      orderId: { edt: refEdt(`${m}.order`, L("Order")) },
      invoiceId: { edt: refEdt(`${m}.invoice`, L("Invoice")) },
      dueDate: { edt: Edts.TransDate, label: "@TAX:DueDate" },
    },
    titleField: "lineNum",
    list: ["lineNum", "periodFrom", "periodTo", "amount", "status", "invoiceId", "dueDate"],
    form: [{ label: "@SYS:General", fields: ["agreementId", "lineNum", "periodFrom", "periodTo", "amount", "status", "orderId", "invoiceId", "dueDate"] }],
    defaultSort: { field: "lineNum", dir: "asc" },
    indexes: [["agreementId", "status"]],
  });
}

/** Řádek objednávky: počet karet × cena za kartu, když částka jde dělit beze zbytku; jinak 1 × částka. */
function lineQty(agr: RecordData, amount: unknown) {
  const q = Math.max(1, Number(agr.quantity ?? 1) || 1);
  const c = toCents(String(amount ?? "0"));
  return q > 1 && c % BigInt(q) === BigInt(0) ? { qty: q, unitPrice: fromCents(c / BigInt(q)) } : { qty: 1, unitPrice: amount };
}

/** Parametry smluv (z parametrů modulu; bez nich výchozí hodnoty). */
async function agreementParams(data: DataApi, docs: AgreementDocs) {
  const [p] = await data.find(docs.parameters, {}, { take: 1 }).catch(() => [] as RecordData[]);
  const num = (v: unknown, d: number) => (v === null || v === undefined || v === "" ? d : Math.max(0, Number(v)));
  return { dueDays: num(p?.agreementDueDays, 7), blockDays: num(p?.agreementBlockDays, 14), renewDays: num(p?.agreementRenewDays, 14), schedule: p?.agreementMode === "schedule" };
}

/**
 * Výzva k platbě na další období: objednávka s jedním řádkem (tarif) a záloha na její částku.
 * Období navazuje na zaplacené (jinak od začátku smlouvy, nejdřív dnes).
 */
export async function requestAgreementPayment(data: DataApi, docs: AgreementDocs, agr: RecordData, today = iso(new Date())) {
  if (agr.status === "ended") throw new UserError("@GL:Locked");
  if ((await agreementParams(data, docs)).schedule) {
    await requestSchedulePayment(data, docs, agr, today);
    return { order: null as unknown as RecordData, advance: null as unknown as RecordData };
  }
  const pf = docs.partnerField;
  if (agr.advanceId) {
    const pending = await data.get(docs.advance, String(agr.advanceId));
    if (pending && pending.status === "open") throw new UserError("@TAX:AgrPending", { num: String(pending.advanceNum ?? "") });
  }
  const months = Math.max(1, Number(agr.periodMonths ?? 1));
  const from = agr.paidUntil ? addDays(String(agr.paidUntil).slice(0, 10), 1) : String(agr.startDate ?? today).slice(0, 10) < today ? today : String(agr.startDate).slice(0, 10);
  if (agr.endDate && from > String(agr.endDate).slice(0, 10)) throw new UserError("@TAX:AgrBeyondEnd");
  const to = periodEnd(from, months);
  const prm = await agreementParams(data, docs);
  const text = `${agr.description || agr.agreementNum} · ${from.split("-").reverse().join(". ")} – ${to.split("-").reverse().join(". ")}`.replace(/\b0(\d)\./g, "$1.");
  const order = await data.create(docs.order, {
    [pf]: agr[pf],
    currencyId: agr.currencyId ?? null,
    ...(docs.sales ? { pricesInclTax: true } : {}),
    description: text.slice(0, 255),
    agreementId: agr.id,
  });
  await data.create(docs.orderLine, {
    orderId: order.id,
    itemId: agr.itemId ?? null,
    description: text.slice(0, 255),
    ...lineQty(agr, agr.amount),
  });
  const o = (await data.get(docs.order, String(order.id)))!;
  if (toCents(o.amountGross) <= BigInt(0)) throw new UserError("@GL:NoLines");
  await data.update(docs.order, String(o.id), { status: "confirmed" });
  const adv = await data.create(docs.advance, {
    [pf]: agr[pf],
    orderId: o.id,
    currencyId: o.currencyId ?? null,
    description: text.slice(0, 255),
    amount: o.amountGross,
    issueDate: today,
    dueDate: addDays(today, prm.dueDays),
    agreementId: agr.id,
  });
  await data.update(docs.agreement, String(agr.id), {
    status: agr.status === "active" ? "active" : "awaiting",
    orderId: o.id,
    advanceId: adv.id,
    periodFrom: from,
    periodTo: to,
    dueDate: adv.dueDate ?? addDays(today, prm.dueDays),
  });
  return { order: o, advance: adv };
}

/**
 * Banka zaúčtovala úhradu zálohy: když je to výzva smlouvy a je zaplacená celá, smlouva je aktivní
 * do konce období a z objednávky vznikne zaúčtovaná faktura (záloha se v ní odečte).
 */
export async function agreementAdvancePaid(data: DataApi, kind: "customer" | "vendor", advanceId: string) {
  const docs = REGISTRY[kind];
  if (!docs) return;
  const adv = await data.get(docs.advance, advanceId);
  if (!adv?.agreementId) return;
  if (toCents(adv.paidAmount) < toCents(adv.amount)) return; // zatím jen část
  const agr = await data.get(docs.agreement, String(adv.agreementId));
  if (!agr || agr.advanceId !== adv.id) return;
  await data.update(docs.agreement, String(agr.id), { status: "active", paidUntil: agr.periodTo, blockedDate: null });
  const order = adv.orderId ? await data.get(docs.order, String(adv.orderId)) : null;
  if (!order || order.status === "invoiced" || order.status === "cancelled") return;
  const inv = await invoiceFromOrder(data, docs, order);
  await postInvoice(data, data.companyId ?? null, docs.cfg, (await data.get(docs.cfg.header, String(inv.id)))!);
}

/** Stav smlouvy podle zaplaceného období a výzvy (dávka i ruční kontrola). */
export function agreementState(agr: RecordData, pending: RecordData | null, today: string, blockDays: number): string {
  if (agr.status === "ended" || agr.status === "draft") return String(agr.status);
  const paidUntil = agr.paidUntil ? String(agr.paidUntil).slice(0, 10) : null;
  if (agr.endDate && paidUntil && paidUntil >= String(agr.endDate).slice(0, 10) && today > String(agr.endDate).slice(0, 10)) return "ended";
  if (paidUntil && paidUntil >= today) return "active";
  const open = pending && pending.status === "open";
  if (!open) return paidUntil ? "awaiting" : String(agr.status);
  const due = String(pending!.dueDate ?? agr.dueDate ?? today).slice(0, 10);
  return addDays(due, blockDays) < today ? "blocked" : "awaiting";
}

/** Dávka: další výzva před koncem zaplaceného období, blokace po lhůtě, konec smlouvy. */
export async function runAgreements(data: DataApi, docs: AgreementDocs, today = iso(new Date())) {
  const prm = await agreementParams(data, docs);
  if (prm.schedule) return runSchedules(data, docs, today, prm);
  let issued = 0, blocked = 0;
  for (const status of ["active", "awaiting", "blocked"]) {
    for (const agr of await data.find(docs.agreement, { status }, { take: 1000 })) {
      const pending = agr.advanceId ? await data.get(docs.advance, String(agr.advanceId)) : null;
      const paidUntil = agr.paidUntil ? String(agr.paidUntil).slice(0, 10) : null;
      const ended = agr.endDate && paidUntil && paidUntil >= String(agr.endDate).slice(0, 10);
      // další období: zaplacené brzy skončí, výzva na něj ještě není
      if (agr.autoRenew && paidUntil && !ended && (!pending || pending.status !== "open") && addDays(paidUntil, -prm.renewDays) <= today) {
        try {
          await requestAgreementPayment(data, docs, agr, today);
          issued++;
        } catch {
          /* tarif bez ceny, konec smlouvy — smlouva zůstane, jak je */
        }
      }
      const fresh = (await data.get(docs.agreement, String(agr.id)))!;
      const pend = fresh.advanceId ? await data.get(docs.advance, String(fresh.advanceId)) : null;
      const next = agreementState(fresh, pend, today, prm.blockDays);
      if (next !== fresh.status) {
        await data.update(docs.agreement, String(fresh.id), { status: next, blockedDate: next === "blocked" ? today : null });
        if (next === "blocked") blocked++;
      }
    }
  }
  return { issued, blocked };
}

export function agreementHandlers(docs: AgreementDocs): Record<string, ObjectHandlers> {
  REGISTRY[docs.sales ? "customer" : "vendor"] = docs;
  const pf = docs.partnerField;
  return {
    [docs.agreement]: {
      async beforeSave(ctx: EventContext, d: RecordData, isNew: boolean): Promise<ValidationErrors | void> {
        // tarif: cena, délka období a popis z položky (jen nevyplněné)
        const qty = Math.max(1, Math.round(Number(d.quantity ?? 1)) || 1);
        d.quantity = qty;
        const perUnit = d.itemId ? await ctx.data.get("inv.item", String(d.itemId)) : null;
        if (perUnit?.agreementPerUnit) {
          // tarif za kartu: cena smlouvy = cena tarifu × počet karet (přepočte se při každé změně)
          const pos = (v: unknown) => (v !== null && v !== undefined && v !== "" && toCents(String(v)) > BigInt(0) ? String(v) : null);
          const unit = (docs.sales ? pos(perUnit.priceGross) : pos(perUnit.purchasePrice)) ?? pos(perUnit.salesPrice);
          if (unit) d.amount = fromCents(toCents(unit) * BigInt(qty));
        }
        if (d.itemId && (isNew || !d.amount)) {
          const it = perUnit ?? (await ctx.data.get("inv.item", String(d.itemId)));
          if (it) {
            if (!d.amount || !toCents(d.amount)) {
              // první nenulová cena: prodej s DPH, nákup bez DPH, jinak prodejní cena položky
              const pos = (v: unknown) => (v !== null && v !== undefined && v !== "" && toCents(String(v)) > BigInt(0) ? String(v) : null);
              d.amount = (docs.sales ? pos(it.priceGross) : pos(it.purchasePrice)) ?? pos(it.salesPrice);
            }
            if (it.agreementMonths && isNew) d.periodMonths = it.agreementMonths;
            if (!d.description) d.description = it.name;
          }
        }
        if (d.periodMonths === null || d.periodMonths === undefined || d.periodMonths === "") d.periodMonths = 1;
        if (Number(d.periodMonths) < 1) return { periodMonths: "@SYS:InvalidValue" };
        // ručně změněný VS: jedinečný mezi smlouvami (páruje platby)
        if (d.vs) {
          d.vs = String(d.vs).replace(/\s/g, "");
          if ((await ctx.data.find(docs.agreement, { vs: d.vs }, { take: 2 })).some((x) => x.id !== d.id)) return { vs: "@TAX:AgrVsTaken" };
        }
        if (d.endDate && d.startDate && String(d.endDate) < String(d.startDate)) return { endDate: "@SYS:InvalidValue" };
        if (!d.amount || toCents(d.amount) <= BigInt(0)) return { amount: "@SYS:Required" };
        if (isNew && !d.currencyId && d[pf]) {
          const p = await ctx.data.get(docs.cfg.partnerObject, String(d[pf]));
          d.currencyId = p?.currencyId ?? (await accountingCurrencyId(ctx.data, ctx.companyId));
        }
      },
      async afterSave(ctx: EventContext, d: RecordData) {
        // VS = číslice čísla smlouvy (SM2600012 → 2600012), jednou provždy
        if (!d.vs && d.agreementNum) {
          const vs = String(d.agreementNum).replace(/\D/g, "").slice(-10);
          if (vs) await ctx.data.update(docs.agreement, String(d.id), { vs });
        }
      },
      actions: {
        async requestPayment(ctx: EventContext, agr: RecordData) {
          await requestAgreementPayment(ctx.data, docs, agr);
        },
        /** zaplaceno na místě (karta, hotovost): první splátka se vyfakturuje, smlouva je aktivní */
        async activate(ctx: EventContext, agr: RecordData) {
          if (!(await agreementParams(ctx.data, docs)).schedule) throw new UserError("@TAX:AgrActivateMode");
          await activateSchedule(ctx.data, docs, agr);
        },
        async end(ctx: EventContext, agr: RecordData) {
          const today = iso(new Date());
          // kalendář: nevystavené splátky se zruší
          for (const ln of await ctx.data.find(docs.agreementLine, { agreementId: agr.id, status: "planned" }, { take: 500 })) await ctx.data.update(docs.agreementLine, String(ln.id), { status: "cancelled" });
          if (agr.advanceId) {
            const pend = await ctx.data.get(docs.advance, String(agr.advanceId));
            // nezaplacená výzva se zruší i s objednávkou
            if (pend && pend.status === "open" && !toCents(pend.paidAmount)) {
              await ctx.data.update(docs.advance, String(pend.id), { status: "cancelled" });
              if (pend.orderId) await ctx.data.update(docs.order, String(pend.orderId), { status: "cancelled" });
            }
          }
          await ctx.data.update(docs.agreement, String(agr.id), { status: "ended", endDate: agr.endDate ?? (agr.paidUntil && String(agr.paidUntil) > today ? agr.paidUntil : today) });
        },
      },
    },
  };
}

/**
 * Mazání nezaúčtovaných dokladů smlouvy. Smlouva, její objednávka a záloha na sebe odkazují navzájem
 * (smlouva → objednávka / záloha, ty → smlouva, záloha → objednávka), takže bez téhle obsluhy databáze
 * smazání odmítla („záznam se používá“), i když nic nebylo zaúčtované.
 *  - záloha: zaplacená ne; nezaplacená → smlouva ji přestane čekat (bez zaplaceného období zpět do konceptu)
 *  - objednávka: s ní i její nezaplacené zálohy (zaplacená záloha smazání zastaví), smlouva ji zapomene
 *  - smlouva: jen bez faktur a zaplacených záloh (jinak Ukončit); smažou se i její objednávky a zálohy
 */
export function agreementDeleteHooks(docs: AgreementDocs) {
  const forget = async (data: DataApi, field: "orderId" | "advanceId", id: string) => {
    for (const agr of await data.find(docs.agreement, { [field]: id }, { take: 50 })) {
      const patch: RecordData = { [field]: null };
      if (field === "advanceId" && agr.status === "awaiting" && !agr.paidUntil) Object.assign(patch, { status: "draft", dueDate: null, periodFrom: null, periodTo: null });
      await data.update(docs.agreement, String(agr.id), patch);
    }
  };
  const paid = (a: RecordData) => toCents(a.paidAmount) > BigInt(0);
  return {
    async advance(ctx: EventContext, d: RecordData) {
      if (paid(d)) return "@TAX:AdvancePaidNoDelete";
      await forget(ctx.data, "advanceId", String(d.id));
    },
    async order(ctx: EventContext, d: RecordData) {
      const advs = await ctx.data.find(docs.advance, { orderId: d.id }, { take: 50 });
      if (advs.some(paid)) return "@TAX:AdvancePaidNoDelete";
      // splátka kalendáře zase čeká na vystavení
      for (const ln of await ctx.data.find(docs.agreementLine, { orderId: d.id }, { take: 10 })) await ctx.data.update(docs.agreementLine, String(ln.id), { status: "planned", orderId: null, invoiceId: null, dueDate: null });
      await forget(ctx.data, "orderId", String(d.id));
      for (const a of advs) await ctx.data.remove(docs.advance, String(a.id));
    },
    async agreement(ctx: EventContext, d: RecordData) {
      if ((await ctx.data.find(docs.cfg.header, { agreementId: d.id }, { take: 1 })).length) return "@TAX:AgrHasInvoices";
      // zálohy a objednávky smlouvy se mažou zvlášť (zaplacenou zálohu nejdřív odpárovat) – pak smlouva
      const advs = await ctx.data.find(docs.advance, { agreementId: d.id }, { take: 200 });
      const orders = await ctx.data.find(docs.order, { agreementId: d.id }, { take: 200 });
      if (advs.length || orders.length)
        throw new UserError("@TAX:AgrDeleteDocsFirst", { docs: [...advs.map((a) => String(a.advanceNum ?? "")), ...orders.map((o) => String(o.orderNum ?? ""))].filter(Boolean).join(", ") });
      for (const ln of await ctx.data.find(docs.agreementLine, { agreementId: d.id }, { take: 1000 })) await ctx.data.remove(docs.agreementLine, String(ln.id));
    },
  };
}

/* ---------------------------------------------------------------------------
 * Režim Kalendář
 * ------------------------------------------------------------------------- */

const dmy = (s: string) => s.split("-").reverse().join(". ").replace(/\b0(\d)\./g, "$1.");

/** Doplní kalendář splátek: do konce smlouvy, bez konce na rok dopředu od poslední splátky. */
export async function ensureSchedule(data: DataApi, docs: AgreementDocs, agr: RecordData, today = iso(new Date())) {
  const lines = await data.find(docs.agreementLine, { agreementId: agr.id }, { take: 1000, orderBy: { lineNum: "asc" } });
  const months = Math.max(1, Number(agr.periodMonths ?? 1));
  const end = agr.endDate ? String(agr.endDate).slice(0, 10) : null;
  const last = lines[lines.length - 1];
  let from = last ? addDays(String(last.periodTo).slice(0, 10), 1) : String(agr.startDate ?? today).slice(0, 10);
  const horizon = end ?? periodEnd(today < from ? from : today, 12);
  let n = last ? Number(last.lineNum) : 0;
  // nejvýš 120 splátek najednou (měsíčně na 10 let)
  while (from <= horizon && n < (last ? Number(last.lineNum) : 0) + 120) {
    if (!agr.autoRenew && end && from > end) break;
    const to = periodEnd(from, months);
    await data.create(docs.agreementLine, { agreementId: agr.id, lineNum: ++n, periodFrom: from, periodTo: end && to > end ? end : to, amount: agr.amount, status: "planned" });
    from = addDays(to, 1);
    if (!end && n - (last ? Number(last.lineNum) : 0) >= Math.ceil(12 / months)) break;
  }
}

/** Výzva v režimu Kalendář: kalendář splátek a čekání na první platbu (bez zálohy). */
async function requestSchedulePayment(data: DataApi, docs: AgreementDocs, agr: RecordData, today: string) {
  if (agr.status === "active") throw new UserError("@TAX:AgrAlreadyActive");
  const prm = await agreementParams(data, docs);
  await ensureSchedule(data, docs, agr, today);
  const [first] = await data.find(docs.agreementLine, { agreementId: agr.id, status: "planned" }, { take: 1, orderBy: { lineNum: "asc" } });
  await data.update(docs.agreement, String(agr.id), {
    status: "awaiting",
    periodFrom: first?.periodFrom ?? null,
    periodTo: first?.periodTo ?? null,
    dueDate: addDays(today, prm.dueDays),
  });
}

/** Vystaví splátku kalendáře: objednávka → zaúčtovaná faktura (VS smlouvy, splatnost z parametrů). */
async function issueScheduleLine(data: DataApi, docs: AgreementDocs, agr: RecordData, line: RecordData, today: string) {
  const prm = await agreementParams(data, docs);
  const pf = docs.partnerField;
  const from = String(line.periodFrom).slice(0, 10), to = String(line.periodTo).slice(0, 10);
  const text = `${agr.description || agr.agreementNum} · ${dmy(from)} – ${dmy(to)}`.slice(0, 255);
  const order = await data.create(docs.order, {
    [pf]: agr[pf],
    currencyId: agr.currencyId ?? null,
    ...(docs.sales ? { pricesInclTax: true } : {}),
    description: text,
    agreementId: agr.id,
  });
  await data.create(docs.orderLine, { orderId: order.id, itemId: agr.itemId ?? null, description: text, ...lineQty(agr, line.amount) });
  const o = (await data.get(docs.order, String(order.id)))!;
  if (toCents(o.amountGross) <= BigInt(0)) throw new UserError("@GL:NoLines");
  await data.update(docs.order, String(o.id), { status: "confirmed" });
  const inv = await invoiceFromOrder(data, docs, o);
  const due = addDays(today, prm.dueDays);
  await data.update(docs.cfg.header, String(inv.id), { vs: agr.vs ?? null, dueDate: due, agreementId: agr.id });
  await postInvoice(data, data.companyId ?? null, docs.cfg, (await data.get(docs.cfg.header, String(inv.id)))!);
  await data.update(docs.agreementLine, String(line.id), { status: "invoiced", orderId: o.id, invoiceId: inv.id, dueDate: due });
  await data.update(docs.agreement, String(agr.id), { orderId: o.id, periodFrom: from, periodTo: to, dueDate: due });
  return (await data.get(docs.cfg.header, String(inv.id)))!;
}

/** Aktivace první platbou (banka) nebo ručně: faktura první splátky, smlouva aktivní. Vrací fakturu. */
export async function activateSchedule(data: DataApi, docs: AgreementDocs, agr: RecordData, today = iso(new Date())) {
  if (agr.status === "ended") throw new UserError("@GL:Locked");
  // začátek od první platby: dosud nevystavený kalendář se přestaví od dneška
  if (agr.startOnPayment && !(await data.find(docs.agreementLine, { agreementId: agr.id, status: { in: ["invoiced", "paid"] } }, { take: 1 })).length) {
    for (const ln of await data.find(docs.agreementLine, { agreementId: agr.id }, { take: 1000 })) await data.remove(docs.agreementLine, String(ln.id));
    await data.update(docs.agreement, String(agr.id), { startDate: today, startOnPayment: false });
    agr = (await data.get(docs.agreement, String(agr.id)))!;
  }
  await ensureSchedule(data, docs, agr, today);
  const [first] = await data.find(docs.agreementLine, { agreementId: agr.id, status: "planned" }, { take: 1, orderBy: { lineNum: "asc" } });
  if (!first) throw new UserError("@TAX:AgrBeyondEnd");
  const inv = await issueScheduleLine(data, docs, agr, first, today);
  await data.update(docs.agreement, String(agr.id), { status: "active", blockedDate: null });
  return inv;
}

/** První splátka smlouvy čekající na aktivaci (pro párování první platby podle VS). */
export async function awaitingScheduleByVs(data: DataApi, vs: string): Promise<{ agreement: RecordData; amount: string } | null> {
  const docs = REGISTRY.customer;
  if (!docs || !(await agreementParams(data, docs)).schedule) return null;
  const list = await data.find(docs.agreement, { vs, status: "awaiting" }, { take: 2 });
  if (list.length !== 1) return null;
  const [first] = await data.find(docs.agreementLine, { agreementId: list[0].id, status: "planned" }, { take: 1, orderBy: { lineNum: "asc" } });
  if (!first || (await data.find(docs.agreementLine, { agreementId: list[0].id, status: { in: ["invoiced", "paid"] } }, { take: 1 })).length) return null;
  return { agreement: list[0], amount: String(first.amount) };
}

/** Banka: první platba podle VS smlouvy → aktivace (faktura), vrací položku salda faktury pro úhradu. */
export async function activateScheduleByPayment(data: DataApi, agreementId: string): Promise<RecordData> {
  const docs = REGISTRY.customer!;
  const agr = await data.get(docs.agreement, agreementId);
  if (!agr) throw new UserError("@SYS:NotFound");
  const inv = await activateSchedule(data, docs, agr);
  const [t] = await data.find(docs.cfg.partnerTrans, { invoiceId: inv.id, kind: "invoice" }, { take: 1 });
  if (!t) throw new UserError("@SYS:NotFound");
  return t;
}

/**
 * Zaplaceno kartou bránou (ověřený stav u brány, protokol napojení): smlouva čekající na první platbu se aktivuje,
 * první splátka je zaplacená. Faktura v saldu čeká na výplatu brány na účet (spáruje se s výpisem). Opakovaně nic nemění.
 */
export async function agreementGatewayPaid(data: DataApi, logId: string): Promise<boolean> {
  const docs = REGISTRY.customer;
  if (!docs) return false;
  const [agr] = await data.find(docs.agreement, { paymentLogId: logId }, { take: 1 }).catch(() => [] as RecordData[]);
  if (!agr || agr.status !== "awaiting" || !(await agreementParams(data, docs)).schedule) return false;
  const inv = await activateSchedule(data, docs, agr);
  const [ln] = await data.find(docs.agreementLine, { agreementId: agr.id, invoiceId: inv.id }, { take: 1 });
  if (ln) await data.update(docs.agreementLine, String(ln.id), { status: "paid" });
  await refreshSchedule(data, docs, (await data.get(docs.agreement, String(agr.id)))!);
  return true;
}

/** Stav smlouvy podle zaplacenosti faktur kalendáře (po úhradě i v dávce). */
export async function refreshSchedule(data: DataApi, docs: AgreementDocs, agr: RecordData, today = iso(new Date())) {
  const prm = await agreementParams(data, docs);
  const lines = await data.find(docs.agreementLine, { agreementId: agr.id, status: { in: ["invoiced", "paid"] } }, { take: 1000, orderBy: { lineNum: "asc" } });
  const invIds = lines.filter((l) => l.invoiceId).map((l) => String(l.invoiceId));
  const trans = invIds.length ? await data.find(docs.cfg.partnerTrans, { invoiceId: { in: invIds }, kind: "invoice" }, { take: 1000 }) : [];
  const closed = new Set(trans.filter((t) => t.closed).map((t) => String(t.invoiceId)));
  let paidUntil: string | null = null, overdue = false;
  for (const l of lines) {
    const isPaid = l.status === "paid" || (l.invoiceId && closed.has(String(l.invoiceId)));
    if (isPaid) {
      if (l.status !== "paid") await data.update(docs.agreementLine, String(l.id), { status: "paid" });
      paidUntil = String(l.periodTo).slice(0, 10);
    } else if (l.dueDate && addDays(String(l.dueDate).slice(0, 10), prm.blockDays) < today) overdue = true;
  }
  if (agr.status === "ended" || agr.status === "draft") return String(agr.status);
  const end = agr.endDate ? String(agr.endDate).slice(0, 10) : null;
  const planned = await data.find(docs.agreementLine, { agreementId: agr.id, status: "planned" }, { take: 1 });
  let next = String(agr.status);
  if (overdue) next = "blocked";
  else if (lines.length) next = end && paidUntil && paidUntil >= end && today > end && !planned.length ? "ended" : "active";
  const patch: RecordData = {};
  if (next !== agr.status) Object.assign(patch, { status: next, blockedDate: next === "blocked" ? today : null });
  if (paidUntil !== (agr.paidUntil ? String(agr.paidUntil).slice(0, 10) : null)) patch.paidUntil = paidUntil;
  if (Object.keys(patch).length) await data.update(docs.agreement, String(agr.id), patch);
  return next;
}

/** Úhrada faktury (banka): faktura smlouvy v režimu Kalendář → přepočet stavu (odblokování, zaplaceno do). */
export async function agreementInvoicePaid(data: DataApi, kind: "customer" | "vendor", invoiceId: string) {
  const docs = REGISTRY[kind];
  if (!docs) return;
  const inv = await data.get(docs.cfg.header, invoiceId);
  if (!inv?.agreementId) return;
  const agr = await data.get(docs.agreement, String(inv.agreementId));
  if (agr && (await agreementParams(data, docs)).schedule) await refreshSchedule(data, docs, agr);
}

/** Dávka v režimu Kalendář: stav podle úhrad, další splátky jen u aktivních (blokovaná nedostane nic). */
async function runSchedules(data: DataApi, docs: AgreementDocs, today: string, prm: Awaited<ReturnType<typeof agreementParams>>) {
  let issued = 0, blocked = 0;
  for (const status of ["active", "blocked"]) {
    for (const agr of await data.find(docs.agreement, { status }, { take: 1000 })) {
      const before = String(agr.status);
      const now = await refreshSchedule(data, docs, agr, today);
      if (now === "blocked") {
        if (before !== "blocked") blocked++;
        continue;
      }
      if (now !== "active") continue;
      const fresh = (await data.get(docs.agreement, String(agr.id)))!;
      await ensureSchedule(data, docs, fresh, today);
      for (const ln of await data.find(docs.agreementLine, { agreementId: agr.id, status: "planned" }, { take: 24, orderBy: { lineNum: "asc" } })) {
        if (addDays(String(ln.periodFrom).slice(0, 10), -prm.renewDays) > today) break;
        try {
          await issueScheduleLine(data, docs, (await data.get(docs.agreement, String(agr.id)))!, ln, today);
          issued++;
        } catch {
          break; // tarif bez ceny apod. — smlouva zůstane, jak je
        }
      }
    }
  }
  return { issued, blocked };
}

/** Pole parametrů modulu pro smlouvy. */
export const agreementParamFields = {
  agreementMode: { edt: enumEdt(AgreementMode), mandatory: true, default: "advance", help: "@TAX:AgrModeHelp" },
  agreementDueDays: { edt: Edts.Int, label: "@TAX:AgrDueDays", default: 7 },
  agreementBlockDays: { edt: Edts.Int, label: "@TAX:AgrBlockDays", default: 14, help: "@TAX:AgrBlockDaysHelp" },
  agreementRenewDays: { edt: Edts.Int, label: "@TAX:AgrRenewDays", default: 14, help: "@TAX:AgrRenewDaysHelp" },
};

