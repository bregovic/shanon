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
 */
import { toCents } from "@/core/money";
import { Edts, defineEnum, enumEdt, refEdt } from "@/core/edt";
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

export interface AgreementDocs extends OrderDocs {
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
      startDate: { edt: Edts.TransDate, label: "@TAX:AgrStart", mandatory: true, default: "$today" },
      endDate: { edt: Edts.TransDate, label: "@TAX:AgrEnd", help: "@TAX:AgrEndHelp" },
      autoRenew: { edt: Edts.NoYes, label: "@TAX:AgrAutoRenew", default: true },
      status: { edt: enumEdt(AgreementStatus), mandatory: true, default: "draft", readOnly: true },
      paidUntil: { edt: Edts.TransDate, label: "@TAX:AgrPaidUntil", readOnly: true },
      periodFrom: { edt: Edts.TransDate, label: "@TAX:AgrPeriodFrom", readOnly: true },
      periodTo: { edt: Edts.TransDate, label: "@TAX:AgrPeriodTo", readOnly: true },
      dueDate: { edt: Edts.TransDate, label: "@TAX:DueDate", readOnly: true },
      orderId: { edt: refEdt(`${m}.order`, L("Order")), readOnly: true },
      advanceId: { edt: refEdt(`${m}.advance`, L("Advance")), readOnly: true },
      blockedDate: { edt: Edts.TransDate, label: "@TAX:AgrBlockedDate", readOnly: true },
      signedAt: { edt: Edts.DateTime, label: "@TAX:AgrSignedAt", readOnly: true },
      terms: { edt: Edts.Notes, label: "@TAX:AgrTerms", readOnly: true },
      notes: { edt: Edts.Notes },
    },
    titleField: "agreementNum",
    titleRef: partnerId,
    list: ["agreementNum", partnerId, "itemId", "amount", "periodMonths", "startDate", "paidUntil", "dueDate", "status"],
    form: [
      { label: "@TAX:Header", fields: ["agreementNum", partnerId, "itemId", "description", "status"] },
      { label: "@TAX:AgrTerm", fields: ["amount", "currencyId", "periodMonths", "startDate", "endDate", "autoRenew"] },
      { label: "@TAX:AgrPayment", fields: ["paidUntil", "periodFrom", "periodTo", "dueDate", "orderId", "advanceId", "blockedDate"] },
      { label: "@TAX:AgrSigned", fields: ["signedAt", "terms", "notes"] },
    ],
    numberSeq: { field: "agreementNum", seq },
    defaultSort: { field: "startDate", dir: "desc" },
    indexes: [["status"]],
    related: [
      { object: `${m}.order`, field: "agreementId", label: L("Orders") },
      { object: `${m}.advance`, field: "agreementId", label: L("Advances") },
      { object: `${m}.invoice`, field: "agreementId", label: L("Invoices") },
    ],
    actions: [
      { id: "requestPayment", label: "@TAX:AgrRequestPayment" },
      { id: "end", label: "@TAX:AgrEndAction" },
    ],
    lockedWhen: { field: "status", equals: "ended" },
  });
}

/** Parametry smluv (z parametrů modulu; bez nich výchozí hodnoty). */
async function agreementParams(data: DataApi, docs: AgreementDocs) {
  const [p] = await data.find(docs.parameters, {}, { take: 1 }).catch(() => [] as RecordData[]);
  const num = (v: unknown, d: number) => (v === null || v === undefined || v === "" ? d : Math.max(0, Number(v)));
  return { dueDays: num(p?.agreementDueDays, 7), blockDays: num(p?.agreementBlockDays, 14), renewDays: num(p?.agreementRenewDays, 14) };
}

/**
 * Výzva k platbě na další období: objednávka s jedním řádkem (tarif) a záloha na její částku.
 * Období navazuje na zaplacené (jinak od začátku smlouvy, nejdřív dnes).
 */
export async function requestAgreementPayment(data: DataApi, docs: AgreementDocs, agr: RecordData, today = iso(new Date())) {
  if (agr.status === "ended") throw new UserError("@GL:Locked");
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
    qty: 1,
    unitPrice: agr.amount,
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
        if (d.itemId && (isNew || !d.amount)) {
          const it = await ctx.data.get("inv.item", String(d.itemId));
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
        if (d.endDate && d.startDate && String(d.endDate) < String(d.startDate)) return { endDate: "@SYS:InvalidValue" };
        if (!d.amount || toCents(d.amount) <= BigInt(0)) return { amount: "@SYS:Required" };
        if (isNew && !d.currencyId && d[pf]) {
          const p = await ctx.data.get(docs.cfg.partnerObject, String(d[pf]));
          d.currencyId = p?.currencyId ?? (await accountingCurrencyId(ctx.data, ctx.companyId));
        }
      },
      actions: {
        async requestPayment(ctx: EventContext, agr: RecordData) {
          await requestAgreementPayment(ctx.data, docs, agr);
        },
        async end(ctx: EventContext, agr: RecordData) {
          const today = iso(new Date());
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
      await forget(ctx.data, "orderId", String(d.id));
      for (const a of advs) await ctx.data.remove(docs.advance, String(a.id));
    },
    async agreement(ctx: EventContext, d: RecordData) {
      if ((await ctx.data.find(docs.cfg.header, { agreementId: d.id }, { take: 1 })).length) return "@TAX:AgrHasInvoices";
      const advs = await ctx.data.find(docs.advance, { agreementId: d.id }, { take: 200 });
      if (advs.some(paid)) return "@TAX:AgrHasInvoices";
      await ctx.data.update(docs.agreement, String(d.id), { orderId: null, advanceId: null });
      for (const a of advs) await ctx.data.remove(docs.advance, String(a.id));
      for (const o of await ctx.data.find(docs.order, { agreementId: d.id }, { take: 200 })) await ctx.data.remove(docs.order, String(o.id));
    },
  };
}

/** Pole parametrů modulu pro smlouvy. */
export const agreementParamFields = {
  agreementDueDays: { edt: Edts.Int, label: "@TAX:AgrDueDays", default: 7 },
  agreementBlockDays: { edt: Edts.Int, label: "@TAX:AgrBlockDays", default: 14, help: "@TAX:AgrBlockDaysHelp" },
  agreementRenewDays: { edt: Edts.Int, label: "@TAX:AgrRenewDays", default: 14, help: "@TAX:AgrRenewDaysHelp" },
};

