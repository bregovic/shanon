/**
 * Společná logika faktur (vydaných i přijatých): výpočet řádků s DPH,
 * součty v hlavičce, výchozí hodnoty z partnera a jeho skupiny (účtovací
 * profil) a zaúčtování → účetní doklad + otevřená položka + daňové transakce.
 *
 * Moduly AR/AP jen popíšou své objekty a předají konfiguraci (InvoiceConfig).
 */
import { fromCents, mulCents, percentOf, sumCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { convertCents } from "@/modules/sys/currency";
import { accountingCurrencyId, ledgerRate, postVoucher, type PostingLine } from "@/modules/gl/posting";

export interface InvoiceConfig {
  /** hlavička a řádky, např. ar.invoice / ar.invoiceLine */
  header: string;
  line: string;
  /** vazba řádku na hlavičku */
  lineHeaderField: string;
  /** partner (odběratel / dodavatel) a jeho skupina = účtovací profil */
  partnerField: string;
  partnerObject: string;
  groupObject: string;
  /** účet pohledávek / závazků ve skupině */
  groupSummaryField: string;
  /** výchozí účet výnosů / nákladů ve skupině a na řádku */
  groupLineAccountField: string;
  lineAccountField: string;
  /** otevřené položky partnera */
  partnerTrans: string;
  /** číslo dokladu pro daňové transakce a otevřenou položku */
  docNumField: string;
  /** z čeho se dopočítá VS, když ho uživatel nevyplní */
  vsSourceField: string;
  /** výchozí hodnoty z položky: cena (pole položky), DPH a účet (pole skupiny položek) */
  item: { price: string; tax: string; groupAccount: string };
  /** +1 = vydaná (pohledávka MD, výnosy D), −1 = přijatá (závazek D, náklady MD) */
  side: 1 | -1;
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function partnerAndGroup(data: DataApi, cfg: InvoiceConfig, partnerId: unknown) {
  const partner = partnerId ? await data.get(cfg.partnerObject, String(partnerId)) : null;
  if (!partner) throw new UserError("@SYS:InvalidValue", {}, { [cfg.partnerField]: "@SYS:Required" });
  const group = await data.get(cfg.groupObject, String(partner.groupId));
  if (!group) throw new UserError("@SYS:InvalidValue");
  return { partner, group };
}

async function assertDraft(data: DataApi, cfg: InvoiceConfig, headerId: unknown) {
  const h = headerId ? await data.get(cfg.header, String(headerId)) : null;
  if (h?.status === "posted") throw new UserError("@GL:Locked");
  return h;
}

/** Přepočet součtů hlavičky z řádků. */
export async function recalcHeader(data: DataApi, cfg: InvoiceConfig, headerId: string) {
  const lines = await data.find(cfg.line, { [cfg.lineHeaderField]: headerId });
  const net = sumCents(lines.map((l) => toCents(l.amountNet)));
  const tax = sumCents(lines.map((l) => toCents(l.taxAmount)));
  await data.update(cfg.header, headerId, {
    amountNet: fromCents(net),
    taxAmount: fromCents(tax),
    amountGross: fromCents(net + tax),
  });
}

export function invoiceHandlers(cfg: InvoiceConfig): Record<string, ObjectHandlers> {
  return {
    [cfg.header]: {
      /** výchozí hodnoty z partnera: měna, splatnost, DUZP */
      async beforeSave(ctx, data, isNew) {
        if (!data[cfg.partnerField]) return;
        const { partner, group } = await partnerAndGroup(ctx.data, cfg, data[cfg.partnerField]);
        if (partner.blocked) return { [cfg.partnerField]: "@SYS:PartnerBlocked" };
        if (!data.invoiceDate) data.invoiceDate = today();
        if (!data.taxDate) data.taxDate = data.invoiceDate;
        if (isNew && !data.currencyId) data.currencyId = partner.currencyId ?? (await accountingCurrencyId(ctx.data, ctx.companyId));
        // VS = číslice z čísla faktury (vydaná) / z čísla dodavatele (přijatá), nejvýš 10
        if (!data.vs && data[cfg.vsSourceField]) {
          const digits = String(data[cfg.vsSourceField]).replace(/\D/g, "").slice(-10);
          if (digits) data.vs = digits;
        }
        if (!data.dueDate) {
          const days = Number(partner.paymentDays ?? group.paymentDays ?? 14);
          data.dueDate = addDays(String(data.invoiceDate), days);
        }
      },
      actions: {
        async post(ctx, header) {
          await postInvoice(ctx.data, ctx.companyId, cfg, header);
        },
      },
    },
    [cfg.line]: {
      /** výchozí účet a DPH ze skupiny partnera, výpočet částek */
      async beforeSave(ctx, data, isNew) {
        const h = await assertDraft(ctx.data, cfg, data[cfg.lineHeaderField]);
        if (!h) return;
        const { group } = await partnerAndGroup(ctx.data, cfg, h[cfg.partnerField]);
        // položka: doplní jen to, co uživatel nevyplnil
        if (data.itemId) {
          const item = await ctx.data.get("inv.item", String(data.itemId));
          if (item) {
            const ig = await ctx.data.get("inv.itemGroup", String(item.groupId));
            if (!data.description) data.description = item.name;
            if (!data.unitId) data.unitId = item.unitId;
            if (data.unitPrice === null || data.unitPrice === undefined || data.unitPrice === "") data.unitPrice = item[cfg.item.price] ?? null;
            if (isNew && !data.taxCodeId) data.taxCodeId = (cfg.side === 1 ? item.taxCodeId : null) ?? ig?.[cfg.item.tax] ?? null;
            if (isNew && !data[cfg.lineAccountField]) data[cfg.lineAccountField] = ig?.[cfg.item.groupAccount] ?? null;
          }
        }
        const missing: Record<string, string> = {};
        if (!data.description) missing.description = "@SYS:Required";
        if (data.unitPrice === null || data.unitPrice === undefined || data.unitPrice === "") missing.unitPrice = "@SYS:Required";
        if (Object.keys(missing).length) return missing;
        // výchozí hodnoty jen u nového řádku — uživatel může DPH i účet změnit
        if (isNew && !data[cfg.lineAccountField]) data[cfg.lineAccountField] = group[cfg.groupLineAccountField] ?? null;
        if (isNew && !data.taxCodeId) data.taxCodeId = group.taxCodeId ?? null;
        if (!data[cfg.lineAccountField]) return { [cfg.lineAccountField]: "@SYS:Required" };
        const net = mulCents(data.qty ?? "1", 4, data.unitPrice ?? "0", 2);
        const code = data.taxCodeId ? await ctx.data.get("tax.taxCode", String(data.taxCodeId)) : null;
        data.amountNet = fromCents(net);
        data.taxAmount = fromCents(code ? percentOf(net, code.rate) : BigInt(0));
      },
      async afterSave(ctx, data) {
        await recalcHeader(ctx.data, cfg, String(data[cfg.lineHeaderField]));
      },
      beforeDelete: async (ctx, data) => {
        await assertDraft(ctx.data, cfg, data[cfg.lineHeaderField]);
      },
      async afterDelete(ctx, data) {
        await recalcHeader(ctx.data, cfg, String(data[cfg.lineHeaderField]));
      },
    },
  };
}

/**
 * Zaúčtování faktury:
 *   vydaná:   MD pohledávky (s DPH) / D výnosy (základ) / D DPH na výstupu
 *   přijatá:  MD náklady (základ) / MD DPH na vstupu / D závazky (s DPH)
 * + otevřená položka partnera, daňové transakce, faktura se uzamkne.
 */
export async function postInvoice(data: DataApi, companyId: string | null, cfg: InvoiceConfig, header: RecordData) {
  if (header.status !== "draft") throw new UserError("@GL:Locked");
  const lines = await data.find(cfg.line, { [cfg.lineHeaderField]: header.id });
  if (!lines.length) throw new UserError("@GL:NoLines");
  const { partner, group } = await partnerAndGroup(data, cfg, header[cfg.partnerField]);
  const subject = partner.subjectId ? await data.get("gab.subject", String(partner.subjectId)) : null;
  const date = String(header.invoiceDate);
  const taxDate = String(header.taxDate ?? date);

  // kurz k datu účtování (účetní měna = 1)
  const base = await accountingCurrencyId(data, companyId);
  const curId = (header.currencyId as string) ?? base;
  const rate = curId && curId !== base ? await ledgerRate(data, companyId, curId, date) : null;
  const conv = (cents: bigint) => (rate ? convertCents(fromCents(cents), rate.rate, rate.amount) : cents);

  const s = BigInt(cfg.side);
  const posting: PostingLine[] = [];
  const taxByCode = new Map<string, { base: bigint; tax: bigint; baseCur: bigint; taxCur: bigint }>();
  let grossAcc = BigInt(0);
  let grossCur = BigInt(0);
  for (const l of lines) {
    const netCur = toCents(l.amountNet);
    const taxCur = toCents(l.taxAmount);
    const net = conv(netCur);
    const tax = conv(taxCur);
    grossAcc += net + tax;
    grossCur += netCur + taxCur;
    // výnosy D (vydaná) / náklady MD (přijatá)
    posting.push({
      accountId: String(l[cfg.lineAccountField]),
      amount: fromCents(-s * net),
      amountCur: fromCents(-s * netCur),
      currencyId: curId,
      costCenterId: (l.costCenterId as string) ?? null,
      text: (l.description as string) ?? null,
    });
    if (l.taxCodeId) {
      const t = taxByCode.get(String(l.taxCodeId)) ?? { base: BigInt(0), tax: BigInt(0), baseCur: BigInt(0), taxCur: BigInt(0) };
      t.base += net;
      t.tax += tax;
      t.baseCur += netCur;
      t.taxCur += taxCur;
      taxByCode.set(String(l.taxCodeId), t);
    }
  }
  for (const [codeId, t] of taxByCode) {
    if (t.tax === BigInt(0)) continue;
    const code = await data.get("tax.taxCode", codeId);
    posting.push({ accountId: String(code!.accountId), amount: fromCents(-s * t.tax), amountCur: fromCents(-s * t.taxCur), currencyId: curId });
  }
  // pohledávka MD / závazek D — celkem s DPH
  posting.push({
    accountId: String(group[cfg.groupSummaryField]),
    amount: fromCents(s * grossAcc),
    amountCur: fromCents(s * grossCur),
    currencyId: curId,
    text: (header.description as string) ?? null,
  });

  const docNum = String(header[cfg.docNumField] ?? header.invoiceNum);
  const voucher = await postVoucher(data, {
    date,
    description: `${docNum}${subject ? ` · ${subject.name}` : ""}`,
    sourceObject: cfg.header,
    sourceId: String(header.id),
    lines: posting,
  });

  for (const [codeId, t] of taxByCode) {
    const code = await data.get("tax.taxCode", codeId);
    await data.create("tax.trans", {
      taxDate,
      taxCodeId: codeId,
      direction: code!.direction,
      base: fromCents(t.base),
      tax: fromCents(t.tax),
      currencyId: curId,
      baseCur: fromCents(t.baseCur),
      taxCur: fromCents(t.taxCur),
      subjectId: partner.subjectId ?? null,
      vatId: subject?.vatId ?? null,
      documentNum: docNum,
      voucherId: voucher.id,
      sourceObject: cfg.header,
      sourceId: String(header.id),
    });
  }
  await data.create(cfg.partnerTrans, {
    [cfg.partnerField]: partner.id,
    invoiceId: header.id,
    voucherId: voucher.id,
    date,
    dueDate: header.dueDate ?? date,
    kind: "invoice",
    documentNum: docNum,
    vs: header.vs ?? null,
    currencyId: curId,
    amount: fromCents(grossAcc),
    amountCur: fromCents(grossCur),
    paidAmount: "0",
    closed: false,
  });
  await data.update(cfg.header, String(header.id), { status: "posted", voucherId: voucher.id });
}
