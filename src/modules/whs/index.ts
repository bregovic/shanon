/**
 * Sklad: sklady a lokace (až 6 vlastních úrovní — budova, místnost, regál,
 * police…), zásoby po lokacích, skladové pohyby, rezervace a skladové
 * deníky (příjemka, inventura, vyřazení, přesun).
 *
 * Pohyby vznikají jen zaúčtováním: deník skladu, příjemka nad nákupní
 * objednávkou, vydaná faktura (výdej), přijatá faktura bez objednávky
 * (příjem), účtenka z pokladny (výdej). Potvrzená prodejní objednávka
 * rezervuje. Zatím v množství (ocenění zásob a účtování 131/132/504 později).
 * Logika v stock.ts.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule, type DataApi } from "@/core/module";
import { defineObject } from "@/core/object";
import { availability } from "./report";

const Str = (id: string, label: string, maxLength: number) => defineEdt({ id, kind: "string", label, maxLength, transform: "trim" });
const LocCode = defineEdt({ id: "WhsLocCode", kind: "string", label: "@WHS:LocCode", maxLength: 20, pattern: /^[A-Za-z0-9._]+$/, patternMessage: "@WHS:LocCodeHelp", transform: "trim" });
const LocPath = Str("WhsLocPath", "@WHS:Location", 120);
const ObjId = Str("WhsSourceObject", "@WHS:Source", 40);
const RecId = Str("WhsSourceId", "@WHS:Source", 36);

export const WhsTransKind = defineEnum({
  id: "WhsTransKind",
  label: "@WHS:TransKind",
  values: [
    { value: "receipt", label: "@WHS:KindReceipt", color: "success" },
    { value: "issue", label: "@WHS:KindIssue", color: "warning" },
    { value: "sale", label: "@WHS:KindSale", color: "warning" },
    { value: "transfer", label: "@WHS:KindTransfer", color: "brand" },
    { value: "count", label: "@WHS:KindCount", color: "informative" },
    { value: "scrap", label: "@WHS:KindScrap", color: "danger" },
  ],
});

export const WhsJournalKind = defineEnum({
  id: "WhsJournalKind",
  label: "@WHS:JournalKind",
  values: [
    { value: "receipt", label: "@WHS:JReceipt" },
    { value: "count", label: "@WHS:JCount" },
    { value: "scrap", label: "@WHS:JScrap" },
    { value: "transfer", label: "@WHS:JTransfer" },
  ],
});

export const WhsStatus = defineEnum({
  id: "WhsJournalStatus",
  label: "@WHS:Status",
  values: [
    { value: "draft", label: "@WHS:Draft", color: "warning" },
    { value: "posted", label: "@WHS:Posted", color: "success" },
  ],
});

/** Úrovně lokací (1–6) a jejich názvy — každá firma si je pojmenuje sama. */
export const locationLevel = defineObject({
  id: "whs.locationLevel",
  table: "whs_location_level",
  label: "@WHS:Level",
  labelPlural: "@WHS:Levels",
  scope: "company",
  shareable: true,
  fields: {
    position: { edt: Edts.Int, label: "@WHS:LevelNo", mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
  },
  titleField: "name",
  list: ["position", "name"],
  form: [{ label: "@SYS:General", fields: ["position", "name"] }],
  unique: [["position"]],
  defaultSort: { field: "position", dir: "asc" },
});

export const warehouse = defineObject({
  id: "whs.warehouse",
  table: "whs_warehouse",
  label: "@WHS:Warehouse",
  labelPlural: "@WHS:Warehouses",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    siteId: { edt: refEdt("org.site", "@WHS:Site"), optionalRef: true },
    isDefault: { edt: Edts.NoYes, label: "@WHS:DefaultWarehouse" },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
  },
  titleField: "code",
  list: ["code", "name", "siteId", "isDefault", "blocked"],
  form: [{ label: "@SYS:General", fields: ["code", "name", "siteId", "isDefault", "blocked"] }],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
  lines: [
    { object: "whs.location", field: "warehouseId", label: "@WHS:Locations" },
    { object: "whs.onhand", field: "warehouseId", label: "@WHS:Onhand", owned: false },
  ],
});

