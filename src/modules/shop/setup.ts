/**
 * Výchozí nastavení e-shopu (zakládá jen chybějící): obchod (nezveřejněný), odběratel pro objednávky
 * z webu, způsoby dopravy, stránky s podmínkami k doplnění a platební metody pro e-shop.
 */
import type { DataApi, RecordData } from "@/core/module";
import { vatPayer } from "@/modules/tax/orders";

const PAGES: { slug: string; title: string; position: number }[] = [
  { slug: "obchodni-podminky", title: "Obchodní podmínky", position: 10 },
  { slug: "ochrana-osobnich-udaju", title: "Ochrana osobních údajů", position: 20 },
  { slug: "reklamace-a-vraceni", title: "Reklamace a vrácení zboží", position: 30 },
  { slug: "doprava-a-platba", title: "Doprava a platba", position: 40 },
  { slug: "kontakt", title: "Kontakt", position: 50 },
];

/** Text k doplnění — obchod je do zveřejnění skrytý, podmínky musí dodat firma. */
const TODO = "Tento text doplňte v aplikaci: E-shop → Stránky e-shopu.";

async function ensureCustomer(data: DataApi): Promise<string | null> {
  const name = "Zákazníci e-shopu";
  let [subj] = await data.find("gab.subject", { name }, { take: 1 });
  if (!subj) subj = await data.create("gab.subject", { name });
  const [have] = await data.find("ar.customer", { subjectId: subj.id }, { take: 1 });
  if (have) return String(have.id);
  const [group] = await data.find("ar.group", {}, { take: 1, orderBy: { code: "asc" } });
  if (!group) return null;
  return String((await data.create("ar.customer", { subjectId: subj.id, groupId: group.id })).id);
}

/**
 * Kategorie e-shopu jsou kategorie položek. Dřívější `shop.category` se převedou: kategorie položek podle adresy / názvu
 * (jinak nová), položkám bez kategorie se doplní, původní se vypnou (tabulka zanikne v dalším vydání).
 */
async function convertShopCategories(data: DataApi): Promise<void> {
  // převádí se jen aktivní (převedené se vypnou, převod se neopakuje)
  const old = await data.find("shop.category", { active: true }, { take: 2000 });
  if (!old.length) return;
  const map = new Map<string, string>();
  const invCats = await data.find("inv.category", {}, { take: 5000 });
  for (const c of old) {
    const slug = String(c.slug);
    const hit = invCats.find((x) => x.slug === slug) ?? invCats.find((x) => String(x.name).toLowerCase() === String(c.name).toLowerCase());
    if (hit) {
      await data.update("inv.category", String(hit.id), { eshop: true, slug: hit.slug ?? slug, description: hit.description ?? c.description ?? null, image: hit.image ?? c.image ?? null });
      map.set(String(c.id), String(hit.id));
    } else {
      let code = slug.toUpperCase().replace(/-/g, "").slice(0, 16) || "KAT";
      for (let n = 2; invCats.some((x) => x.code === code); n++) code = `${code.slice(0, 14)}${n}`;
      const made = await data.create("inv.category", { code, name: c.name, slug, sortOrder: c.position ?? 100, eshop: c.active !== false, description: c.description ?? null, image: c.image ?? null });
      invCats.push(made);
      map.set(String(c.id), String(made.id));
    }
  }
  for (const c of old) if (c.parentId && map.has(String(c.parentId))) {
    const target = invCats.find((x) => x.id === map.get(String(c.id)));
    if (target && !target.parentId) await data.update("inv.category", String(target.id), { parentId: map.get(String(c.parentId)) });
  }
  for (const i of await data.find("inv.item", { shopCategoryId: { in: [...map.keys()] } }, { take: 10000 })) {
    await data.update("inv.item", String(i.id), { shopCategoryId: null, ...(i.categoryId ? {} : { categoryId: map.get(String(i.shopCategoryId)) }) });
  }
  for (const c of old) await data.update("shop.category", String(c.id), { active: false });
}

export async function shopSetup(data: DataApi): Promise<void> {
  await convertShopCategories(data);
  if (!(await data.find("shop.shop", {}, { take: 1 })).length) {
    const customerId = await ensureCustomer(data);
    if (customerId) {
      const [org] = await data.find("org.entity", {}, { take: 1 }).catch(() => [] as RecordData[]);
      const company = data.companyId ? await data.get("sys.company", data.companyId) : null;
      await data.create("shop.shop", {
        name: String(org?.tradeName ?? org?.legalName ?? company?.name ?? "E-shop").slice(0, 120),
        active: false,
        layout: "classic",
        customerId,
        contactEmail: org?.email ?? null,
        contactPhone: org?.phone ?? null,
      });
    }
  }
  if (!(await data.find("shop.delivery", {}, { take: 1 })).length) {
    // neplátce DPH: doprava bez DPH
    const [v21] = await data.find("tax.taxCode", { code: (await vatPayer(data)) ? "V21" : "BEZ" }, { take: 1 });
    await data.create("shop.delivery", { code: "ODBER", name: "Osobní odběr", kind: "pickup", price: "0", taxCodeId: v21?.id ?? null, position: 10 });
    await data.create("shop.delivery", { code: "ADRESA", name: "Doručení na adresu", kind: "address", price: "99", taxCodeId: v21?.id ?? null, allowCod: true, position: 20 });
  }
  if (!(await data.find("shop.page", {}, { take: 1 })).length) {
    for (const p of PAGES) await data.create("shop.page", { ...p, body: TODO, inFooter: true, active: true });
  }
  // platba bránou (karta, Google Pay, Apple Pay) — nabízí se, jen když je napojená brána Comgate
  if (!(await data.find("bank.paymentMethod", { code: "WEB-KARTA" }, { take: 1 })).length)
    await data.create("bank.paymentMethod", { code: "WEB-KARTA", name: "Kartou, Google Pay, Apple Pay", kind: "card", eshop: true });
  // platební metody pro e-shop: převod (s QR), dobírka, hotově při odběru — jen když firma žádnou nemá
  if (!(await data.find("bank.paymentMethod", { eshop: true }, { take: 50 })).some((m) => m.kind !== "card")) {
    const [acc] = await data.find("bank.account", { blocked: false }, { take: 1, orderBy: { code: "asc" } }).catch(() => [] as RecordData[]);
    for (const [code, name, kind] of [
      ["WEB-PREVOD", "Převodem (QR platba)", "transfer"],
      ["WEB-DOBIRKA", "Dobírkou", "cod"],
      ["WEB-HOTOVE", "Hotově při odběru", "cash"],
    ] as const) {
      const [have] = await data.find("bank.paymentMethod", { code }, { take: 1 });
      if (have) await data.update("bank.paymentMethod", String(have.id), { eshop: true });
      else await data.create("bank.paymentMethod", { code, name, kind, eshop: true, bankAccountId: kind === "transfer" ? (acc?.id ?? null) : null });
    }
  }
}
