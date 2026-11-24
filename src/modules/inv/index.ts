/**
 * Položky (obdoba Product information management / InventTable v D365):
 * měrné jednotky, skupiny položek (DPH a účty) a položky s cenami.
 * Z položek čerpají řádky faktur a později pokladna a e-shop.
 */
import { DAT_FIELDS } from "@/core/dat-fields";
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule, type DataApi, type RecordData } from "@/core/module";
import { defineObject } from "@/core/object";
import { postingAccount } from "@/modules/gl/setup";
import { vatPayer } from "@/modules/tax/orders";

export const DiscountKind = defineEnum({
  id: "InvDiscountKind",
  label: "@INV:DiscountKind",
  values: [
    { value: "percent", label: "@INV:DiscountPercent" },
    { value: "price", label: "@INV:DiscountPrice" },
  ],
});

export const ItemType = defineEnum({
  id: "ItemType",
  label: "@INV:ItemType",
  values: [
    { value: "item", label: "@INV:TypeItem" },
    { value: "service", label: "@INV:TypeService" },
  ],
});

/** EAN-8, UPC-A, EAN-13, GTIN-14 */
const Ean = defineEdt({ id: "Ean", kind: "string", label: "@INV:Ean", maxLength: 14, pattern: /^(\d{8}|\d{12,14})$/, patternMessage: "@INV:EanHelp", transform: "trim" });
const AccountRef = (label: string) => refEdt("gl.account", label);
const TaxRef = (label = "@TAX:TaxCode") => refEdt("tax.taxCode", label);

export const unit = defineObject({
  id: "inv.unit",
  datLayer: true,
  table: "inv_unit",
  label: "@INV:Unit",
  labelPlural: "@INV:Units",
  scope: "company",
  shareable: true,
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    decimals: { edt: Edts.Int, label: "@INV:Decimals", default: 0 },
    ...DAT_FIELDS,
  },
  titleField: "code",
  list: ["code", "name", "decimals"],
  form: [{ label: "@SYS:General", fields: ["code", "name", "decimals"] }],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
});

