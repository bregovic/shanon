/**
 * Položky (obdoba Product information management / InventTable v D365):
 * měrné jednotky, skupiny položek (DPH a účty) a položky s cenami.
 * Z položek čerpají řádky faktur a později pokladna a e-shop.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule, type DataApi } from "@/core/module";
import { defineObject } from "@/core/object";
import { postingAccount } from "@/modules/gl/setup";

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
  table: "inv_unit",
  label: "@INV:Unit",
  labelPlural: "@INV:Units",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    decimals: { edt: Edts.Int, label: "@INV:Decimals", default: 0 },
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
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    taxCodeId: { edt: TaxRef("@INV:SalesTax"), aliases: ["dph"] },
    revenueAccountId: { edt: AccountRef("@INV:RevenueAccount") },
    purchaseTaxCodeId: { edt: TaxRef("@INV:PurchaseTax") },
    costAccountId: { edt: AccountRef("@INV:CostAccount") },
  },
  titleField: "code",
  list: ["code", "name", "taxCodeId", "revenueAccountId", "purchaseTaxCodeId", "costAccountId"],
  form: [
    { label: "@SYS:General", fields: ["code", "name"] },
    { label: "@INV:Sales", fields: ["taxCodeId", "revenueAccountId"] },
    { label: "@INV:Purchase", fields: ["purchaseTaxCodeId", "costAccountId"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
  lines: [{ object: "inv.item", field: "groupId", label: "@INV:Items", owned: false }],
});

export const item = defineObject({
  id: "inv.item",
  table: "inv_item",
  label: "@INV:Item",
  labelPlural: "@INV:Items",
  scope: "company",
  fields: {
    itemNum: { edt: Edts.Code, label: "@INV:ItemNum", mandatory: true, aliases: ["kod", "kód", "cislo", "číslo", "sku", "code", "id", "plu"] },
    name: { edt: Edts.Name, mandatory: true, aliases: ["nazev", "název", "polozka", "položka", "zbozi", "zboží", "product"] },
    itemType: { edt: enumEdt(ItemType), mandatory: true, default: "item", aliases: ["typ", "druh"] },
    groupId: { edt: refEdt("inv.itemGroup", "@INV:Group"), mandatory: true, aliases: ["skupina", "kategorie", "group", "category"] },
    unitId: { edt: refEdt("inv.unit", "@INV:Unit"), mandatory: true, aliases: ["mj", "měrná jednotka", "unit", "uom"] },
    ean: { edt: Ean, aliases: ["carovy kod", "čárový kód", "barcode", "gtin"] },
    salesPrice: { edt: Edts.Price, label: "@INV:SalesPrice", aliases: ["cena", "prodejni cena", "price"] },
    priceInclTax: { edt: Edts.NoYes, label: "@INV:PriceInclTax", aliases: ["s dph", "vcetne dph", "včetně dph"] },
    taxCodeId: { edt: TaxRef(), aliases: ["dph", "sazba dph", "vat"] },
    priceNet: { edt: Edts.Price, label: "@INV:PriceNet", readOnly: true },
    priceGross: { edt: Edts.Price, label: "@INV:PriceGross", readOnly: true },
    purchasePrice: { edt: Edts.Price, label: "@INV:PurchasePrice", aliases: ["nakupni cena", "nákupní cena", "cena bez dph nakup"] },
    /** marže z prodejní ceny bez DPH: (prodej − nákup) / prodej */
    marginPct: { edt: Edts.Percent, label: "@INV:Margin", readOnly: true },
    vendorId: { edt: refEdt("ap.vendor", "@INV:Vendor"), optionalRef: true, aliases: ["dodavatel", "firma", "vendor", "supplier"] },
    vendorItemName: { edt: Edts.Description, label: "@INV:VendorItemName" },
    weighed: { edt: Edts.NoYes, label: "@INV:Weighed", aliases: ["vazene", "vážené", "na vahu", "na váhu"] },
    description: { edt: Edts.Notes, label: "@INV:Description", aliases: ["popis", "description"] },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
    image: { edt: defineEdt({ id: "ImageRef", kind: "string", label: "@SYS:Image", maxLength: 36 }), image: true, readOnly: true, aliases: ["obrazek", "obrázek", "foto", "fotka", "image", "picture"] },
  },
  titleField: "itemNum",
  list: ["image", "itemNum", "name", "groupId", "unitId", "purchasePrice", "priceNet", "priceGross", "marginPct", "vendorId", "weighed", "blocked"],
  form: [
    { label: "@SYS:General", fields: ["itemNum", "name", "itemType", "groupId", "unitId", "ean", "weighed", "blocked"] },
    { label: "@INV:Prices", fields: ["salesPrice", "priceInclTax", "taxCodeId", "priceNet", "priceGross", "purchasePrice", "marginPct"] },
    { label: "@INV:Purchase", fields: ["vendorId", "vendorItemName"] },
    { label: "@SYS:Image", fields: ["image"] },
    { label: "@INV:Description", fields: ["description"] },
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
];

