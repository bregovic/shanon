/**
 * Simulátor platební brány v testovacím prostředí: bez Comgate vznikne TEST-GATEWAY, e-shop přesměruje
 * na testovací stránku, volba Zaplatit → objednávka K vyřízení, Zrušit → čeká dál; pokladna QR + stav.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { enableTestEnv } from "@/modules/int/test-env";
import { paymentStart, paymentStatus } from "@/modules/int/drivers";
import { gatewayConnection } from "@/modules/shop/catalog";
import { shopOrder } from "@/server/eshop";
import { simDecide, simPayment } from "@/server/gateway-sim";
import type { DataApi } from "@/core/module";

const client = createPrisma();
const run = Date.now().toString(36);

describe("simulátor platební brány", () => {
  let C: Ctx;
  const slug = `sim-${run}`;
  const api = <T>(fn: (a: DataApi) => Promise<T>) => inTenant(C, (s) => fn(s.sys().api()), client);

  beforeAll(async () => {
    C = (await provisionTenant(client, { code: `t-sim-${run}`, name: "Sim", adminEmail: `sim-${run}@test.local`, adminPassword: "heslo-12345", modules: ["shop", "int", "pos"], company: { code: "S", name: "Simulace s.r.o." } })).ctx;
    const ents = (await listRecords(C, "org.entity", {}, client)).rows;
    const ent = { legalName: "Simulace s.r.o.", legalForm: "legal", country: "CZ", email: "sim@example.test", publicSlug: slug };
    if (ents[0]) await saveRecord(C, "org.entity", String(ents[0].id), { ...ents[0], ...ent }, undefined, client);
    else await saveRecord(C, "org.entity", null, ent, undefined, client);
    const shop = (await listRecords(C, "shop.shop", {}, client)).rows[0];
    await saveRecord(C, "shop.shop", String(shop.id), { ...shop, active: true }, undefined, client);
  }, 120_000);

  it("testovací prostředí bez Comgate: TEST-GATEWAY pro e-shop", async () => {
    await api((a) => enableTestEnv(a, (x) => x, false));
    const g = (await api((a) => gatewayConnection(a)))!;
    expect([g.code, g.driver]).toEqual(["TEST-GATEWAY", "gatewaySim"]);
  });

  it("e-shop: platba kartou → testovací stránka → Zaplatit → K vyřízení", async () => {
    const g = (await listRecords(C, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const ks = (await listRecords(C, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const item = await saveRecord(C, "inv.item", null, { itemNum: "S1", name: "Salám", groupId: g.id, unitId: ks.id, salesPrice: "150", priceInclTax: true, eshop: true }, undefined, client);
    const [odber] = (await listRecords(C, "shop.delivery", { filter: { code: "ODBER" } }, client)).rows;
    const [karta] = (await listRecords(C, "bank.paymentMethod", { filter: { code: "WEB-KARTA" } }, client)).rows;
    const order = (lines: number) => shopOrder(slug, { lines: [{ itemId: String(item.id), qty: lines }], deliveryId: String(odber.id), paymentMethodId: String(karta.id), pickupDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), terms: true, buyer: { name: "Eva Testová", email: "eva@example.test" } }, `ip-${lines}`, "http://localhost:3100", client);

    const r = (await order(2))!;
    const m = /\/pay-sim\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(String(r.url));
    expect(m?.[1]).toBe(C.tenantId);
    const p = (await simPayment(C.tenantId, m![2], client))!;
    expect([p.amount, p.state, p.reference, p.returnUrl]).toEqual(["300.00", "pending", r.orderNum, `http://localhost:3100/${slug}/objednavka/${r.token}`]);
    const d = await simDecide(C.tenantId, m![2], true, client);
    expect(d.returnUrl).toBe(p.returnUrl);
    const [so] = (await listRecords(C, "shop.order", { filter: { orderNum: String(r.orderNum) } }, client)).rows;
    expect(so.status).toBe("paid");
    // druhá volba už nic nezmění
    await simDecide(C.tenantId, m![2], false, client);
    expect((await getRecord(C, "shop.order", String(so.id), client))!.status).toBe("paid");

    // Zrušit → objednávka čeká na platbu
    const r2 = (await order(1))!;
    const m2 = /\/pay-sim\/[0-9a-f-]{36}\/([0-9a-f-]{36})$/.exec(String(r2.url))!;
    await simDecide(C.tenantId, m2[1], false, client);
    const [so2] = (await listRecords(C, "shop.order", { filter: { orderNum: String(r2.orderNum) } }, client)).rows;
    expect(so2.status).toBe("awaitingPayment");
    expect((await simPayment(C.tenantId, m2[1], client))!.state).toBe("CANCELLED");
  }, 120_000);

  it("pokladna: QR na testovací stránku, zaplaceno po volbě v telefonu", async () => {
    const g = (await api((a) => gatewayConnection(a)))!;
    const st = await api((a) => paymentStart(a, g, BigInt(9900), "P1", { origin: "http://localhost:3100", tenantId: C.tenantId }));
    expect([st.state, st.qr?.startsWith("<svg")]).toEqual(["pending", true]);
    expect((await api((a) => paymentStatus(a, g, st.ref))).state).toBe("pending");
    await simDecide(C.tenantId, st.ref, true, client);
    expect((await api((a) => paymentStatus(a, g, st.ref))).state).toBe("successful");
    // neplatný odkaz / cizí napojení
    expect(await simPayment(C.tenantId, "00000000-0000-0000-0000-000000000000", client)).toBe(null);
  });
});
