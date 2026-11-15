/**
 * Společná logika faktur (vydaných i přijatých): výpočet řádků s DPH,
 * součty v hlavičce, výchozí hodnoty z partnera a jeho skupiny (účtovací
 * profil) a zaúčtování → účetní doklad + otevřená položka + daňové transakce.
 *
 * Moduly AR/AP jen popíšou své objekty a předají konfiguraci (InvoiceConfig).
 */
import { fromCents, mulCents, percentOf, roundCents, sumCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { convertCents } from "@/modules/sys/currency";
import { accountingCurrencyId, assertOpenPeriod, checkDuplicate, convertPrice, currencyRounding, ledgerRate, postVoucher, systemAccount, type PostingLine } from "@/modules/gl/posting";
import { dimsOf } from "@/modules/gl/dimensions";
import { postingAccount } from "@/modules/gl/setup";
import { partnerTaxGroup, resolveLineCode, taxTransParts } from "./tax-groups";

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
  /** stavy hlavičky, ve kterých se řádky nemění (výchozí: zaúčtováno) */
  lockedStatuses?: string[];
  /** parametry pomocné knihy (kontrola čísla faktury) */
  parameters?: string;
  /** zálohy partnera: objekt zálohy a pole účtu záloh ve skupině */
  advance?: { object: string; groupAccountField: string; defaultAccount: string };
}

const today = () => new Date().toISOString().slice(0, 10);
/** Oddíl KH dokladu: A.4/B.2 jen od 10 000 Kč včetně DPH s českým DIČ a ne účtenka; jinak A.5/B.3. */
function khSectionOf(sec: unknown, grossAcc: bigint, vatId: unknown, receipt: boolean): { khSection: string } | null {
  const s = String(sec ?? "");
  if (s !== "A4" && s !== "B2") return null;
  const individual = !receipt && (grossAcc < BigInt(0) ? -grossAcc : grossAcc) >= BigInt(1_000_000) && /^CZ\d{8,10}$/.test(String(vatId ?? "").replace(/\s/g, "").toUpperCase());
  return { khSection: individual ? s : s === "A4" ? "A5" : "B3" };
}

/** hlavička faktury → původní skupina DPH (mezi beforeSave a afterSave) */
const groupChanged = new Map<string, string | null>();
/** hlavička → původní měna (přepočet cen řádků z položek) */
const currencyChanged = new Map<string, string>();
/** datum jako RRRR-MM-DD (z DB může přijít Date) */
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
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
  if (h && (cfg.lockedStatuses ?? ["posted"]).includes(String(h.status))) throw new UserError("@GL:Locked");
  return h;
}