/** Lokace ve stromu: úroveň = úroveň nadřazené + 1, kód = cesta (A.01.03). */
export const location = defineObject({
  id: "whs.location",
  table: "whs_location",
  label: "@WHS:Location",
  labelPlural: "@WHS:Locations",
  scope: "company",
  fields: {
    warehouseId: { edt: refEdt("whs.warehouse", "@WHS:Warehouse"), mandatory: true },
    parentId: { edt: refEdt("whs.location", "@WHS:Parent") },
    code: { edt: LocCode, mandatory: true },
    path: { edt: LocPath, readOnly: true },
    name: { edt: Edts.Name },
    level: { edt: Edts.Int, label: "@WHS:LevelNo", readOnly: true },
    levelName: { edt: Edts.Name, label: "@WHS:Level", readOnly: true },
    blocked: { edt: Edts.NoYes, label: "@GL:Blocked" },
  },
  titleField: "path",
  list: ["path", "name", "levelName", "parentId", "blocked"],
  form: [{ label: "@SYS:General", fields: ["warehouseId", "parentId", "code", "path", "name", "level", "levelName", "blocked"] }],
  unique: [["warehouseId", "path"]],
  defaultSort: { field: "path", dir: "asc" },
});

/** Zásoba položky ve skladu a lokaci (prázdná lokace = sklad bez umístění). */
export const onhand = defineObject({
  id: "whs.onhand",
  table: "whs_onhand",
  label: "@WHS:OnhandRow",
  labelPlural: "@WHS:Onhand",
  scope: "company",
  systemOnly: true,
  fields: {
    itemId: { edt: refEdt("inv.item", "@INV:Item"), mandatory: true },
    warehouseId: { edt: refEdt("whs.warehouse", "@WHS:Warehouse"), mandatory: true },
    locationId: { edt: refEdt("whs.location", "@WHS:Location") },
    qty: { edt: Edts.Qty, label: "@WHS:Qty", mandatory: true, default: 0 },
  },
  titleField: "itemId",
  list: ["itemId", "warehouseId", "locationId", "qty"],
  form: [{ label: "@SYS:General", fields: ["itemId", "warehouseId", "locationId", "qty"] }],
  defaultSort: { field: "itemId", dir: "asc" },
});

/** Skladový pohyb (+ příjem, − výdej). */
export const trans = defineObject({
  id: "whs.trans",
  table: "whs_trans",
  label: "@WHS:Trans",
  labelPlural: "@WHS:TransPlural",
  scope: "company",
  systemOnly: true,
  fields: {
    date: { edt: Edts.TransDate, mandatory: true },
    kind: { edt: enumEdt(WhsTransKind), mandatory: true },
    itemId: { edt: refEdt("inv.item", "@INV:Item"), mandatory: true },
    warehouseId: { edt: refEdt("whs.warehouse", "@WHS:Warehouse"), mandatory: true },
    locationId: { edt: refEdt("whs.location", "@WHS:Location") },
    qty: { edt: Edts.Qty, label: "@WHS:Qty", mandatory: true },
    documentNum: { edt: Edts.Description, label: "@WHS:Document" },
    sourceObject: { edt: ObjId },
    sourceId: { edt: RecId },
    reason: { edt: Edts.Description, label: "@WHS:Reason" },
  },
  titleField: "documentNum",
  list: ["date", "kind", "itemId", "warehouseId", "locationId", "qty", "documentNum", "reason"],
  form: [{ label: "@SYS:General", fields: ["date", "kind", "itemId", "warehouseId", "locationId", "qty", "documentNum", "reason"] }],
  defaultSort: { field: "date", dir: "desc" },
});

