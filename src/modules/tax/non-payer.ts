/**
 * Zjednodušit DPH pro neplátce (akce na Organizaci): kódy BEZ / P0 a položka DPH Bez DPH, výchozí
 * nastavení (skupiny položek, odběratelů, dodavatelů, položky, doprava) přepojí na ně a smaže kódy,
 * skupiny DPH a položky DPH, které nikde nejsou použité. Použité v dokladech zůstanou (vypíšou se).
 *
 * Kde se na kódy odkazuje, doplní registr (src/registry.ts → `taxRefs`) — modul nesmí importovat registr.
 */
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { taxSetup } from "./index";
import { vatPayer } from "./orders";

/** [objekt, pole] odkazů na daňový kód, skupinu DPH a položku DPH (vyplní registr). */
export const taxRefs: { codes: [string, string][]; groups: [string, string][]; items: [string, string][] } = { codes: [], groups: [], items: [] };

async function used(data: DataApi, refs: [string, string][], id: string, skip: string[] = []): Promise<boolean> {
  for (const [obj, field] of refs) {
    if (skip.includes(obj)) continue;
    try {
      if ((await data.find(obj, { [field]: id }, { take: 1 })).length) return true;
    } catch {
      /* modul objektu vypnutý */
    }
  }
  return false;
}

async function safeFind(data: DataApi, obj: string, where: RecordData = {}): Promise<RecordData[]> {
  try {
    return await data.find(obj, where, { take: 5000 });
  } catch {
    return [];
  }
}

export async function simplifyForNonPayer(data: DataApi): Promise<{ deleted: string[]; kept: string[] }> {
  if (await vatPayer(data)) throw new UserError("@TAX:SimplifyPayer");
  await taxSetup(data); // neplátce: BEZ, P0, skupina Tuzemsko, položka DPH Bez DPH, kombinace
  const one = async (obj: string, code: string) => (await data.find(obj, { code }, { take: 1 }))[0] ?? null;
  const bez = (await one("tax.taxCode", "BEZ"))!;
  const p0 = (await one("tax.taxCode", "P0"))!;
  const bezItem = (await one("tax.itemTaxGroup", "BEZ"))!;
  const tuz = await one("tax.taxGroup", "TUZ");
  const set = async (obj: string, r: RecordData, values: RecordData) => {
    const diff = Object.fromEntries(Object.entries(values).filter(([k, v]) => r[k] !== undefined && r[k] !== null && r[k] !== v));
    if (Object.keys(diff).length) await data.update(obj, String(r.id), diff);
  };
  // výchozí nastavení → bez DPH
  for (const g of await safeFind(data, "inv.itemGroup")) await set("inv.itemGroup", g, { taxCodeId: bez.id, purchaseTaxCodeId: p0.id, itemTaxGroupId: bezItem.id });
  for (const i of await safeFind(data, "inv.item")) await set("inv.item", i, { taxCodeId: bez.id, itemTaxGroupId: bezItem.id });
  for (const g of await safeFind(data, "ar.group")) await set("ar.group", g, { taxCodeId: bez.id, ...(tuz ? { taxGroupId: tuz.id } : {}) });
  for (const g of await safeFind(data, "ap.group")) await set("ap.group", g, { taxCodeId: p0.id, ...(tuz ? { taxGroupId: tuz.id } : {}) });
  for (const d of await safeFind(data, "shop.delivery")) await set("shop.delivery", d, { taxCodeId: bez.id });
  for (const a of await safeFind(data, "gl.account")) await set("gl.account", a, { itemTaxGroupId: bezItem.id });
  // kombinace skupina × položka DPH kromě Tuzemsko × Bez DPH
  for (const m of await safeFind(data, "tax.taxGroupCode"))
    if (!(tuz && m.taxGroupId === tuz.id && m.itemTaxGroupId === bezItem.id)) await data.remove("tax.taxGroupCode", String(m.id));
  const deleted: string[] = [];
  const kept: string[] = [];
  for (const it of await safeFind(data, "tax.itemTaxGroup")) {
    if (it.id === bezItem.id) continue;
    if (await used(data, taxRefs.items, String(it.id))) kept.push(String(it.code));
    else {
      await data.remove("tax.itemTaxGroup", String(it.id));
      deleted.push(String(it.code));
    }
  }
  for (const g of await safeFind(data, "tax.taxGroup")) {
    if (tuz && g.id === tuz.id) continue;
    if (await used(data, taxRefs.groups, String(g.id))) kept.push(String(g.code));
    else {
      await data.remove("tax.taxGroup", String(g.id));
      deleted.push(String(g.code));
    }
  }
  for (const c of await safeFind(data, "tax.taxCode")) {
    if (c.id === bez.id || c.id === p0.id) continue;
    if (await used(data, taxRefs.codes, String(c.id))) kept.push(String(c.code));
    else {
      await data.remove("tax.taxCode", String(c.id));
      deleted.push(String(c.code));
    }
  }
  return { deleted, kept };
}

export const nonPayerHandlers: Record<string, ObjectHandlers> = {
  "org.entity": {
    actions: {
      async simplifyVat(ctx) {
        const r = await simplifyForNonPayer(ctx.data);
        ctx.data.warn?.("@TAX:SimplifyDone", { deleted: r.deleted.join(", ") || "—", kept: r.kept.join(", ") || "—" });
      },
    },
  },
};
