/**
 * Platební brána Comgate (síť podvržená): napojení s adresou oznámení, pokladna (QR v telefonu),
 * e-shop (platba kartou → platební stránka → oznámení ověřené u brány → K vyřízení), testovací prostředí.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { paymentStart, paymentStatus } from "@/modules/int/drivers";
import { enableTestEnv } from "@/modules/int/test-env";
import { gatewayConnection, quote } from "@/modules/shop/catalog";
import { shopOrder } from "@/server/eshop";
import { comgatePush } from "@/server/payment-push";
import type { DataApi, RecordData } from "@/core/module";

const client = createPrisma();
const run = Date.now().toString(36);

// podvržená brána: stav platby podle transId, záznam volání
const calls: { method: string; url: string; auth: string | null; body: Record<string, unknown> | null }[] = [];
const states = new Map<string, { status: string; price: string }>();
let seq = 0;
const realFetch = globalThis.fetch;

describe("Comgate", () => {
  let C: Ctx;
  let conn: RecordData;
  const api = <T>(fn: (a: DataApi) => Promise<T>) => inTenant(C, (s) => fn(s.sys().api()), client);
  const slug = `cg-${run}`;

  beforeAll(async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith("https://payments.comgate.cz/")) return realFetch(url, init);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: String(init?.method ?? "GET"), url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
      if (String(url).endsWith("/payment.json")) {
        const transId = `TEST-${++seq}-${run}`.slice(0, 30);
        states.set(transId, { status: "PENDING", price: String(body.price) });
        return json({ code: 0, message: "OK", transId, redirect: `https://payments.comgate.cz/client/instructions/index?id=${transId}` });
      }
      const m = /\/payment\/transId\/([^/.]+)\.json$/.exec(String(url));
      if (m) {
        const st = states.get(decodeURIComponent(m[1]));
        return st ? json({ code: 0, message: "OK", status: st.status, price: st.price }) : json({ code: 1400, message: "not found" });
      }
      if (String(url).includes("/method.json")) return json({ code: 0, message: "OK", methods: [{ id: "CARD_CZ_COMGATE" }, { id: "GOOGLEPAY_REDIRECT" }] });
      return json({ code: 1400, message: "?" });
    });
    C = (await provisionTenant(client, { code: `t-cg-${run}`, name: "Cg", adminEmail: `cg-${run}@test.local`, adminPassword: "heslo-12345", modules: ["shop", "int", "pos"], company: { code: "G", name: "Gateway s.r.o." } })).ctx;
    const ents = (await listRecords(C, "org.entity", {}, client)).rows;
    const ent = { legalName: "Gateway s.r.o.", legalForm: "legal", country: "CZ", email: "shop@example.test", publicSlug: slug };
    if (ents[0]) await saveRecord(C, "org.entity", String(ents[0].id), { ...ents[0], ...ent }, undefined, client);
    else await saveRecord(C, "org.entity", null, ent, undefined, client);
    conn = await saveRecord(C, "int.connection", null, { code: "COMGATE", name: "Comgate", kind: "payment", driver: "comgate", merchantCode: "123456", apiKey: "tajne-heslo", posQr: true }, undefined, client);
  }, 120_000);
  afterAll(() => vi.unstubAllGlobals());

  it("napojení: adresa oznámení, heslo jen šifrovaně", async () => {
    const c = (await getRecord(C, "int.connection", String(conn.id), client))!;
    expect(c.pushUrl).toBe(`/api/pay/comgate/${C.tenantId}/${conn.id}`);
    expect(c.apiKey).not.toBe("tajne-heslo");
    conn = (await api((a) => a.get("int.connection", String(conn.id))))!;
  });

  it("pokladna: platba QR kódem v telefonu, zaplaceno až podle brány", async () => {
    const st = await api((a) => paymentStart(a, conn, BigInt(12345), "P1"));
    expect([st.state, st.qr?.startsWith("<svg")]).toEqual(["pending", true]);
    const create = calls.at(-1)!;
    expect(create.auth).toBe(`Basic ${Buffer.from("123456:tajne-heslo").toString("base64")}`);
    expect([create.body?.price, create.body?.curr, create.body?.test, create.body?.email]).toEqual([12345, "CZK", false, "shop@example.test"]);
    const log = (await api((a) => a.get("int.log", st.ref)))!;
    expect((await api((a) => paymentStatus(a, conn, st.ref))).state).toBe("pending");
    states.set(String(log.externalId), { status: "PAID", price: "12345" });
    expect((await api((a) => paymentStatus(a, conn, st.ref))).state).toBe("successful");
  });

  it("e-shop: platba kartou → platební stránka → oznámení ověřené u brány → K vyřízení", async () => {
    const shop = (await listRecords(C, "shop.shop", {}, client)).rows[0];
    await saveRecord(C, "shop.shop", String(shop.id), { ...shop, active: true }, undefined, client);
    const g = (await listRecords(C, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const ks = (await listRecords(C, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const item = await saveRecord(C, "inv.item", null, { itemNum: "K1", name: "Klobása", groupId: g.id, unitId: ks.id, salesPrice: "100", priceInclTax: true, eshop: true }, undefined, client);
    const [odber] = (await listRecords(C, "shop.delivery", { filter: { code: "ODBER" } }, client)).rows;
    const [karta] = (await listRecords(C, "bank.paymentMethod", { filter: { code: "WEB-KARTA" } }, client)).rows;
    const s2 = (await listRecords(C, "shop.shop", {}, client)).rows[0];
    const q = await api((a) => quote(a, s2, { lines: [{ itemId: String(item.id), qty: 2 }], deliveryId: String(odber.id) }));
    expect(q.payments.map((p) => p.kind)).toContain("card");

    const res = (await shopOrder(slug, { lines: [{ itemId: String(item.id), qty: 2 }], deliveryId: String(odber.id), paymentMethodId: String(karta.id), terms: true, buyer: { name: "Petr Kupec", email: "petr@example.test" } }, "1.2.3.4", "https://shop.example", client))!;
    expect(res.ok).toBe(true);
    expect(res.url).toMatch(/^https:\/\/payments\.comgate\.cz\//);
    const create = calls.at(-1)!;
    expect([create.body?.price, create.body?.refId, create.body?.url_paid]).toEqual([20000, res.orderNum, `https://shop.example/${slug}/objednavka/${res.token}`]);
    const [so] = (await listRecords(C, "shop.order", { filter: { orderNum: String(res.orderNum) } }, client)).rows;
    expect([so.status, !!so.paymentLogId, so.advanceId ?? null]).toEqual(["awaitingPayment", true, null]);
    const log = (await api((a) => a.get("int.log", String(so.paymentLogId))))!;

    // oznámení s neplatnou platbou nic nezmění; s čekající platbou taky ne
    expect(await comgatePush(C.tenantId, String(conn.id), "NEZNAMA-1", client)).toBe("unknown");
    await comgatePush(C.tenantId, String(conn.id), String(log.externalId), client);
    expect((await getRecord(C, "shop.order", String(so.id), client))!.status).toBe("awaitingPayment");
    // brána potvrdí zaplacení → K vyřízení
    states.set(String(log.externalId), { status: "PAID", price: "20000" });
    expect(await comgatePush(C.tenantId, String(conn.id), String(log.externalId), client)).toBe("ok");
    expect((await getRecord(C, "shop.order", String(so.id), client))!.status).toBe("paid");
    expect((await api((a) => a.get("int.log", String(so.paymentLogId))))!.status).toBe("ok");
  }, 120_000);

  it("testovací prostředí: testovací kopie brány s testovacími platbami má přednost", async () => {
    await api((a) => enableTestEnv(a, (x) => x, false));
    const g = (await api((a) => gatewayConnection(a)))!;
    expect([g.code, g.testMode, g.merchantCode]).toEqual(["TEST-COMGATE", true, "123456"]);
    await api((a) => paymentStart(a, g, BigInt(100), "T1"));
    expect(calls.at(-1)!.body?.test).toBe(true);
    expect(calls.at(-1)!.auth).toBe(`Basic ${Buffer.from("123456:tajne-heslo").toString("base64")}`);
  });
});