/** Rezervace z potvrzené prodejní objednávky (uvolní ji výdej nebo zrušení). */
export const reservation = defineObject({
  id: "whs.reservation",
  table: "whs_reservation",
  label: "@WHS:Reservation",
  labelPlural: "@WHS:Reservations",
  scope: "company",
  systemOnly: true,
  fields: {
    itemId: { edt: refEdt("inv.item", "@INV:Item"), mandatory: true },
    warehouseId: { edt: refEdt("whs.warehouse", "@WHS:Warehouse"), mandatory: true },
    qty: { edt: Edts.Qty, label: "@WHS:Qty", mandatory: true },
    documentNum: { edt: Edts.Description, label: "@WHS:Document" },
    sourceObject: { edt: ObjId },
    sourceId: { edt: RecId },
  },
  titleField: "documentNum",
  list: ["itemId", "warehouseId", "qty", "documentNum"],
  form: [{ label: "@SYS:General", fields: ["itemId", "warehouseId", "qty", "documentNum"] }],
  defaultSort: { field: "documentNum", dir: "asc" },
});

const TRANSFER = { field: "kind", in: ["transfer"] };

/** Skladový deník: příjemka, inventura, vyřazení (ztráta, poškození), přesun. */
export const journal = defineObject({
  id: "whs.journal",
  table: "whs_journal",
  label: "@WHS:Journal",
  labelPlural: "@WHS:Journals",
  scope: "company",
  fields: {
    journalNum: { edt: Edts.Code, label: "@WHS:JournalNum", mandatory: true, readOnly: true },
    kind: { edt: enumEdt(WhsJournalKind), mandatory: true, default: "receipt" },
    warehouseId: { edt: refEdt("whs.warehouse", "@WHS:Warehouse"), mandatory: true },
    toWarehouseId: { edt: refEdt("whs.warehouse", "@WHS:ToWarehouse"), visibleWhen: TRANSFER },
    date: { edt: Edts.TransDate, mandatory: true, default: "$today" },
    description: { edt: Edts.Description },
    purchaseOrderId: { edt: refEdt("ap.order", "@WHS:PurchaseOrder"), optionalRef: true, readOnly: true },
    status: { edt: enumEdt(WhsStatus), mandatory: true, default: "draft", readOnly: true },
  },
  titleField: "journalNum",
  list: ["journalNum", "kind", "warehouseId", "toWarehouseId", "date", "description", "purchaseOrderId", "status"],
  form: [{ label: "@SYS:General", fields: ["journalNum", "kind", "warehouseId", "toWarehouseId", "date", "description", "purchaseOrderId", "status"] }],
  numberSeq: { field: "journalNum", seq: "WHSJ" },
  defaultSort: { field: "date", dir: "desc" },
  compactHeader: true,
  lines: [{ object: "whs.journalLine", field: "journalId", label: "@WHS:Lines", inline: true }],
  actions: [
    { id: "loadOnhand", label: "@WHS:LoadOnhand", when: { field: "status", equals: "draft" } },
    { id: "post", label: "@WHS:Post", when: { field: "status", equals: "draft" } },
  ],
  lockedWhen: { field: "status", equals: "posted" },
});

export const journalLine = defineObject({
  id: "whs.journalLine",
  table: "whs_journal_line",
  label: "@WHS:Line",
  labelPlural: "@WHS:Lines",
  scope: "company",
  fields: {
    journalId: { edt: refEdt("whs.journal", "@WHS:Journal"), mandatory: true },
    itemId: { edt: refEdt("inv.item", "@INV:Item"), mandatory: true },
    locationId: { edt: refEdt("whs.location", "@WHS:Location") },
    toLocationId: { edt: refEdt("whs.location", "@WHS:ToLocation") },
    qty: { edt: Edts.Qty, label: "@WHS:Qty" },
    onhandQty: { edt: Edts.Qty, label: "@WHS:OnhandQty", readOnly: true },
    countedQty: { edt: Edts.Qty, label: "@WHS:CountedQty" },
    reason: { edt: Edts.Description, label: "@WHS:Reason" },
    orderLineId: { edt: refEdt("ap.orderLine", "@WHS:OrderLine"), optionalRef: true, readOnly: true },
  },
  titleField: "itemId",
  list: ["itemId", "locationId", "toLocationId", "qty", "onhandQty", "countedQty", "reason"],
  form: [{ label: "@SYS:General", fields: ["journalId", "itemId", "locationId", "toLocationId", "qty", "onhandQty", "countedQty", "reason"] }],
});