export const itemGroup = defineObject({
  id: "inv.itemGroup",
  table: "inv_item_group",
  label: "@INV:Group",
  labelPlural: "@INV:Groups",
  scope: "company",
  shareable: true,
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    /** položka DPH (zboží / služba, sazba) — se skupinou DPH partnera dá daňový kód */
    itemTaxGroupId: { edt: refEdt("tax.itemTaxGroup", "@TAX:ItemTaxGroup"), help: "@INV:GroupTaxHelp", aliases: ["položka dph"] },
    // zastaralé: DPH řádku určuje kombinace skupina DPH partnera × položka DPH (výchozí nastavení údaj převede)
    taxCodeId: { edt: TaxRef("@INV:SalesTax"), readOnly: true },
    revenueAccountId: { edt: AccountRef("@INV:RevenueAccount") },
    purchaseTaxCodeId: { edt: TaxRef("@INV:PurchaseTax"), readOnly: true },
    costAccountId: { edt: AccountRef("@INV:CostAccount") },
  },
  titleField: "code",
  list: ["code", "name", "itemTaxGroupId", "revenueAccountId", "costAccountId"],
  form: [
    { label: "@SYS:General", fields: ["code", "name"] },
    { label: "@INV:Sales", fields: ["itemTaxGroupId", "revenueAccountId"] },
    { label: "@INV:Purchase", fields: ["costAccountId"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
  lines: [{ object: "inv.item", field: "groupId", label: "@INV:Items", owned: false }],
});

/**
 * Kategorie prodeje (obdoba Retail category hierarchy v D365): strom pro
 * členění v pokladně a e-shopu — nezávislý na skupinách položek (ty řídí
 * DPH a účty). Hlavní kategorie = záložky kasy, podřízené = druhá řada.
 */
/** Adresa kategorie v e-shopu: malá písmena, číslice, pomlčka. */
const CategorySlug = defineEdt({ id: "InvCategorySlug", kind: "string", label: "@INV:Slug", maxLength: 60, pattern: /^[a-z0-9][a-z0-9-]{0,59}$/, patternMessage: "@INV:SlugHelp", transform: "lower" });

export const category = defineObject({
  id: "inv.category",
  table: "inv_category",
  label: "@INV:Category",
  labelPlural: "@INV:Categories",
  scope: "company",
  shareable: true,
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    parentId: { edt: refEdt("inv.category", "@INV:ParentCategory"), aliases: ["nadřazená", "nadrazena", "parent"] },
    sortOrder: { edt: Edts.Int, label: "@INV:SortOrder", default: 100, aliases: ["pořadí", "poradi"] },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
    // e-shop (jen se zapnutým modulem E-shop): kategorie pokladny = kategorie obchodu
    eshop: { edt: Edts.NoYes, label: "@INV:CategoryEshop", default: true, module: "shop", help: "@INV:CategoryEshopHelp", aliases: ["v eshopu", "eshop"] },
    slug: { edt: CategorySlug, module: "shop", help: "@INV:SlugAuto", aliases: ["adresa"] },
    description: { edt: Edts.Notes, label: "@SYS:Description", module: "shop", aliases: ["popis"] },
    image: { edt: defineEdt({ id: "CategoryImageRef", kind: "string", label: "@SYS:Image", maxLength: 36 }), image: true, readOnly: true, module: "shop", aliases: ["obrazek", "obrázek"] },
  },
  titleField: "code",
  list: ["code", "name", "parentId", "sortOrder", "eshop", "blocked"],
  form: [
    { label: "@SYS:General", fields: ["code", "name", "parentId", "sortOrder", "blocked"] },
    { label: "@INV:Eshop", fields: ["eshop", "slug", "description", "image"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "sortOrder", dir: "asc" },
  lines: [
    { object: "inv.category", field: "parentId", label: "@INV:SubCategories", owned: false },
    { object: "inv.item", field: "categoryId", label: "@INV:Items", owned: false },
  ],
});

export const item = defineObject({
  id: "inv.item",
  mergeable: true,
  table: "inv_item",
  label: "@INV:Item",
  labelPlural: "@INV:Items",
  scope: "company",
  shareable: true,
  fields: {
    itemNum: { edt: Edts.Code, label: "@INV:ItemNum", mandatory: true, aliases: ["kod", "kód", "cislo", "číslo", "sku", "code", "id", "plu"] },
    name: { edt: Edts.Name, mandatory: true, aliases: ["nazev", "název", "polozka", "položka", "zbozi", "zboží", "product"] },
    itemType: { edt: enumEdt(ItemType), mandatory: true, default: "item", aliases: ["typ", "druh"] },
    groupId: { edt: refEdt("inv.itemGroup", "@INV:Group"), mandatory: true, aliases: ["skupina", "group"] },
    categoryId: { edt: refEdt("inv.category", "@INV:Category"), aliases: ["kategorie", "kategorie pokladny", "category"] },
    unitId: { edt: refEdt("inv.unit", "@INV:Unit"), mandatory: true, aliases: ["mj", "měrná jednotka", "unit", "uom"] },
    ean: { edt: Ean, aliases: ["carovy kod", "čárový kód", "barcode", "gtin"] },
    salesPrice: { edt: Edts.Price, label: "@INV:SalesPrice", aliases: ["cena", "prodejni cena", "price"] },
    /** měna prodejní i nákupní ceny; prázdné = účetní měna (doklad i pokladna přepočtou kurzem) */
    currencyId: { edt: refEdt("sys.currency", "@INV:PriceCurrency"), aliases: ["mena", "měna", "currency"] },
    priceInclTax: { edt: Edts.NoYes, label: "@INV:PriceInclTax", aliases: ["s dph", "vcetne dph", "včetně dph"] },
    /** prázdné = položka DPH skupiny položek */
    itemTaxGroupId: { edt: refEdt("tax.itemTaxGroup", "@TAX:ItemTaxGroup"), help: "@INV:ItemTaxGroupHelp", aliases: ["položka dph"] },
    /** zastaralé — viz skupina položek */
    taxCodeId: { edt: TaxRef(), readOnly: true },
    priceNet: { edt: Edts.Price, label: "@INV:PriceNet", readOnly: true },
    priceGross: { edt: Edts.Price, label: "@INV:PriceGross", readOnly: true },
    purchasePrice: { edt: Edts.Price, label: "@INV:PurchasePrice", aliases: ["nakupni cena", "nákupní cena", "cena bez dph nakup"] },
    /** marže z prodejní ceny bez DPH: (prodej − nákup) / prodej */
    marginPct: { edt: Edts.Percent, label: "@INV:Margin", readOnly: true },
    vendorId: { edt: refEdt("ap.vendor", "@INV:Vendor"), optionalRef: true, aliases: ["dodavatel", "firma", "vendor", "supplier"] },
    /** značka / výrobce (není dodavatel — dodavatel je partner s IČO) */
    brand: { edt: defineEdt({ id: "InvBrand", kind: "string", label: "@INV:Brand", maxLength: 60, transform: "trim" }), aliases: ["značka", "znacka", "výrobce", "brand"] },
    vendorItemName: { edt: Edts.Description, label: "@INV:VendorItemName" },
    weighed: { edt: Edts.NoYes, label: "@INV:Weighed", aliases: ["vazene", "vážené", "na vahu", "na váhu"] },
    /** tarif smlouvy (členství, předplatné): délka jednoho období v měsících; prázdné = není tarif */
    agreementMonths: { edt: Edts.Int, label: "@INV:AgreementMonths", help: "@INV:AgreementMonthsHelp", module: "ar", aliases: ["tarif mesice", "obdobi mesice"] },
    description: { edt: Edts.Notes, label: "@INV:Description", aliases: ["popis", "description"] },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
    image: { edt: defineEdt({ id: "ImageRef", kind: "string", label: "@SYS:Image", maxLength: 36 }), image: true, readOnly: true, aliases: ["obrazek", "obrázek", "foto", "fotka", "image", "picture"] },
    // e-shop (modul shop): položka v obchodě a její kategorie; popis a obrázek jsou společné
    eshop: { edt: Edts.NoYes, label: "@INV:Eshop", module: "shop", aliases: ["eshop", "e-shop", "v eshopu"] },
    /** rezerva ceny při vážení (e-shop); prázdné = podle obchodu */
    weighBufferPct: { edt: Edts.Percent, label: "@INV:WeighBuffer", module: "shop", help: "@INV:WeighBufferHelp", aliases: ["rezerva"] },
    shopCategoryId: { edt: refEdt("shop.category", "@INV:ShopCategory"), optionalRef: true, aliases: ["kategorie eshopu", "kategorie e-shopu"] },
  },
  titleField: "itemNum",
  list: ["image", "itemNum", "name", "categoryId", "groupId", "unitId", "purchasePrice", "priceNet", "priceGross", "marginPct", "brand", "vendorId", "weighed", "eshop", "blocked"],
  form: [
    { label: "@SYS:General", fields: ["itemNum", "name", "itemType", "categoryId", "groupId", "unitId", "ean", "weighed", "blocked"] },
    { label: "@INV:Prices", fields: ["salesPrice", "currencyId", "priceInclTax", "itemTaxGroupId", "priceNet", "priceGross", "purchasePrice", "marginPct"] },
    { label: "@INV:Purchase", fields: ["vendorId", "vendorItemName", "brand"] },
    { label: "@SYS:Image", fields: ["image"] },
    { label: "@INV:Description", fields: ["description"] },
    { label: "@INV:Eshop", fields: ["eshop", "weighBufferPct"] },
    { label: "@INV:AgreementGroup", fields: ["agreementMonths"] },
  ],
  unique: [["itemNum"]],
  numberSeq: { field: "itemNum", seq: "INVITEM" },
  defaultSort: { field: "itemNum", dir: "asc" },
});

/**
 * Sleva (obdoba Retail discounts / prodejních akcí v D365): procento nebo
 * akční cena s DPH, na položku, skupinu nebo celý sortiment, v rozmezí dat.
 * Pokladna použije nejvýhodnější platnou slevu; ruční změny ceny na účtence
 * se zatím nepovolují.
 */
export const discount = defineObject({
  id: "inv.discount",
  table: "inv_discount",
  label: "@INV:Discount",
  labelPlural: "@INV:Discounts",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    kind: { edt: enumEdt(DiscountKind), mandatory: true, default: "percent" },
    percent: { edt: Edts.Percent, label: "@INV:DiscountPercentValue", visibleWhen: { field: "kind", in: ["percent"] } },
    price: { edt: Edts.Price, label: "@INV:DiscountPriceValue", visibleWhen: { field: "kind", in: ["price"] } },
    itemId: { edt: refEdt("inv.item", "@INV:Item") },
    groupId: { edt: refEdt("inv.itemGroup", "@INV:Group") },
    validFrom: { edt: Edts.TransDate, label: "@INV:ValidFrom" },
    validTo: { edt: Edts.TransDate, label: "@INV:ValidTo" },
    active: { edt: Edts.NoYes, label: "@INV:Active", default: true },
  },
  titleField: "code",
  list: ["code", "name", "kind", "percent", "price", "itemId", "groupId", "validFrom", "validTo", "active"],
  form: [
    { label: "@SYS:General", fields: ["code", "name", "kind", "percent", "price", "active"] },
    { label: "@INV:DiscountScope", fields: ["itemId", "groupId", "validFrom", "validTo"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
});

const UNITS: [string, string, number][] = [
  ["KS", "kus", 0],
  ["KG", "kilogram", 3],
  ["G", "gram", 0],
  ["L", "litr", 3],
  ["BAL", "balení", 0],
  ["HOD", "hodina", 2],
  ["NEURC", "neurčeno", 3],
];

/** Účty, které položky potřebují a ve výchozí osnově nejsou. */
const ACCOUNTS: [string, string, string][] = [
  ["504000", "Prodané zboží", "expense"],
  ["601000", "Tržby za vlastní výrobky", "revenue"],
  ["602000", "Tržby z prodeje služeb", "revenue"],
];

async function invSetup(data: DataApi) {
  for (const [accountNum, name, type] of ACCOUNTS) {
    if (!(await postingAccount(data, accountNum))) await data.create("gl.account", { accountNum, name, type });
  }
  if (!(await data.find("inv.unit", {}, { take: 1 })).length) {
    for (const [code, name, decimals] of UNITS) await data.create("inv.unit", { code, name, decimals });
  } else if (!(await data.find("inv.unit", { code: "NEURC" }, { take: 1 })).length) {
    // jednotka „neurčeno“ i stávajícím firmám
    await data.create("inv.unit", { code: "NEURC", name: "neurčeno", decimals: 3 });
  }
  // DPH skupin položek = položka DPH (Zboží 21 %, Služby 21 %…); daňový kód řádku z kombinace se skupinou DPH partnera.
  // Neplátce: položka DPH Bez DPH.
  const payer = await vatPayer(data);
  const acc = (n: string) => postingAccount(data, n);
  const itg = async (c: string) => (await data.find("tax.itemTaxGroup", { code: c }, { take: 1 }))[0]?.id ?? null;
  if (!(await data.find("inv.itemGroup", {}, { take: 1 })).length) {
    await data.create("inv.itemGroup", {
      code: "ZBOZI",
      name: "Zboží",
      itemTaxGroupId: await itg(payer ? "Z21" : "BEZ"),
      revenueAccountId: await acc("604"),
      costAccountId: await acc("504"),
    });
  }
  // služby (i ve stávajících firmách): tržby 602, náklady 518, položka DPH Služby 21 % (EU / třetí země se liší od zboží)
  if (!(await data.find("inv.itemGroup", { code: "SLUZBY" }, { take: 1 })).length) {
    await data.create("inv.itemGroup", {
      code: "SLUZBY",
      name: "Služby",
      itemTaxGroupId: await itg(payer ? "S21" : "BEZ"),
      revenueAccountId: await acc("602"),
      costAccountId: await acc("518"),
    });
  }
  // položka DPH skupin položek bez ní: podle sazby prodejního kódu (21 % → Z21, 12 % → Z12)
  for (const g of await data.find("inv.itemGroup", { itemTaxGroupId: null }, { take: 500 })) {
    const code = g.taxCodeId ? await data.get("tax.taxCode", String(g.taxCodeId)) : null;
    const rate = Number(code?.rate ?? 21);
    const id = await itg(!payer ? "BEZ" : rate >= 20 ? "Z21" : rate >= 11 ? "Z12" : "OSV");
    if (id) await data.update("inv.itemGroup", String(g.id), { itemTaxGroupId: id });
  }
  await convertItemTaxCodes(data, payer);
}

/**
 * Převod zastaralého daňového kódu přímo na položce (z 25. 11. 2026): kód, který dává kombinace Tuzemsko × položka DPH
 * skupiny, se jen smaže; jiný (výjimka, např. 12 % ve skupině 21 %) → položka DPH na položce podle prodejního kódu
 * v kombinacích Tuzemska (služba → S…, jinak Z…). Kód položky se pak vynuluje. Idempotentní.
 */
async function convertItemTaxCodes(data: DataApi, payer: boolean) {
  const items = (await data.find("inv.item", {}, { take: 20000 })).filter((i) => i.taxCodeId);
  if (!items.length) return;
  const [tuz] = await data.find("tax.taxGroup", { code: "TUZ" }, { take: 1 });
  const rows = tuz ? await data.find("tax.taxGroupCode", { taxGroupId: tuz.id }, { take: 200 }) : [];
  const itemGroups = new Map((await data.find("tax.itemTaxGroup", {}, { take: 200 })).map((x) => [String(x.id), String(x.code)]));
  const groups = new Map((await data.find("inv.itemGroup", {}, { take: 2000 })).map((g) => [String(g.id), g]));
  const viaGroup = (g: RecordData | undefined) => rows.find((r) => r.itemTaxGroupId === g?.itemTaxGroupId)?.salesCodeId ?? null;
  for (const it of items) {
    const g = groups.get(String(it.groupId));
    const patch: RecordData = { taxCodeId: null };
    if (!it.itemTaxGroupId && viaGroup(g) !== it.taxCodeId) {
      const fits = rows.filter((r) => r.salesCodeId === it.taxCodeId).map((r) => String(r.itemTaxGroupId));
      const prefer = it.itemType === "service" ? "S" : "Z";
      const pick = fits.find((id) => itemGroups.get(id)?.startsWith(prefer)) ?? fits[0] ?? null;
      if (pick) patch.itemTaxGroupId = pick;
      else if (payer) continue; // kód bez kombinace v Tuzemsku (např. vývoz) — nechat, ať se cena nezmění
    }
    await data.update("inv.item", String(it.id), patch);
  }
}

export default defineModule({
  id: "inv",
  label: "@INV:Module",
  description: "@INV:ModuleDesc",
  icon: "Box",
  dependsOn: ["gl", "tax"],
  enums: [ItemType, DiscountKind],
  objects: [unit, itemGroup, category, item, discount],
  menu: [
    { label: "@INV:Module", items: [{ object: "inv.item" }, { object: "inv.discount" }] },
    { label: "@SYS:Setup", items: [{ object: "inv.category" }, { object: "inv.itemGroup" }, { object: "inv.unit" }] },
  ],
  numberSeqs: [{ code: "INVITEM", name: "@INV:Items", format: "P{#####}", usedFor: "inv.item" }],
  setup: invSetup,
  labels: {
    cs: {
      PriceCurrency: "Měna cen",
      Module: "Položky",
      ModuleDesc: "Zboží, výrobky a služby s cenami, DPH a jednotkami — pro faktury, pokladnu i e-shop.",
      Item: "Položka",
      Items: "Položky",
      ItemNum: "Číslo položky",
      ItemType: "Druh",
      TypeItem: "Zboží / výrobek",
      TypeService: "Služba",
      Unit: "Jednotka",
      Units: "Měrné jednotky",
      Decimals: "Desetinná místa",
      Group: "Skupina položek",
      Groups: "Skupiny položek",
      Sales: "Prodej",
      Purchase: "Nákup",
      SalesTax: "DPH prodej",
      PurchaseTax: "DPH nákup",
      RevenueAccount: "Účet tržeb",
      CostAccount: "Účet nákladů",
      Ean: "EAN",
      EanHelp: "EAN má 8 nebo 12–14 číslic.",
      ItemTaxGroupHelp: "Jen výjimka (např. kniha 12 % ve skupině 21 %). Prázdné = podle skupiny položek. Daňový kód na dokladu dá kombinace se skupinou DPH partnera.",
      GroupTaxHelp: "Co skupina prodává z pohledu DPH (Zboží 21 %, Služby 12 %…). Daňový kód na faktuře dá kombinace se skupinou DPH partnera (Tuzemsko, EU, přenesená povinnost…), v pokladně a e-shopu s Tuzemskem.",
      SalesPrice: "Prodejní cena",
      PriceInclTax: "Cena včetně DPH",
      PriceNet: "Cena bez DPH",
      PriceGross: "Cena s DPH",
      PurchasePrice: "Nákupní cena",
      Weighed: "Prodej na váhu",
      Eshop: "V e-shopu",
      AgreementGroup: "Tarif smlouvy",
      AgreementMonths: "Délka období (měsíce)",
      AgreementMonthsHelp: "Vyplněné = položka je tarif smlouvy (členství, předplatné) a nabízí se ve formuláři smlouvy na portálu.",
      CategoryEshop: "Zobrazit v e-shopu",
      WeighBuffer: "Rezerva při vážení %",
      WeighBufferHelp: "Jen zboží na váhu: o kolik smí skutečná váha překročit objednanou. Prázdné = podle nastavení e-shopu.",
      MergeUnit: "Sloučit lze jen položky se stejnou měrnou jednotkou.",
      MergePriceMode: "Sloučit lze jen položky se stejným zadáním ceny (s DPH / bez DPH) a měnou.",
      CategoryEshopHelp: "Kategorie se v obchodě ukáže, jen když v ní (nebo v podkategorii) je položka v e-shopu.",
      Slug: "Adresa v e-shopu",
      SlugHelp: "Jen malá písmena bez diakritiky, číslice a pomlčka, např. uzeniny.",
      SlugAuto: "Prázdné = doplní se z názvu.",
      ShopCategory: "Kategorie e-shopu",
      Description: "Popis",
      Prices: "Ceny",
      Margin: "Marže %",
      Category: "Kategorie",
      Categories: "Kategorie prodeje",
      ParentCategory: "Nadřazená kategorie",
      SubCategories: "Podkategorie",
      SortOrder: "Pořadí",
      CategoryLoop: "Kategorie nemůže být sama sobě nadřazená.",
      Vendor: "Hlavní dodavatel",
      Brand: "Značka",
      VendorItemName: "Název u dodavatele",
      Discount: "Sleva",
      Discounts: "Slevy a akce",
      DiscountKind: "Druh slevy",
      DiscountPercent: "Procento z ceny",
      DiscountPrice: "Akční cena",
      DiscountPercentValue: "Sleva %",
      DiscountPriceValue: "Akční cena s DPH",
      DiscountScope: "Platnost",
      ValidFrom: "Platí od",
      ValidTo: "Platí do",
      Active: "Aktivní",
      DiscountTarget: "Vyplňte buď položku, nebo skupinu (prázdné = celý sortiment).",
      DiscountValue: "Vyplňte výši slevy.",
    },
    en: {
      PriceCurrency: "Price currency",
      Module: "Products",
      ModuleDesc: "Goods, products and services with prices, VAT and units — for invoices, POS and e-shop.",
      Item: "Item",
      Items: "Items",
      ItemNum: "Item number",
      ItemType: "Type",
      TypeItem: "Goods / product",
      TypeService: "Service",
      Unit: "Unit",
      Units: "Units of measure",
      Decimals: "Decimals",
      Group: "Item group",
      Groups: "Item groups",
      Sales: "Sales",
      Purchase: "Purchase",
      SalesTax: "Sales VAT",
      PurchaseTax: "Purchase VAT",
      RevenueAccount: "Revenue account",
      CostAccount: "Cost account",
      Ean: "EAN",
      EanHelp: "EAN has 8 or 12–14 digits.",
      ItemTaxGroupHelp: "Exception only (e.g. a 12 % book in a 21 % group). Empty = from the item group. The tax code on documents comes from the combination with the partner VAT group.",
      GroupTaxHelp: "What the group sells from the VAT point of view (Goods 21 %, Services 12 %…). The invoice tax code comes from the combination with the partner VAT group (domestic, EU, reverse charge…), POS and e-shop use domestic.",
      SalesPrice: "Sales price",
      PriceInclTax: "Price incl. VAT",
      PriceNet: "Price excl. VAT",
      PriceGross: "Price incl. VAT",
      PurchasePrice: "Purchase price",
      Weighed: "Sold by weight",
      Eshop: "In the e-shop",
      AgreementGroup: "Agreement tariff",
      AgreementMonths: "Period length (months)",
      AgreementMonthsHelp: "Filled in = the item is an agreement tariff (membership, subscription) offered on the portal agreement form.",
      CategoryEshop: "Show in the e-shop",
      WeighBuffer: "Weighing buffer %",
      WeighBufferHelp: "Weighed goods only: how much the actual weight may exceed the ordered one. Empty = e-shop setting.",
      MergeUnit: "Only items with the same unit can be merged.",
      MergePriceMode: "Only items with the same price entry (incl. / excl. VAT) and currency can be merged.",
      CategoryEshopHelp: "The category appears in the shop only when it (or a subcategory) has an e-shop item.",
      Slug: "E-shop address",
      SlugHelp: "Lowercase letters without accents, digits and hyphen only, e.g. sausages.",
      SlugAuto: "Empty = filled in from the name.",
      ShopCategory: "Shop category",
      Description: "Description",
      Prices: "Prices",
      Margin: "Margin %",
      Category: "Category",
      Categories: "Sales categories",
      ParentCategory: "Parent category",
      SubCategories: "Subcategories",
      SortOrder: "Order",
      CategoryLoop: "A category cannot be its own parent.",
      Vendor: "Main vendor",
      Brand: "Brand",
      VendorItemName: "Vendor item name",
      Discount: "Discount",
      Discounts: "Discounts and promotions",
      DiscountKind: "Discount type",
      DiscountPercent: "Percentage off",
      DiscountPrice: "Promotional price",
      DiscountPercentValue: "Discount %",
      DiscountPriceValue: "Promotional price incl. VAT",
      DiscountScope: "Validity",
      ValidFrom: "Valid from",
      ValidTo: "Valid to",
      Active: "Active",
      DiscountTarget: "Fill in either an item or a group (empty = whole assortment).",
      DiscountValue: "Fill in the discount amount.",
    },
  },
});
