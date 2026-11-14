/**
 * Sklad: lokace ve stromu (vlastní úrovně), příjemka nad nákupní objednávkou,
 * rezervace prodejní objednávkou, výdej fakturou, inventura, vyřazení, přesun,
 * přijatá faktura bez objednávky, dostupnost.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { availability } from "@/modules/whs/report";

const runReport = (T: Ctx, _m: string, _id: string, params: Record<string, unknown>, c: typeof client) =>
  inTenant(T, (s) => availability.run(s.sys().api(), params, { companyId: T.companyId, t: (x) => String(x) }), c);

const client = createPrisma();
const run = Date.now().toString(36);
const save = (T: Ctx, o: string, d: Record<string, unknown>, id: string | null = null) => saveRecord(T, o, id, d, undefined, client);
const rows = async (T: Ctx, o: string, filter: Record<string, unknown> = {}) => (await listRecords(T, o, { filter, pageSize: 500 }, client)).rows;

describe("sklad", () => {
  it("lokace, příjemka, rezervace, výdej, inventura, vyřazení, přesun, dostupnost", async () => {
    const T = (await provisionTenant(client, { code: `t-whs-${run}`, name: "WHS", adminEmail: `whs-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "whs"], company: { code: "W", name: "W" } })).ctx;
    // výchozí nastavení: 4 úrovně, hlavní sklad
    expect((await rows(T, "whs.locationLevel")).map((l) => l.name)).toEqual(["Budova", "Místnost", "Regál", "Police"]);
    const [main] = await rows(T, "whs.warehouse");
    expect([main.code, main.isDefault]).toEqual(["HLAVNI", true]);
    const store = await save(T, "whs.warehouse", { code: "PRODEJNA", name: "Prodejna" });

    // lokace: budova A → místnost 01 → regál R1 → police 3 (cesta A.01.R1.3)
    const a = await save(T, "whs.location", { warehouseId: main.id, code: "A" });
    const r01 = await save(T, "whs.location", { warehouseId: main.id, parentId: a.id, code: "01" });
    const rr = await save(T, "whs.location", { warehouseId: main.id, parentId: r01.id, code: "R1" });
    const shelf = await save(T, "whs.location", { warehouseId: main.id, parentId: rr.id, code: "3" });
    expect([shelf.path, shelf.level, shelf.levelName]).toEqual(["A.01.R1.3", 4, "Police"]);
    // pátá úroveň nejde (firma má 4)
    await expect(save(T, "whs.location", { warehouseId: main.id, parentId: shelf.id, code: "X" })).rejects.toMatchObject({ label: "@SYS:FixErrors" });
    // přejmenování přepíše cesty podřízených
    await save(T, "whs.location", { code: "B" }, String(a.id));
    expect((await getRecord(T, "whs.location", String(shelf.id), client))!.path).toBe("B.01.R1.3");

    const [grp] = await rows(T, "inv.itemGroup");
    const [unit] = await rows(T, "inv.unit");
    const item = await save(T, "inv.item", { itemNum: "K1", name: "Klobása", groupId: grp.id, unitId: unit.id, salesPrice: "100", purchasePrice: "60" });
    const svc = await save(T, "inv.item", { itemNum: "S1", name: "Doprava", itemType: "service", groupId: grp.id, unitId: unit.id, salesPrice: "50" });

    // nákupní objednávka → Přijmout na sklad → příjemka se zbytkem → zaúčtovat
    const vs = await save(T, "gab.subject", { name: "Dodavatel" });
    const [vg] = await rows(T, "ap.group");
    const vend = await save(T, "ap.vendor", { subjectId: vs.id, groupId: vg.id });
    const po = await save(T, "ap.order", { vendorId: vend.id });
    await save(T, "ap.orderLine", { orderId: po.id, itemId: item.id, qty: "50" });
    await save(T, "ap.orderLine", { orderId: po.id, itemId: svc.id, qty: "1", unitPrice: "50" });
    await runAction(T, "ap.order", String(po.id), "receive", client);
    const [rcpt] = await rows(T, "whs.journal", { purchaseOrderId: po.id });
    const rl = await rows(T, "whs.journalLine", { journalId: rcpt.id });
    expect(rl.map((l) => [l.qty, l.orderLineId !== null])).toEqual([["50.0000", true]]); // služba se nepřijímá
    // přijmout jen 40 do police
    await save(T, "whs.journalLine", { qty: "40", locationId: shelf.id }, String(rl[0].id));
    await runAction(T, "whs.journal", String(rcpt.id), "post", client);
    const stock = async (wh: unknown) => (await rows(T, "whs.onhand", { itemId: item.id, warehouseId: wh })).reduce((s, r) => s + Number(r.qty), 0);
    expect(await stock(main.id)).toBe(40);
    expect((await rows(T, "ap.orderLine", { orderId: po.id, itemId: item.id }))[0].deliveredQty).toBe("40.0000");
    // druhá příjemka nabídne zbytek 10
    await runAction(T, "ap.order", String(po.id), "receive", client);
    const second = (await rows(T, "whs.journal", { purchaseOrderId: po.id })).find((j) => j.status === "draft")!;
    expect((await rows(T, "whs.journalLine", { journalId: second.id }))[0].qty).toBe("10.0000");

    // prodejní objednávka: potvrzení rezervuje, faktura vydá a rezervaci uvolní
    const cs = await save(T, "gab.subject", { name: "Odběratel" });
    const [cg] = await rows(T, "ar.group");
    const cust = await save(T, "ar.customer", { subjectId: cs.id, groupId: cg.id });
    const so = await save(T, "ar.order", { customerId: cust.id });
    await save(T, "ar.orderLine", { orderId: so.id, itemId: item.id, qty: "15" });
    await runAction(T, "ar.order", String(so.id), "confirm", client);
    expect((await rows(T, "whs.reservation", { sourceId: String(so.id) })).map((r) => r.qty)).toEqual(["15.0000"]);
    let rep = await runReport(T, "whs", "availability", {}, client);
    expect(rep.rows.find((r) => String(r.item).startsWith("K1"))).toMatchObject({ onhand: "40.00", reserved: "15.00", available: "25.00" });
    await runAction(T, "ar.order", String(so.id), "createInvoice", client);
    const inv = (await getRecord(T, "ar.order", String(so.id), client))!.invoiceId;
    await runAction(T, "ar.invoice", String(inv), "post", client);
    expect(await stock(main.id)).toBe(25);
    expect(await rows(T, "whs.reservation", { sourceId: String(so.id) })).toEqual([]);
    const issue = (await rows(T, "whs.trans", { sourceObject: "ar.invoice" }))[0];
    expect([issue.kind, issue.qty]).toEqual(["issue", "-15.0000"]);

    // vyřazení: víc než je na skladě nejde, 5 ks z police jde
    const scrap = await save(T, "whs.journal", { kind: "scrap", warehouseId: main.id });
    await save(T, "whs.journalLine", { journalId: scrap.id, itemId: item.id, locationId: shelf.id, qty: "100", reason: "Prošlé" });
    await expect(runAction(T, "whs.journal", String(scrap.id), "post", client)).rejects.toMatchObject({ label: "@WHS:NotEnough" });
    const [sl] = await rows(T, "whs.journalLine", { journalId: scrap.id });
    await save(T, "whs.journalLine", { qty: "5" }, String(sl.id));
    await runAction(T, "whs.journal", String(scrap.id), "post", client);

    // přesun 10 ks do prodejny
    const tr = await save(T, "whs.journal", { kind: "transfer", warehouseId: main.id, toWarehouseId: store.id });
    await save(T, "whs.journalLine", { journalId: tr.id, itemId: item.id, locationId: shelf.id, qty: "10" });
    await runAction(T, "whs.journal", String(tr.id), "post", client);
    expect([await stock(main.id), await stock(store.id)]).toEqual([10, 10]);

    // inventura prodejny: Načíst stav, napočítáno 8 → rozdíl −2
    const cnt = await save(T, "whs.journal", { kind: "count", warehouseId: store.id });
    await runAction(T, "whs.journal", String(cnt.id), "loadOnhand", client);
    const [cl] = await rows(T, "whs.journalLine", { journalId: cnt.id });
    expect(cl.onhandQty).toBe("10.0000");
    await save(T, "whs.journalLine", { countedQty: "8" }, String(cl.id));
    await runAction(T, "whs.journal", String(cnt.id), "post", client);
    expect(await stock(store.id)).toBe(8);
    expect((await rows(T, "whs.trans", { sourceId: String(cnt.id) }))[0].qty).toBe("-2.0000");

    // přijatá faktura bez objednávky naskladní do výchozího skladu
    const pinv = await save(T, "ap.invoice", { vendorId: vend.id, externalNum: "F-1" });
    await save(T, "ap.invoiceLine", { invoiceId: pinv.id, itemId: item.id, qty: "7", unitPrice: "60" });
    await runAction(T, "ap.invoice", String(pinv.id), "post", client);
    expect(await stock(main.id)).toBe(17);
    rep = await runReport(T, "whs", "availability", { warehouseId: main.id }, client);
    expect(rep.rows.find((r) => String(r.item).startsWith("K1"))).toMatchObject({ onhand: "17.00", available: "17.00" });
  });
});

describe("sklad a pokladna", () => {
  it("účtenka vydá zboží ze skladu pokladny (i do mínusu), služba ne", async () => {
    const { sell } = await import("@/modules/pos/sale");
    const T = (await provisionTenant(client, { code: `t-whp-${run}`, name: "WHP", adminEmail: `whp-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "whs"], company: { code: "P", name: "P" } })).ctx;
    const shop = await save(T, "whs.warehouse", { code: "KRAM", name: "Krám" });
    const [reg] = await rows(T, "pos.register");
    await save(T, "pos.register", { warehouseId: shop.id }, String(reg.id));
    await save(T, "pos.shift", { registerId: reg.id, openingCash: "0" });
    const [grp] = await rows(T, "inv.itemGroup");
    const [unit] = await rows(T, "inv.unit");
    const item = await save(T, "inv.item", { itemNum: "K1", name: "Klobása", groupId: grp.id, unitId: unit.id, salesPrice: "100", priceInclTax: true });
    const svc = await save(T, "inv.item", { itemNum: "S1", name: "Krájení", itemType: "service", groupId: grp.id, unitId: unit.id, salesPrice: "10", priceInclTax: true });
    await inTenant(T, (s) => sell(s.sys().api(), { registerId: String(reg.id), payment: "card", paymentRef: null, lines: [{ itemId: String(item.id), qty: "2.5" }, { itemId: String(svc.id), qty: "1" }] }), client);
    const oh = await rows(T, "whs.onhand", { warehouseId: shop.id });
    expect(oh.map((r) => [r.itemId, r.qty])).toEqual([[item.id, "-2.5000"]]);
    expect((await rows(T, "whs.trans", { warehouseId: shop.id }))[0].kind).toBe("sale");
  });
});