/** Přepočet součtů hlavičky z řádků. */
export async function recalcHeader(data: DataApi, cfg: InvoiceConfig, headerId: string) {
  const lines = await data.find(cfg.line, { [cfg.lineHeaderField]: headerId });
  const net = sumCents(lines.map((l) => toCents(l.amountNet)));
  const tax = sumCents(lines.map((l) => toCents(l.taxAmount)));
  // zaokrouhlení celkové částky podle měny dokladu — jen vydané faktury (přijatá musí sedět na doklad dodavatele)
  const h = cfg.side === 1 ? await data.get(cfg.header, headerId) : null;
  let gross = net + tax;
  let rounding = BigInt(0);
  if (h && "roundingAmount" in h && lines.length) {
    const r = await currencyRounding(data, (h.currencyId as string) ?? (await accountingCurrencyId(data, data.companyId ?? null)));
    const propose = (raw: bigint) => roundCents(raw, r.invoiceUnit, "nearest") - raw;
    // dosavadní zaokrouhlení = návrh k předchozím částkám? pak nový návrh, jinak ho uživatel změnil ručně a zůstane
    const prevRaw = toCents(h.amountNet ?? "0") + toCents(h.taxAmount ?? "0");
    const prev = h.roundingAmount === null || h.roundingAmount === undefined ? null : toCents(h.roundingAmount);
    rounding = prev === null || prev === propose(prevRaw) ? propose(gross) : prev;
    gross += rounding;
  }
  await data.update(cfg.header, headerId, {
    amountNet: fromCents(net),
    taxAmount: fromCents(tax),
    amountGross: fromCents(gross),
    ...(h && "roundingAmount" in h ? { roundingAmount: fromCents(rounding) } : {}),
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
        if (cfg.advance && data.advanceId) {
          const a = await ctx.data.get(cfg.advance.object, String(data.advanceId));
          if (!a || a[cfg.partnerField] !== data[cfg.partnerField]) return { advanceId: "@TAX:AdvanceOtherPartner" };
        }
        // skupina DPH z partnera (nový doklad, jiný partner; ručně změněnou nepřepisovat)
        const before = !isNew && data.id ? await ctx.data.get(cfg.header, String(data.id)) : null;
        const partnerGroup = await partnerTaxGroup(ctx.data, cfg.partnerObject, cfg.groupObject, data[cfg.partnerField]);
        const oldGroup = before && before[cfg.partnerField] !== data[cfg.partnerField] ? await partnerTaxGroup(ctx.data, cfg.partnerObject, cfg.groupObject, before[cfg.partnerField]) : undefined;
        if (!data.taxGroupId || (oldGroup !== undefined && data.taxGroupId === oldGroup)) data.taxGroupId = partnerGroup;
        // jiná skupina DPH na hlavičce: řádky se starou skupinou ji po uložení převezmou (afterSave)
        if (before && (before.taxGroupId ?? null) !== (data.taxGroupId ?? null)) groupChanged.set(String(data.id), (before.taxGroupId as string) ?? null);
        else if (data.id) groupChanged.delete(String(data.id));
        // jiná měna dokladu: ceny řádků převzaté z položky se po uložení přepočtou (afterSave)
        if (before && before.currencyId && data.currencyId && before.currencyId !== data.currencyId) currencyChanged.set(String(data.id), String(before.currencyId));
        else if (data.id) currencyChanged.delete(String(data.id));
        if (!data.invoiceDate) data.invoiceDate = today();
        // změna data vystavení: DUZP a splatnost ho následují, pokud je uživatel nezměnil ručně
        // (DUZP = staré datum vystavení, splatnost = staré datum + dny splatnosti partnera / skupiny)
        const days = Number(partner.paymentDays ?? group.paymentDays ?? 14);
        const oldDate = day(before?.invoiceDate);
        if (oldDate && oldDate !== day(data.invoiceDate)) {
          if (day(data.taxDate) === oldDate) data.taxDate = null;
          const samePartner = before![cfg.partnerField] === data[cfg.partnerField];
          if (samePartner && day(data.dueDate) === addDays(oldDate, days)) data.dueDate = null;
        }
        if (!data.taxDate) data.taxDate = data.invoiceDate;
        if (isNew && !data.currencyId) data.currencyId = partner.currencyId ?? (await accountingCurrencyId(ctx.data, ctx.companyId));
        // VS = číslice z čísla faktury (vydaná) / z čísla dodavatele (přijatá), nejvýš 10; změna čísla posune i VS z něj
        const vsOf = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
        if (before && data.vs && before[cfg.vsSourceField] !== data[cfg.vsSourceField] && String(data.vs) === vsOf(before[cfg.vsSourceField])) data.vs = null;
        if (!data.vs && data[cfg.vsSourceField]) {
          const digits = String(data[cfg.vsSourceField]).replace(/\D/g, "").slice(-10);
          if (digits) data.vs = digits;
        }
        if (!data.dueDate) data.dueDate = addDays(day(data.invoiceDate)!, days);
        // vydaná: náš bankovní účet (výchozí pro měnu faktury) a způsob úhrady z odběratele
        if (cfg.side === 1 && ctx.modules?.has("bank")) {
          if (!data.paymentMethodId && partner.paymentMethodId) data.paymentMethodId = partner.paymentMethodId;
          const base = await accountingCurrencyId(ctx.data, ctx.companyId);
          const cur = (data.currencyId as string) || base;
          const curOf = (a: RecordData | null) => (a ? (a.currencyId as string) || base : null);
          const current = data.bankAccountId ? await ctx.data.get("bank.account", String(data.bankAccountId)) : null;
          if (!current || curOf(current) !== cur) {
            const accs = (await ctx.data.find("bank.account", { blocked: false }, { take: 50, orderBy: { code: "asc" } })).filter((a) => curOf(a) === cur);
            data.bankAccountId = (accs.find((a) => a.isDefault) ?? accs[0])?.id ?? null;
          }
        }
        // ručně změněné zaokrouhlení: celkem = základ + DPH + zaokrouhlení
        if (cfg.side === 1 && before && String(before.roundingAmount ?? "") !== String(data.roundingAmount ?? "")) {
          data.amountGross = fromCents(toCents(data.amountNet ?? "0") + toCents(data.taxAmount ?? "0") + toCents(data.roundingAmount ?? "0"));
        }
        // číslo faktury už existuje (přijatá: u téhož dodavatele) — podle parametrů přijmout / varovat / odmítnout
        const num = data[cfg.docNumField];
        if (cfg.parameters && num && (!before || before[cfg.docNumField] !== num || day(before.invoiceDate) !== day(data.invoiceDate))) {
          const [p] = await ctx.data.find(cfg.parameters, {}, { take: 1 });
          const where: RecordData = { [cfg.docNumField]: num, ...(cfg.docNumField === "externalNum" ? { [cfg.partnerField]: data[cfg.partnerField] } : {}) };
          const found = (await ctx.data.find(cfg.header, where, { take: 20 })).filter((r) => r.id !== data.id);
          try {
            await checkDuplicate(ctx.data, p?.invoiceNumCheck, found, day(data.invoiceDate), "invoiceDate", "@TAX:InvoiceNumDuplicate", { num: String(num) });
          } catch (e) {
            if (e instanceof UserError) return { [cfg.docNumField]: e.label };
            throw e;
          }
        }
      },
      async afterSave(ctx, data) {
        const key = String(data.id);
        const oldCur = currencyChanged.get(key);
        if (oldCur) {
          currencyChanged.delete(key);
          const date = day(data.invoiceDate ?? data.orderDate) ?? today();
          for (const l of await ctx.data.find(cfg.line, { [cfg.lineHeaderField]: data.id }, { take: 1000 })) {
            if (!l.itemId) continue;
            const item = await ctx.data.get("inv.item", String(l.itemId));
            if (!item) continue;
            // jen cena, kterou dala položka (ručně změněná zůstane)
            const was = await convertPrice(ctx.data, ctx.companyId, item[cfg.item.price] ?? null, item.currencyId as string, oldCur, date);
            if (was === null || was === undefined || l.unitPrice === null || toCents(was) !== toCents(l.unitPrice)) continue;
            const now = await convertPrice(ctx.data, ctx.companyId, item[cfg.item.price] ?? null, item.currencyId as string, String(data.currencyId), date);
            await ctx.data.update(cfg.line, String(l.id), { unitPrice: now });
          }
        }
        if (!groupChanged.has(key)) return;
        const old = groupChanged.get(key) ?? null;
        groupChanged.delete(key);
        // kód z kombinace skupina × položka DPH se na řádku přepočítá, ručně zadaný zůstane
        for (const l of await ctx.data.find(cfg.line, { [cfg.lineHeaderField]: data.id, taxGroupId: old }, { take: 1000 }))
          await ctx.data.update(cfg.line, String(l.id), { taxGroupId: data.taxGroupId ?? null });
      },
      actions: {
        async post(ctx, header) {
          await postInvoice(ctx.data, ctx.companyId, cfg, header);
        },
        // superuživatel (actions[].adminOnly): oprava zaúčtované faktury, dokud DPH není v podaném přiznání
        async unpost(ctx, header) {
          await unpostInvoice(ctx.data, cfg, header);
        },
      },
    },
    ...documentLineHandlers(cfg),
  };
}

