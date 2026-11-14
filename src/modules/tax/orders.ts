/**
 * Objednávky a zálohové faktury partnerů (prodejní / nákupní) — společné
 * pro odběratele i dodavatele, staví je továrna `partner-ledger.ts`.
 *
 * Objednávka:  Otevřená → Potvrdit → Vytvořit fakturu (řádky se zkopírují,
 *              uhrazená záloha objednávky se na faktuře předvyplní) → Vyfakturovaná.
 * Záloha:      výzva k platbě mimo účetnictví; úhradu účtuje banka na účet záloh
 *              (324 / 314), konečná faktura ji při zaúčtování odečte.
 */
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData, type ValidationErrors } from "@/core/module";
import { postingAccount } from "@/modules/gl/setup";
import { accountingCurrencyId } from "@/modules/gl/posting";
import type { InvoiceConfig } from "./document";

export interface OrderDocs {
  cfg: InvoiceConfig;
  order: string;
  orderLine: string;
  invoiceLine: string;
  advance: string;
  /** z čeho se dopočítá VS zálohy */
  vsSource: string;
}

const LINE_FIELDS = ["itemId", "description", "qty", "unitId", "unitPrice", "taxCodeId", "dim1", "dim2", "dim3", "dim4", "dim5", "dim6"];

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function partnerOf(data: DataApi, docs: OrderDocs, id: unknown) {
  const p = id ? await data.get(docs.cfg.partnerObject, String(id)) : null;
  if (!p) throw new UserError("@SYS:InvalidValue", {}, { [docs.cfg.partnerField]: "@SYS:Required" });
  return p;
}

/** Smazání konceptu faktury z objednávky vrátí objednávku k fakturaci. */
export async function releaseOrder(data: DataApi, docs: OrderDocs, invoice: RecordData) {
  if (!invoice.orderId) return;
  const o = await data.get(docs.order, String(invoice.orderId));
  if (o && o.invoiceId === invoice.id) await data.update(docs.order, String(o.id), { status: "confirmed", invoiceId: null });
}

export function orderHandlers(docs: OrderDocs): Record<string, ObjectHandlers> {
  const { cfg } = docs;
  const pf = cfg.partnerField;
  return {
    [docs.order]: {
      async beforeSave(ctx, d, isNew): Promise<ValidationErrors | void> {
        if (!d[pf]) return;
        const p = await partnerOf(ctx.data, docs, d[pf]);
        if (p.blocked) return { [pf]: "@SYS:PartnerBlocked" };
        if (isNew && !d.currencyId) d.currencyId = p.currencyId ?? (await accountingCurrencyId(ctx.data, ctx.companyId));
      },
      actions: {
        async confirm(ctx, o) {
          if (!(await ctx.data.find(docs.orderLine, { orderId: o.id }, { take: 1 })).length) throw new UserError("@GL:NoLines");
          await ctx.data.update(docs.order, String(o.id), { status: "confirmed" });
        },
        async cancel(ctx, o) {
          if (o.status === "invoiced") throw new UserError("@GL:Locked");
          await ctx.data.update(docs.order, String(o.id), { status: "cancelled" });
        },
        /** záloha na celou částku objednávky (částku lze v záloze změnit) */
        async createAdvance(ctx, o) {
          if (o.status === "invoiced" || o.status === "cancelled") throw new UserError("@GL:Locked");
          if (toCents(o.amountGross) <= BigInt(0)) throw new UserError("@GL:NoLines");
          await ctx.data.create(docs.advance, {
            [pf]: o[pf],
            orderId: o.id,
            currencyId: o.currencyId ?? null,
            description: o.description ?? null,
            amount: o.amountGross,
          });
        },
        async createInvoice(ctx, o) {
          if (o.status === "invoiced" || o.status === "cancelled") throw new UserError("@GL:Locked");
          const lines = await ctx.data.find(docs.orderLine, { orderId: o.id });
          if (!lines.length) throw new UserError("@GL:NoLines");
          // uhrazená, dosud nevyúčtovaná záloha objednávky
          const [adv] = (await ctx.data.find(docs.advance, { orderId: o.id, status: "paid" }, { take: 1 })) as RecordData[];
          const inv = await ctx.data.create(cfg.header, {
            [pf]: o[pf],
            currencyId: o.currencyId ?? null,
            description: o.description ?? null,
            orderId: o.id,
            advanceId: adv?.id ?? null,
          });
          for (const l of lines) {
            const row: RecordData = { [cfg.lineHeaderField]: inv.id, [cfg.lineAccountField]: l[cfg.lineAccountField] ?? null };
            for (const f of LINE_FIELDS) row[f] = l[f] ?? null;
            await ctx.data.create(docs.invoiceLine, row);
          }
          await ctx.data.update(docs.order, String(o.id), { status: "invoiced", invoiceId: inv.id });
        },
      },
    },
    [docs.advance]: {
      async beforeSave(ctx, d, isNew): Promise<ValidationErrors | void> {
        if (!d[pf]) return;
        const p = await partnerOf(ctx.data, docs, d[pf]);
        if (p.blocked) return { [pf]: "@SYS:PartnerBlocked" };
        if (toCents(d.amount) <= BigInt(0)) return { amount: "@SYS:InvalidValue" };
        if (d.orderId) {
          const o = await ctx.data.get(docs.order, String(d.orderId));
          if (!o || o[pf] !== d[pf]) return { orderId: "@TAX:AdvanceOtherPartner" };
        }
        if (isNew && !d.currencyId) d.currencyId = p.currencyId ?? (await accountingCurrencyId(ctx.data, ctx.companyId));
        if (!d.vs && d[docs.vsSource]) {
          const digits = String(d[docs.vsSource]).replace(/\D/g, "").slice(-10);
          if (digits) d.vs = digits;
        }
        if (!d.dueDate && d.issueDate) {
          const g = await ctx.data.get(cfg.groupObject, String(p.groupId));
          d.dueDate = addDays(String(d.issueDate), Number(p.paymentDays ?? g?.paymentDays ?? 14));
        }
        if (!isNew && toCents(d.amount) < toCents(d.paidAmount)) return { amount: "@TAX:AdvanceBelowPaid" };
      },
      actions: {
        async cancel(ctx, a) {
          if (toCents(a.paidAmount) > BigInt(0)) throw new UserError("@GL:Locked");
          await ctx.data.update(docs.advance, String(a.id), { status: "cancelled" });
        },
      },
    },
  };
}