/** Účty, které položky potřebují a ve výchozí osnově nejsou. */
const ACCOUNTS: [string, string, string][] = [
  ["504000", "Prodané zboží", "expense"],
  ["601000", "Tržby za vlastní výrobky", "revenue"],
];

async function invSetup(data: DataApi) {
  for (const [accountNum, name, type] of ACCOUNTS) {
    if (!(await postingAccount(data, accountNum))) await data.create("gl.account", { accountNum, name, type });
  }
  if (!(await data.find("inv.unit", {}, { take: 1 })).length) {
    for (const [code, name, decimals] of UNITS) await data.create("inv.unit", { code, name, decimals });
  }
  if (!(await data.find("inv.itemGroup", {}, { take: 1 })).length) {
    const acc = (n: string) => postingAccount(data, n);
    const tax = async (c: string) => (await data.find("tax.taxCode", { code: c }, { take: 1 }))[0]?.id ?? null;
    await data.create("inv.itemGroup", {
      code: "ZBOZI",
      name: "Zboží",
      taxCodeId: await tax("V21"),
      revenueAccountId: await acc("604"),
      purchaseTaxCodeId: await tax("P21"),
      costAccountId: await acc("504"),
    });
  }
}

export default defineModule({
  id: "inv",
  label: "@INV:Module",
  description: "@INV:ModuleDesc",
  icon: "Box",
  dependsOn: ["gl", "tax"],
  enums: [ItemType, DiscountKind],
  objects: [unit, itemGroup, item, discount],
  menu: [
    { label: "@INV:Module", items: [{ object: "inv.item" }, { object: "inv.discount" }] },
    { label: "@SYS:Setup", items: [{ object: "inv.itemGroup" }, { object: "inv.unit" }] },
  ],
  numberSeqs: [{ code: "INVITEM", name: "@INV:Items", format: "P{#####}", usedFor: "inv.item" }],
  setup: invSetup,
  labels: {
    cs: {
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
      SalesPrice: "Prodejní cena",
      PriceInclTax: "Cena včetně DPH",
      PriceNet: "Cena bez DPH",
      PriceGross: "Cena s DPH",
      PurchasePrice: "Nákupní cena",
      Weighed: "Prodej na váhu",
      Description: "Popis",
      Prices: "Ceny",
      Margin: "Marže %",
      Vendor: "Hlavní dodavatel",
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
      SalesPrice: "Sales price",
      PriceInclTax: "Price incl. VAT",
      PriceNet: "Price excl. VAT",
      PriceGross: "Price incl. VAT",
      PurchasePrice: "Purchase price",
      Weighed: "Sold by weight",
      Description: "Description",
      Prices: "Prices",
      Margin: "Margin %",
      Vendor: "Main vendor",
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