/** Řádky dokladu s položkou, cenou a DPH (faktura, objednávka): výchozí hodnoty, výpočet, součty. */
export function documentLineHandlers(cfg: InvoiceConfig): Record<string, ObjectHandlers> {
  return {
    [cfg.line]: {
      /** výchozí účet a DPH ze skupiny partnera, výpočet částek */
      async beforeSave(ctx, data, isNew) {
        const h = await assertDraft(ctx.data, cfg, data[cfg.lineHeaderField]);
        if (!h) return;
        const { group } = await partnerAndGroup(ctx.data, cfg, h[cfg.partnerField]);
        // kód zadaný uživatelem (před výchozími hodnotami) a řádek před změnou
        const userCode = (data.taxCodeId as string) || null;
        const before = !isNew && data.id ? await ctx.data.get(cfg.line, String(data.id)) : null;
        let itemTaxGroup: unknown = null;
        // položka má vlastní kód (bez položky DPH) — skupiny se neuplatní
        let itemDecides = false;
        // položka: doplní jen to, co uživatel nevyplnil
        if (data.itemId) {
          const item = await ctx.data.get("inv.item", String(data.itemId));
          if (item) {
            const ig = await ctx.data.get("inv.itemGroup", String(item.groupId));
            if (!data.description) data.description = item.name;
            if (!data.unitId) data.unitId = item.unitId;
            if (data.unitPrice === null || data.unitPrice === undefined || data.unitPrice === "") {
              // cena v měně položky → měna dokladu (kurz k datu dokladu)
              const date = String(h.invoiceDate ?? h.orderDate ?? new Date().toISOString().slice(0, 10));
              data.unitPrice = await convertPrice(ctx.data, ctx.companyId, item[cfg.item.price] ?? null, item.currencyId as string, h.currencyId as string, date);
            }
            // pořadí: položka DPH položky → vlastní kód položky → položka DPH skupiny položek
            // (konkrétnější údaj na položce má přednost před skupinou)
            const ownCode = cfg.side === 1 ? item.taxCodeId : null;
            itemTaxGroup = item.itemTaxGroupId ?? (ownCode ? null : (ig?.itemTaxGroupId ?? null));
            if (!itemTaxGroup && ownCode) itemDecides = true;
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
        // DPH přes skupiny: skupina z hlavičky, položka DPH z položky / skupiny položek, jinak z účtu
        if (!data.taxGroupId && (isNew || !before?.taxGroupId)) data.taxGroupId = h.taxGroupId ?? null;
        const itemChanged = !!before && before.itemId !== data.itemId;
        if (itemDecides && (isNew || itemChanged)) data.itemTaxGroupId = null;
        else if (!data.itemTaxGroupId || (itemChanged && data.itemTaxGroupId === before?.itemTaxGroupId)) {
          const acc = itemTaxGroup ? null : await ctx.data.get("gl.account", String(data[cfg.lineAccountField]));
          data.itemTaxGroupId = (itemTaxGroup as string) ?? (acc?.itemTaxGroupId as string) ?? null;
        }
        // kód z kombinace skupin má přednost před výchozím kódem položky / skupiny partnerů; ručně zadaný zůstane
        const legacy = data.taxCodeId ?? null;
        data.taxCodeId = userCode;
        await resolveLineCode(ctx.data, data, before, cfg.side === 1 ? "sales" : "purchase");
        data.taxCodeId ??= legacy;
        const net = mulCents(data.qty ?? "1", 4, data.unitPrice ?? "0", 2);
        const code = data.taxCodeId ? await ctx.data.get("tax.taxCode", String(data.taxCodeId)) : null;
        data.amountNet = fromCents(net);
        // samovyměření (přenesená povinnost, EU): daň se nefakturuje, přizná ji příjemce při zaúčtování
        data.taxAmount = fromCents(code && !code.reverseCharge ? percentOf(net, code.rate) : BigInt(0));
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
  // účtenka (zjednodušený daňový doklad) může být bez čísla dokladu dodavatele — pak naše číslo
  if (!header[cfg.docNumField] && !header.receipt) throw new UserError("@SYS:FixErrors", {}, { [cfg.docNumField]: "@SYS:Required" });
  const lines = await data.find(cfg.line, { [cfg.lineHeaderField]: header.id });
  if (!lines.length) throw new UserError("@GL:NoLines");
  // plátce DPH: každý řádek musí mít daňový kód, jinak by DPH nevzniklo a chybělo v přiznání
  const org = await data.find("org.entity", {}, { take: 1 }).catch(() => [] as RecordData[]);
  const vatPayer = org.length ? org[0].vatPayer !== false : true;
  const noCode = vatPayer ? lines.find((l) => !l.taxCodeId) : undefined;
  if (noCode) throw new UserError("@TAX:NoTaxCode", { line: String(noCode.description ?? "") });
  const { partner, group } = await partnerAndGroup(data, cfg, header[cfg.partnerField]);
  const subject = partner.subjectId ? await data.get("gab.subject", String(partner.subjectId)) : null;
  const date = String(header.invoiceDate);
  const taxDate = String(header.taxDate ?? date);

  // kurz k datu účtování (účetní měna = 1)
  const base = await accountingCurrencyId(data, companyId);
  const curId = (header.currencyId as string) ?? base;
  // kurz ČNB k DUZP (§ 38 ZDPH: DPH v Kč kurzem ke dni zdanitelného plnění)
  const rate = curId && curId !== base ? await ledgerRate(data, companyId, curId, taxDate) : null;
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
      dims: dimsOf(l),
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
  const codeRecs = new Map<string, RecordData>();
  for (const [codeId, t] of taxByCode) {
    const code = (await data.get("tax.taxCode", codeId))!;
    codeRecs.set(codeId, code);
    if (code.reverseCharge) {
      // daň vyměří příjemce: nárok MD (vstup) a daň D (výstup), závazek bez daně
      t.tax = percentOf(t.base, code.rate);
      t.taxCur = percentOf(t.baseCur, code.rate);
      if (t.tax === BigInt(0)) continue;
      posting.push({ accountId: String(code.accountId), amount: fromCents(-s * t.tax), amountCur: fromCents(-s * t.taxCur), currencyId: curId, text: String(code.code) });
      posting.push({ accountId: String(code.outputAccountId ?? code.accountId), amount: fromCents(s * t.tax), amountCur: fromCents(s * t.taxCur), currencyId: curId, text: String(code.code) });
      continue;
    }
    // cizí měna: daň v Kč ze základu přepočteného kurzem (§ 37 ZDPH), ne přepočtená daň v cizí měně
    if (rate && t.taxCur !== BigInt(0)) {
      const taxAcc = percentOf(t.base, code.rate);
      grossAcc += taxAcc - t.tax;
      t.tax = taxAcc;
    }
    if (t.tax === BigInt(0)) continue;
    posting.push({ accountId: String(code.accountId), amount: fromCents(-s * t.tax), amountCur: fromCents(-s * t.taxCur), currencyId: curId });
  }
  // zaokrouhlení celkové částky (mimo DPH): výnos / náklad na systémový účet zaokrouhlení
  const roundCur = toCents(header.roundingAmount ?? "0");
  if (roundCur !== BigInt(0)) {
    const roundAcc = conv(roundCur);
    grossCur += roundCur;
    grossAcc += roundAcc;
    // vydaná: kladné zaokrouhlení = výnos (zisk), přijatá: kladné = náklad (ztráta)
    const gain = (s > 0) === (roundCur > 0);
    posting.push({ accountId: await systemAccount(data, gain ? "roundingGain" : "roundingLoss"), amount: fromCents(-s * roundAcc), amountCur: fromCents(-s * roundCur), currencyId: curId, text: null });
  }
  // pohledávka MD / závazek D — celkem s DPH
  posting.push({
    accountId: String(group[cfg.groupSummaryField]),
    amount: fromCents(s * grossAcc),
    amountCur: fromCents(s * grossCur),
    currencyId: curId,
    text: (header.description as string) ?? null,
  });

  // odpočet zálohy: přijatá záloha 324 → pohledávka 311 (poskytnutá 314 → závazek 321)
  let advCur = BigInt(0);
  let advTax = BigInt(0);
  let advCode: RecordData | null = null;
  let adv: RecordData | null = null;
  if (cfg.advance && header.advanceId) {
    adv = await data.get(cfg.advance.object, String(header.advanceId));
    if (!adv || adv[cfg.partnerField] !== partner.id || !["paid", "settled"].includes(String(adv.status))) throw new UserError("@TAX:AdvanceNotPaid");
    if (((adv.currencyId as string) ?? base) !== curId) throw new UserError("@TAX:AdvanceCurrency");
    const avail = toCents(adv.paidAmount) - toCents(adv.settledAmount);
    advCur = avail < grossCur ? avail : grossCur;
    if (advCur > BigInt(0)) {
      const advAcc = conv(advCur);
      const advAccount = group[cfg.advance.groupAccountField] ?? (await postingAccount(data, cfg.advance.defaultAccount));
      if (!advAccount) throw new UserError("@TAX:AdvanceAccountMissing");
      // DPH už přiznaná ze zálohy: poměrná část se odečte (343 proti 324 / 314)
      const advTaxAll = toCents(adv.taxAmount);
      const paidAll = toCents(adv.paidAmount);
      advTax = advTaxAll > BigInt(0) && paidAll > BigInt(0) ? (advTaxAll * advCur) / paidAll : BigInt(0);
      posting.push({ accountId: String(advAccount), amount: fromCents(s * (advAcc - advTax)), amountCur: fromCents(s * (advCur - advTax)), currencyId: curId, text: String(adv.advanceNum) });
      if (advTax > BigInt(0)) {
        advCode = await data.get("tax.taxCode", String(adv.taxCodeId));
        posting.push({ accountId: String(advCode!.accountId), amount: fromCents(s * advTax), amountCur: fromCents(s * advTax), currencyId: curId, text: String(adv.taxDocNum ?? adv.advanceNum) });
      }
      posting.push({ accountId: String(group[cfg.groupSummaryField]), amount: fromCents(-s * advAcc), amountCur: fromCents(-s * advCur), currencyId: curId, text: String(adv.advanceNum) });
    }
  }

  const docNum = String(header[cfg.docNumField] || header.invoiceNum);
  const voucher = await postVoucher(data, {
    date,
    description: `${docNum}${subject ? ` · ${subject.name}` : ""}`,
    sourceObject: cfg.header,
    sourceId: String(header.id),
    partner: String(partner.accountNum ?? "") || null,
    partnerDims: Object.fromEntries(["dim1", "dim2", "dim3", "dim4", "dim5", "dim6"].map((f) => [f, partner[f] ?? null])),
    lines: posting,
  });

  for (const [codeId, t] of taxByCode) {
    // samovyměření = dvě transakce (daň na výstupu + nárok na vstupu)
    for (const part of taxTransParts(codeRecs.get(codeId)!, fromCents(t.base), fromCents(t.tax)))
      await data.create("tax.trans", {
        ...part,
        // oddíl KH podle dokladu: jednotlivě (A.4 / B.2) jen od 10 000 Kč s DIČ, jinak souhrnně (A.5 / B.3)
        ...(khSectionOf(part.khSection ?? codeRecs.get(codeId)!.khSection, grossAcc, subject?.vatId, !!header.receipt) ?? {}),
        taxDate,
        currencyId: curId,
        baseCur: fromCents(t.baseCur),
        taxCur: fromCents(t.taxCur),
        subjectId: partner.subjectId ?? null,
        vatId: subject?.vatId ?? null,
        documentNum: docNum,
        voucherId: voucher.id,
        sourceObject: cfg.header,
        sourceId: String(header.id),
        // účtenka → KH souhrnně (B.3 / A.5)
        simplified: !!header.receipt,
      });
  }
  // odpočet DPH zálohy v daňových transakcích (záporný základ a daň k DUZP faktury)
  if (adv && advCode && advTax > BigInt(0)) {
    const advBase = (toCents(adv.taxBase) * advCur) / toCents(adv.paidAmount);
    await data.create("tax.trans", {
      taxDate,
      taxCodeId: advCode.id,
      direction: advCode.direction,
      base: fromCents(-advBase),
      tax: fromCents(-advTax),
      currencyId: curId,
      baseCur: fromCents(-advBase),
      taxCur: fromCents(-advTax),
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
    paidAmount: fromCents(advCur),
    closed: advCur >= grossCur,
  });
  if (adv && advCur > BigInt(0)) {
    const settled = toCents(adv.settledAmount) + advCur;
    await data.update(cfg.advance!.object, String(adv.id), { settledAmount: fromCents(settled), status: settled >= toCents(adv.paidAmount) ? "settled" : "paid" });
    // platba zálohy v saldu je vyúčtovaná
    if (settled >= toCents(adv.paidAmount)) {
      for (const t of await data.find(cfg.partnerTrans, { advanceId: adv.id, kind: "advance", closed: false })) await data.update(cfg.partnerTrans, String(t.id), { closed: true });
    }
  }
  await data.update(cfg.header, String(header.id), { status: "posted", voucherId: voucher.id, advanceAmount: fromCents(advCur), paidAmount: fromCents(advCur) });
}

/**
 * Zrušit zaúčtování (oprava chyby, jen superuživatel): faktura zpět do konceptu, zápisy hlavní knihy, daňové
 * transakce a položka salda se smažou, odečtená záloha se vrátí. Nejde u uhrazené faktury, u DPH v podaném
 * přiznání / kontrolním hlášení, v uzavřeném období ani když faktura pohnula skladem. Historie změn zůstane.
 */
export async function unpostInvoice(data: DataApi, cfg: InvoiceConfig, header: RecordData) {
  if (header.status !== "posted" || !header.voucherId) throw new UserError("@SYS:Locked");
  const voucherId = String(header.voucherId);
  const voucher = await data.get("gl.voucher", voucherId);
  // úhrady (banka, deník, zápočet) — nejdřív zrušit párování
  const payments = await data.find(cfg.partnerTrans, { invoiceId: header.id, kind: "payment" }, { take: 1 });
  if (payments.length || toCents(header.paidAmount ?? "0") > toCents(header.advanceAmount ?? "0")) throw new UserError("@TAX:UnpostPaid");
  // otevřené období (datum dokladu)
  await assertOpenPeriod(data, day(voucher?.date ?? header.invoiceDate)!);
  // DPH v podaném přiznání nebo kontrolním hlášení za období DUZP
  const taxes = await data.find("tax.trans", { voucherId }, { take: 1000 });
  for (const t of taxes) {
    const d = day(t.taxDate)!;
    const year = Number(d.slice(0, 4));
    const month = Number(d.slice(5, 7));
    const filed = await data.find("tax.return", { year, status: "filed" }, { take: 100 });
    if (filed.some((r) => Number(r.month) === month || (!r.month && Number(r.quarter) === Math.ceil(month / 3))))
      throw new UserError("@TAX:UnpostFiled", { period: `${String(month).padStart(2, "0")}/${year}` });
  }
  // pohyb skladu (výdej / příjem) — opravit dobropisem nebo skladovým dokladem
  const stock = await data.find("whs.trans", { sourceObject: cfg.header, sourceId: String(header.id) }, { take: 1 }).catch(() => [] as RecordData[]);
  if (stock.length) throw new UserError("@TAX:UnpostStock");

  for (const t of taxes) await data.remove("tax.trans", String(t.id));
  for (const t of await data.find(cfg.partnerTrans, { invoiceId: header.id, voucherId }, { take: 100 })) await data.remove(cfg.partnerTrans, String(t.id));
  // odečtená záloha zpět k vyúčtování
  const advCur = toCents(header.advanceAmount ?? "0");
  if (cfg.advance && header.advanceId && advCur > BigInt(0)) {
    const adv = await data.get(cfg.advance.object, String(header.advanceId));
    if (adv) {
      const settled = toCents(adv.settledAmount) - advCur;
      await data.update(cfg.advance.object, String(adv.id), { settledAmount: fromCents(settled > BigInt(0) ? settled : BigInt(0)), status: "paid" });
      for (const t of await data.find(cfg.partnerTrans, { advanceId: adv.id, kind: "advance", closed: true }, { take: 100 })) await data.update(cfg.partnerTrans, String(t.id), { closed: false });
    }
  }
  await data.update(cfg.header, String(header.id), { status: "draft", voucherId: null, advanceAmount: "0", paidAmount: "0" });
  for (const t of await data.find("gl.trans", { voucherId }, { take: 5000 })) await data.remove("gl.trans", String(t.id));
  if (voucher) await data.remove("gl.voucher", voucherId);
}
