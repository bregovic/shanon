/**
 * DPH na řádku účetního deníku (obsluha modulu DPH nad gl.journalLine — hlavní kniha na DPH nezávisí):
 * skupina DPH z dodavatele / odběratele řádku, položka DPH z účtu hlavní knihy, kód z kombinace
 * (ručně zadaný kód zůstane), vypočtená daň a o kolik mění vyrovnanost dokladu (`taxExtra`).
 * Zaúčtování (řádek daně a daňové transakce) dělá deník (`gl/journal.ts`).
 */
import { fromCents, toCents } from "@/core/money";
import type { DataApi, ObjectHandlers, RecordData } from "@/core/module";
import { lineTax, partnerTaxGroup, resolveLineCode, taxOnMain } from "./tax-groups";

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback; // modul partnerů vypnutý
  }
};

async function lineDefaults(data: DataApi, l: RecordData) {
  const vendor = l.vendorId || l.offsetVendorId;
  const customer = l.customerId || l.offsetCustomerId;
  const group = vendor
    ? await safe(() => partnerTaxGroup(data, "ap.vendor", "ap.group", vendor), null)
    : customer
      ? await safe(() => partnerTaxGroup(data, "ar.customer", "ar.group", customer), null)
      : null;
  const accId = String(l.accountType ?? "ledger") === "ledger" && l.accountId ? l.accountId : l.offsetType === "ledger" ? l.offsetAccountId : null;
  const acc = accId ? await data.get("gl.account", String(accId)) : null;
  return { group, item: (acc?.itemTaxGroupId as string) ?? null, vendor: !!vendor, customer: !!customer };
}

export const journalTaxHandlers: Record<string, ObjectHandlers> = {
  "gl.journalLine": {
    async beforeSave(ctx, d, isNew) {
      if (ctx.modules && !ctx.modules.has("tax")) return;
      const before = !isNew && d.id ? await ctx.data.get("gl.journalLine", String(d.id)) : null;
      const now = await lineDefaults(ctx.data, d);
      const old = before ? await lineDefaults(ctx.data, before) : null;
      // výchozí skupina a položka DPH (ručně změněné se nepřepisují)
      if (now.group && (!d.taxGroupId || d.taxGroupId === old?.group)) d.taxGroupId = now.group;
      if (now.item && (!d.itemTaxGroupId || d.itemTaxGroupId === old?.item)) d.itemTaxGroupId = now.item;
      const amount = toCents(d.debit ?? 0) - toCents(d.credit ?? 0);
      const onMain = taxOnMain(d);
      const ledger = onMain ? amount : -amount;
      const side = now.vendor ? "purchase" : now.customer ? "sales" : ledger >= BigInt(0) ? "purchase" : "sales";
      await resolveLineCode(ctx.data, d, before, side);
      const code = d.taxCodeId ? await ctx.data.get("tax.taxCode", String(d.taxCodeId)) : null;
      if (!code) {
        d.taxAmount = null;
        d.taxExtra = null;
        return;
      }
      const journal = d.journalId ? await ctx.data.get("gl.journal", String(d.journalId)) : null;
      const jn = journal?.journalNameId ? await ctx.data.get("gl.journalName", String(journal.journalNameId)) : null;
      const t = lineTax(code, ledger, !!jn?.amountsIncludeTax);
      d.taxAmount = fromCents(t.tax);
      // přičtené DPH mění vyrovnanost jen řádku bez protiúčtu (protiúčet daň pokryje sám)
      const hasOffset = ["offsetAccountId", "offsetCustomerId", "offsetVendorId", "offsetBankAccountId", "offsetCashDeskId"].some((f) => d[f]);
      d.taxExtra = !hasOffset && onMain && t.extra !== BigInt(0) ? fromCents(t.extra) : null;
    },
  },
};