/**
 * Úhrada zálohy (banka): navýší Uhrazeno a zapíše platbu do salda jako
 * položku „Záloha“ (otevřená, dokud ji konečná faktura nevyúčtuje).
 * `paidCur` = kladná částka v měně zálohy, `paidAcc` v účetní měně.
 */
export async function recordAdvancePayment(
  data: DataApi,
  kind: "customer" | "vendor",
  advanceId: string,
  p: { paidCur: bigint; paidAcc: bigint; voucherId: string; documentNum: string; date: unknown; vs: unknown; currencyId: string | null },
) {
  const obj = kind === "customer" ? "ar.advance" : "ap.advance";
  const trans = kind === "customer" ? "ar.trans" : "ap.trans";
  const field = kind === "customer" ? "customerId" : "vendorId";
  const sign = kind === "customer" ? BigInt(-1) : BigInt(1); // odběratel: úhrada snižuje saldo
  const a = await data.get(obj, advanceId);
  if (!a) throw new UserError("@SYS:NotFound");
  const paid = toCents(a.paidAmount) + p.paidCur;
  await data.update(obj, advanceId, { paidAmount: fromCents(paid), status: "paid" });
  await data.create(trans, {
    [field]: a[field],
    advanceId,
    kind: "advance",
    voucherId: p.voucherId,
    documentNum: p.documentNum,
    vs: p.vs ?? a.vs ?? null,
    date: p.date,
    currencyId: p.currencyId ?? a.currencyId ?? null,
    amount: fromCents(sign * p.paidAcc),
    amountCur: fromCents(sign * p.paidCur),
    paidAmount: "0",
    closed: false,
  });
}

/** Účet záloh partnera zálohy (ze skupiny, jinak první účet syntetiky 324 / 314). */
export async function advanceAccount(data: DataApi, kind: "customer" | "vendor", advanceId: string): Promise<string> {
  const a = await data.get(kind === "customer" ? "ar.advance" : "ap.advance", advanceId);
  const partner = a ? await data.get(kind === "customer" ? "ar.customer" : "ap.vendor", String(a[`${kind}Id`])) : null;
  const group = partner ? await data.get(kind === "customer" ? "ar.group" : "ap.group", String(partner.groupId)) : null;
  const acc = group?.advanceAccountId ?? (await postingAccount(data, kind === "customer" ? "324" : "314"));
  if (!acc) throw new UserError("@TAX:AdvanceAccountMissing");
  return String(acc);
}
