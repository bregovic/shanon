/**
 * E-shop: výchozí nastavení, katalog (jen položky v e-shopu, slevy), košík s dopravou a platbami,
 * objednávka → prodejní objednávka s cenami s DPH + záloha s VS, uhrazení zálohy, zrušení, limit.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { listProducts, orderView, pickupWindow, placeOrder, pragueNow, quote, slugify, type OrderInput } from "@/modules/shop/catalog";
import { completePick, pickBoard, setPick } from "@/modules/shop/picking";
import type { DataApi, RecordData } from "@/core/module";

const client = createPrisma();
const run = Date.now().toString(36);

describe("e-shop", () => {
  let S: Ctx;
  let shop: RecordData;
  const ids: Record<string, string> = {};
  const api = <T>(fn: (a: DataApi) => Promise<T>) => inTenant(S, (s) => fn(s.sys().api()), client);
  const pm = async (code: string) => String((await listRecords(S, "bank.paymentMethod", { filter: { code } }, client)).rows[0].id);
  const dl = async (code: string) => String((await listRecords(S, "shop.delivery", { filter: { code } }, client)).rows[0].id);
  const buyer = { name: "Jana Nováková", email: "jana@example.test", street: "Dlouhá 1", city: "Praha", zip: "11000" };

  beforeAll(async () => {
    S = (await provisionTenant(client, { code: `t-shop-${run}`, name: "Shop", adminEmail: `shop-${run}@test.local`, adminPassword: "heslo-12345", modules: ["shop"], company: { code: "E", name: "Eshop s.r.o." } })).ctx;
    shop = (await listRecords(S, "shop.shop", {}, client)).rows[0];
    const g = (await listRecords(S, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const ks = (await listRecords(S, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const kg = (await listRecords(S, "inv.unit", { filter: { code: "KG" } }, client)).rows[0];
    const cat = await saveRecord(S, "inv.category", null, { code: "UZ", name: "Uzeniny" }, undefined, client);
    ids.cat = String(cat.id);
    ids.a = String((await saveRecord(S, "inv.item", null, { itemNum: "A1", name: "Klobása", groupId: g.id, unitId: ks.id, salesPrice: "100", priceInclTax: true, eshop: true, categoryId: cat.id }, undefined, client)).id);
    ids.w = String((await saveRecord(S, "inv.item", null, { itemNum: "W1", name: "Šunka od kosti", groupId: g.id, unitId: kg.id, salesPrice: "400", priceInclTax: true, weighed: true, eshop: true }, undefined, client)).id);
    ids.x = String((await saveRecord(S, "inv.item", null, { itemNum: "X1", name: "Mimo obchod", groupId: g.id, unitId: ks.id, salesPrice: "50", priceInclTax: true }, undefined, client)).id);
  }, 120_000);

  it("výchozí nastavení: obchod nezveřejněný, doprava, stránky, platby pro e-shop", async () => {
    expect([shop.active, shop.layout, !!shop.customerId]).toEqual([false, "classic", true]);
    expect((await listRecords(S, "shop.delivery", {}, client)).rows.map((d) => d.code).sort()).toEqual(["ADRESA", "ODBER"]);
    expect((await listRecords(S, "shop.page", {}, client)).total).toBe(5);
    expect((await listRecords(S, "bank.paymentMethod", { filter: { eshop: "true" } }, client)).rows.map((p) => p.code).sort()).toEqual(["WEB-DOBIRKA", "WEB-HOTOVE", "WEB-KARTA", "WEB-PREVOD"]);
    // zveřejnit bez zkratky organizace nejde; druhý obchod taky ne
    await expect(saveRecord(S, "shop.shop", String(shop.id), { ...shop, active: true }, undefined, client)).rejects.toBeTruthy();
    await expect(saveRecord(S, "shop.shop", null, { name: "Druhý", customerId: shop.customerId }, undefined, client)).rejects.toBeTruthy();
    expect(slugify("Šunka od kosti – 1 kg")).toBe("sunka-od-kosti-1-kg");
  });

  it("katalog: jen položky v e-shopu, kategorie, sleva", async () => {
    const all = await api((a) => listProducts(a, shop));
    expect(all.map((p) => p.itemNum).sort()).toEqual(["A1", "W1"]);
    expect((await api((a) => listProducts(a, shop, { categoryId: ids.cat }))).map((p) => p.itemNum)).toEqual(["A1"]);
    expect((await api((a) => listProducts(a, shop, { q: "šunka" }))).map((p) => p.itemNum)).toEqual(["W1"]);
    await saveRecord(S, "inv.discount", null, { code: "AKCE", name: "Akce", kind: "percent", percent: "10", itemId: ids.a }, undefined, client);
    const [a1] = await api((a) => listProducts(a, shop, { q: "klob" }));
    expect([a1.price, a1.regularPrice]).toEqual(["90.00", "100.00"]);
  });

  it("kategorie položek = kategorie e-shopu (adresa z názvu, jen s položkou v obchodě); převod dřívějších kategorií e-shopu", async () => {
    const empty = await saveRecord(S, "inv.category", null, { code: "NAP", name: "Nápoje" }, undefined, client);
    expect((await getRecord(S, "inv.category", ids.cat, client))!.slug).toBe("uzeniny");
    expect(empty.slug).toBe("napoje");
    // dřívější kategorie e-shopu se při výchozím nastavení převede a položka ji převezme
    const old = await saveRecord(S, "shop.category", null, { name: "Sýry", slug: "syry", description: "Zrající" }, undefined, client);
    const g = (await listRecords(S, "inv.itemGroup", { pageSize: 1 }, client)).rows[0];
    const ks = (await listRecords(S, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const it2 = await saveRecord(S, "inv.item", null, { itemNum: "S1", name: "Eidam", groupId: g.id, unitId: ks.id, salesPrice: "50", eshop: true, shopCategoryId: old.id }, undefined, client);
    await inTenant(S, (s) => import("@/modules/shop/setup").then((m) => m.shopSetup(s.sys().api())), client);
    const conv = (await listRecords(S, "inv.category", { filter: { slug: "syry" } }, client)).rows[0];
    expect([conv?.name, conv?.description, conv?.eshop]).toEqual(["Sýry", "Zrající", true]);
    const it2b = (await getRecord(S, "inv.item", String(it2.id), client))!;
    expect([it2b.categoryId, it2b.shopCategoryId]).toEqual([conv.id, null]);
    expect((await getRecord(S, "shop.category", String(old.id), client))!.active).toBe(false);
  }, 60_000);

  it("košík: ceny ze serveru, vážené zboží, doprava a povolené platby", async () => {
    const odber = await dl("ODBER");
    const adresa = await dl("ADRESA");
    const q = await api((a) => quote(a, shop, { lines: [{ itemId: ids.a, qty: 2 }, { itemId: ids.w, qty: "0,25" }, { itemId: ids.x, qty: 1 }, { itemId: ids.a, qty: 1 }], deliveryId: odber }));
    // položka mimo obchod vypadne, stejná položka se sečte; 3 × 90 + 0,25 × 400
    expect(q.lines.map((l) => `${l.itemNum}:${l.qty}:${l.amount}`)).toEqual(["A1:3:270.00", "W1:0.25:100.00"]);
    expect([q.itemsTotal, q.deliveryPrice, q.total]).toEqual(["370.00", "0.00", "370.00"]);
    // osobní odběr: hotově a převodem, dobírka ne
    expect(q.payments.map((p) => p.kind).sort()).toEqual(["cash", "transfer"]);
    const q2 = await api((a) => quote(a, shop, { lines: [{ itemId: ids.a, qty: 1 }], deliveryId: adresa }));
    expect(q2.payments.map((p) => p.kind).sort()).toEqual(["cod", "transfer"]);
    expect([q2.deliveryPrice, q2.total]).toEqual(["99.00", "189.00"]);
  });

  it("objednávka převodem: prodejní objednávka s cenami s DPH, záloha s VS, uhrazení, stav pro kupujícího", async () => {
    const input: OrderInput = { lines: [{ itemId: ids.a, qty: 2 }], deliveryId: await dl("ADRESA"), paymentMethodId: await pm("WEB-PREVOD"), buyer, terms: true };
    // bez souhlasu s podmínkami a bez adresy ne
    const bad = await api((a) => placeOrder(a, shop, { ...input, terms: false, buyer: { name: "X", email: "x@example.test" } }, "ip1", "t".repeat(24)));
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors ?? {}).sort()).toEqual(["city", "street", "terms", "zip"]);
    const r = await api((a) => placeOrder(a, shop, input, "ip1", "a".repeat(32)));
    expect(r.ok).toBe(true);
    const [so] = (await listRecords(S, "shop.order", { filter: { orderNum: String(r.orderNum) } }, client)).rows;
    // 2 × 90 + doprava 99 = 279 — součet objednávky sedí na košík (ceny s DPH)
    expect([so.status, so.amountGross]).toEqual(["awaitingPayment", "279.00"]);
    const o = (await getRecord(S, "ar.order", String(so.arOrderId), client))!;
    expect([o.status, o.pricesInclTax, o.amountGross, o.externalRef]).toEqual(["confirmed", true, "279.00", r.orderNum]);
    const adv = (await getRecord(S, "ar.advance", String(so.advanceId), client))!;
    expect(adv.amount).toBe("279.00");
    const v = (await api((a) => orderView(a, "a".repeat(32))))!;
    expect([v.total, v.transfer?.vs, v.transfer?.amount, v.lines.length]).toEqual(["279.00", adv.vs, "279.00", 2]);
    // uhrazená záloha → objednávka k vyřízení
    await api((a) => a.update("ar.advance", String(adv.id), { status: "paid", paidAmount: "279.00" }));
    expect((await getRecord(S, "shop.order", String(so.id), client))!.status).toBe("paid");
    // zrušit uhrazenou nejde, vyřídit ano
    await expect(runAction(S, "shop.order", String(so.id), "cancel", client)).rejects.toMatchObject({ label: "@SHOP:CancelPaid" });
    await runAction(S, "shop.order", String(so.id), "ship", client);
    expect((await getRecord(S, "shop.order", String(so.id), client))!.status).toBe("shipped");
    // faktura z objednávky převezme ceny s DPH
    await runAction(S, "ar.order", String(o.id), "createInvoice", client);
    const [inv] = (await listRecords(S, "ar.invoice", { filter: { orderId: String(o.id) } }, client)).rows;
    expect([inv.pricesInclTax, inv.amountGross]).toEqual([true, "279.00"]);
  }, 120_000);

  it("vážené zboží: den vyzvednutí, cena nejvýše, bez zálohy, vychystání podle skutečné váhy, faktura", async () => {
    const now = pragueNow();
    const tomorrow = new Date(Date.parse(`${now.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const base: OrderInput = { lines: [{ itemId: ids.w, qty: "1" }, { itemId: ids.a, qty: 1 }], deliveryId: await dl("ODBER"), paymentMethodId: await pm("WEB-PREVOD"), buyer, terms: true };
    // košík: odhad 400 + 90, nejvýše 440 + 90 (rezerva 10 %), karta se nenabízí
    const q = await api((a) => quote(a, shop, base));
    expect([q.estimated, q.total, q.totalMax, q.payments.some((x) => x.kind === "card")]).toEqual([true, "490.00", "530.00", false]);
    // bez dne / den mimo rozmezí / hodina mimo otevírací dobu
    const noDay = await api((a) => placeOrder(a, shop, base, "ip-w", "w".repeat(30)));
    expect(Object.keys(noDay.errors ?? {})).toContain("pickupDate");
    const badHour = await api((a) => placeOrder(a, shop, { ...base, pickupDate: tomorrow, pickupHour: 23 }, "ip-w", "w".repeat(30)));
    expect(Object.keys(badHour.errors ?? {})).toContain("pickupHour");
    // dnes, co nejdřív (obchod dovoluje vyzvednutí ještě dnes): den = dnes, bez hodiny; bez zavírací hodiny, ať test nezávisí na čase
    const asap = await api((a) => placeOrder(a, { ...shop, pickupTo: null }, { ...base, pickupAsap: true, pickupHour: 23 }, "ip-a", "q".repeat(32)));
    expect(asap.ok).toBe(true);
    const [soA] = (await listRecords(S, "shop.order", { filter: { orderNum: String(asap.orderNum) } }, client)).rows;
    expect([String(soA.pickupDate).slice(0, 10), soA.pickupHour, soA.pickupAsap]).toEqual([now.date, null, true]);
    const r = await api((a) => placeOrder(a, shop, { ...base, pickupDate: tomorrow, pickupHour: 10 }, "ip-w", "w".repeat(32)));
    expect(r.ok).toBe(true);
    const [so] = (await listRecords(S, "shop.order", { filter: { orderNum: String(r.orderNum) } }, client)).rows;
    expect([so.status, so.advanceId ?? null, String(so.pickupDate).slice(0, 10), so.pickupHour, so.estimated, so.amountMax]).toEqual(["toPick", null, tomorrow, 10, true, "530.00"]);

    // vychystávání: den, souhrn položek, váha
    const board = await api((a) => pickBoard(a, tomorrow));
    const mine = board.orders.find((o) => o.id === so.id)!;
    expect(mine.picks.map((p) => [p.name, p.orderedQty, p.maxQty, p.status])).toEqual([["Šunka od kosti", "1", "1.1", "pending"], ["Klobása", "1", "1", "pending"]]);
    expect(board.items.find((i) => i.name === "Šunka od kosti")!.ordered).toBe("1");
    await expect(api((a) => completePick(a, String(so.id)))).rejects.toMatchObject({ label: "@SHOP:PickNotDone" });
    const ham = mine.picks[0];
    const sausage = mine.picks[1];
    await api((a) => setPick(a, ham.id, "1,045", false));
    await api((a) => setPick(a, sausage.id, null, true)); // klobása chybí
    expect((await getRecord(S, "shop.order", String(so.id), client))!.status).toBe("picking");
    const invId = await api((a) => completePick(a, String(so.id)));
    const inv = (await getRecord(S, "ar.invoice", invId, client))!;
    // 1,045 kg × 400 = 418 Kč, klobása pryč, doprava (osobní odběr 0)
    expect([inv.status, inv.amountGross]).toEqual(["posted", "418.00"]);
    const after = (await getRecord(S, "shop.order", String(so.id), client))!;
    expect([after.status, after.amountGross, after.estimated]).toEqual(["ready", "418.00", false]);
    const lines = (await listRecords(S, "ar.invoiceLine", { filter: { invoiceId: invId } }, client)).rows.filter((l) => l.itemId);
    expect(lines.map((l) => Number(l.qty))).toEqual([1.045]);
    // vyřízeno = předáno zákazníkovi
    await runAction(S, "shop.order", String(so.id), "ship", client);
    expect((await getRecord(S, "shop.order", String(so.id), client))!.status).toBe("shipped");
  }, 180_000);

  it("vyzvednutí: pražské datum, po zavírací hodině až zítra", () => {
    // 23:30 UTC 18. 11. = 0:30 v Praze 19. 11.
    expect(pragueNow(new Date("2026-11-18T23:30:00Z"))).toEqual({ date: "2026-11-19", hour: 0 });
    expect(pragueNow(new Date("2026-07-01T22:30:00Z"))).toEqual({ date: "2026-07-02", hour: 0 });
    const s = { pickupLeadDays: 0, pickupMaxDays: 14, pickupFrom: 8, pickupTo: 17 };
    expect(pickupWindow(s, "2026-11-18", 10).minDate).toBe("2026-11-18");
    expect(pickupWindow(s, "2026-11-18", 17).minDate).toBe("2026-11-19");
    expect(pickupWindow({ ...s, pickupTo: null }, "2026-11-18", 22).minDate).toBe("2026-11-18");
    expect(pickupWindow({ ...s, pickupLeadDays: 2 }, "2026-11-18", 20).minDate).toBe("2026-11-20");
  });

  it("dobírka bez zálohy, zrušení, limit objednávek z adresy", async () => {
    const input: OrderInput = { lines: [{ itemId: ids.a, qty: 1 }], deliveryId: await dl("ADRESA"), paymentMethodId: await pm("WEB-DOBIRKA"), buyer, terms: true };
    const r = await api((a) => placeOrder(a, shop, input, "ip2", "b".repeat(32)));
    const [so] = (await listRecords(S, "shop.order", { filter: { orderNum: String(r.orderNum) } }, client)).rows;
    expect([so.status, so.advanceId ?? null]).toEqual(["paid", null]);
    await runAction(S, "shop.order", String(so.id), "cancel", client);
    expect((await getRecord(S, "shop.order", String(so.id), client))!.status).toBe("cancelled");
    expect((await getRecord(S, "ar.order", String(so.arOrderId), client))!.status).toBe("cancelled");
    // limit 2 za hodinu
    const s2 = (await getRecord(S, "shop.shop", String(shop.id), client))!;
    await saveRecord(S, "shop.shop", String(shop.id), { ...s2, orderHourLimit: 2 }, undefined, client);
    shop = (await getRecord(S, "shop.shop", String(shop.id), client))!;
    expect((await api((a) => placeOrder(a, shop, input, "ip2", "c".repeat(32)))).ok).toBe(true);
    expect((await api((a) => placeOrder(a, shop, input, "ip2", "d".repeat(32)))).errors).toEqual({ _: "@SHOP:ErrLimit" });
  }, 120_000);
});