/** Výchozí nastavení: úrovně lokací a hlavní sklad. */
async function whsSetup(data: DataApi) {
  if (!(await data.find("whs.locationLevel", {}, { take: 1 })).length) {
    for (const [position, name] of [
      [1, "Budova"],
      [2, "Místnost"],
      [3, "Regál"],
      [4, "Police"],
    ] as const) {
      await data.create("whs.locationLevel", { position, name });
    }
  }
  if (!(await data.find("whs.warehouse", {}, { take: 1 })).length) await data.create("whs.warehouse", { code: "HLAVNI", name: "Hlavní sklad", isDefault: true });
}

export default defineModule({
  id: "whs",
  label: "@WHS:Module",
  description: "@WHS:ModuleDesc",
  icon: "BoxMultiple",
  dependsOn: ["inv"],
  enums: [WhsTransKind, WhsJournalKind, WhsStatus],
  objects: [locationLevel, warehouse, location, onhand, trans, reservation, journal, journalLine],
  numberSeqs: [{ code: "WHSJ", name: "@WHS:Journals", format: "SKL{YY}{#####}", usedFor: "whs.journal" }],
  setup: whsSetup,
  reports: [availability],
  menu: [
    { label: "@WHS:Module", items: [{ object: "whs.onhand" }, { object: "whs.journal" }, { object: "whs.trans" }, { object: "whs.reservation" }] },
    { label: "@SYS:Reports", kind: "reports", items: [{ href: "/report/whs/availability", label: "@WHS:Availability" }] },
    { label: "@SYS:Setup", kind: "setup", items: [{ object: "whs.warehouse" }, { object: "whs.location" }, { object: "whs.locationLevel" }] },
  ],
  labels: {
    cs: {
      Module: "Sklad",
      ModuleDesc: "Sklady a lokace, zásoby, příjemky, inventury, vyřazení, přesuny a rezervace.",
      Level: "Úroveň lokace",
      Levels: "Úrovně lokací",
      LevelNo: "Úroveň",
      Warehouse: "Sklad",
      Warehouses: "Sklady",
      ToWarehouse: "Do skladu",
      Site: "Provozovna",
      DefaultWarehouse: "Výchozí sklad",
      Location: "Lokace",
      Locations: "Lokace",
      ToLocation: "Do lokace",
      Parent: "Nadřazená lokace",
      LocCode: "Kód",
      LocCodeHelp: "Písmena, číslice, tečka nebo podtržítko.",
      OnhandRow: "Zásoba",
      Onhand: "Zásoby",
      Qty: "Množství",
      Trans: "Skladový pohyb",
      TransPlural: "Skladové pohyby",
      TransKind: "Druh pohybu",
      KindReceipt: "Příjem",
      KindIssue: "Výdej",
      KindSale: "Prodej",
      KindTransfer: "Přesun",
      KindCount: "Inventura",
      KindScrap: "Vyřazení",
      Document: "Doklad",
      Source: "Zdroj",
      Reason: "Důvod",
      Reservation: "Rezervace",
      Reservations: "Rezervace",
      Journal: "Skladový deník",
      Journals: "Skladové deníky",
      JournalNum: "Číslo",
      JournalKind: "Druh deníku",
      JReceipt: "Příjemka",
      JCount: "Inventura",
      JScrap: "Vyřazení (ztráta, poškození)",
      JTransfer: "Přesun",
      PurchaseOrder: "Nákupní objednávka",
      OrderLine: "Řádek objednávky",
      Status: "Stav",
      Draft: "Rozpracovaný",
      Posted: "Zaúčtovaný",
      Lines: "Řádky",
      Line: "Řádek",
      OnhandQty: "Stav v evidenci",
      CountedQty: "Napočítáno",
      LoadOnhand: "Načíst stav",
      Post: "Zaúčtovat",
      Reports: "Reporty",
      Availability: "Dostupnost zásob",
      AvailabilityDesc: "Zásoba, rezervace a dostupné množství po položkách a skladech.",
      Reserved: "Rezervováno",
      Available: "Dostupné",
      ItemName: "Položka",
      Receive: "Přijmout na sklad",
      DeliveredQty: "Dodáno",
      NotEnough: "Na skladě {wh} není dost „{item}“ (k dispozici {qty}).",
      LocationOtherWarehouse: "Lokace patří jinému skladu.",
      TooDeep: "Firma má definováno {n} úrovní lokací.",
      NoWarehouse: "Chybí sklad — založte ho v Nastavení skladu.",
      QtyRequired: "Vyplňte množství.",
      CountedRequired: "Vyplňte napočítané množství.",
      TransferTarget: "Vyplňte cílový sklad nebo lokaci.",
      NothingToReceive: "Na objednávce už není nic k přijetí.",
    },
    en: {
      Module: "Warehouse",
      ModuleDesc: "Warehouses and locations, stock, receipts, counts, scrapping, transfers and reservations.",
      Level: "Location level",
      Levels: "Location levels",
      LevelNo: "Level",
      Warehouse: "Warehouse",
      Warehouses: "Warehouses",
      ToWarehouse: "To warehouse",
      Site: "Site",
      DefaultWarehouse: "Default warehouse",
      Location: "Location",
      Locations: "Locations",
      ToLocation: "To location",
      Parent: "Parent location",
      LocCode: "Code",
      LocCodeHelp: "Letters, digits, dot or underscore.",
      OnhandRow: "Stock",
      Onhand: "On-hand stock",
      Qty: "Quantity",
      Trans: "Inventory transaction",
      TransPlural: "Inventory transactions",
      TransKind: "Transaction type",
      KindReceipt: "Receipt",
      KindIssue: "Issue",
      KindSale: "Sale",
      KindTransfer: "Transfer",
      KindCount: "Count",
      KindScrap: "Scrap",
      Document: "Document",
      Source: "Source",
      Reason: "Reason",
      Reservation: "Reservation",
      Reservations: "Reservations",
      Journal: "Inventory journal",
      Journals: "Inventory journals",
      JournalNum: "Number",
      JournalKind: "Journal type",
      JReceipt: "Receipt",
      JCount: "Counting",
      JScrap: "Scrap (loss, damage)",
      JTransfer: "Transfer",
      PurchaseOrder: "Purchase order",
      OrderLine: "Order line",
      Status: "Status",
      Draft: "Draft",
      Posted: "Posted",
      Lines: "Lines",
      Line: "Line",
      OnhandQty: "On hand",
      CountedQty: "Counted",
      LoadOnhand: "Load on-hand",
      Post: "Post",
      Reports: "Reports",
      Availability: "Stock availability",
      AvailabilityDesc: "On-hand, reserved and available quantity by item and warehouse.",
      Reserved: "Reserved",
      Available: "Available",
      ItemName: "Item",
      Receive: "Receive into stock",
      DeliveredQty: "Delivered",
      NotEnough: "Warehouse {wh} does not have enough “{item}” (available {qty}).",
      LocationOtherWarehouse: "The location belongs to another warehouse.",
      TooDeep: "The company has {n} location levels defined.",
      NoWarehouse: "No warehouse — create one in the warehouse setup.",
      QtyRequired: "Enter the quantity.",
      CountedRequired: "Enter the counted quantity.",
      TransferTarget: "Enter the target warehouse or location.",
      NothingToReceive: "Nothing left to receive on the order.",
    },
  },
});
