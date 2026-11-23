/**
 * Kasa bez připojení: prodej uložený v prohlížeči se dodatečně zapíše jako účtenka (ceny z kasy, číslo z offline
 * řady, čas prodeje), opakované odeslání nic nezdvojí; i běžný prodej s id z kasy je při opakování tentýž.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { sell } from "@/modules/pos/sale";
import { syncOfflineSales } from "@/server/pos-offline";

const client = createPrisma();
const run = Date.now().toString(36);

describe("kasa bez připojení", () => {
  let P: Ctx;
  let regId: string;
  let shiftId: string;
  let item: string;

  beforeAll(async () => {
    P = (await provisionTenant(client, { code: `t-offline-${run}`, name: "Offline", adminEmail: `offline-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos"], company: { code: "OF", name: "Offline s.r.o.", regNo: "12345678", vatId: "CZ12345678" } })).ctx;
    regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    const g = (await listRecords(P, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const ks = (await listRecords(P, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    item = String((await saveRecord(P, "inv.item", null, { itemNum: "O1", name: "Chléb", groupId: g.id, unitId: ks.id, salesPrice: "40", priceInclTax: true }, undefined, client)).id);
    shiftId = String((await saveRecord(P, "pos.shift", null, { registerId: regId, openingCash: "0" }, undefined, client)).id);
  }, 120_000);

  it("běžný prodej s id z kasy: opakované odeslání vrátí stejnou účtenku", async () => {
    const clientId = randomUUID();
    const input = { registerId: regId, payment: "cash" as const, cashGiven: "50", lines: [{ itemId: item, qty: "1" }], clientId };
    const a = await inTenant(P, (s) => sell(s.sys().api(), input), client);
    const b = await inTenant(P, (s) => sell(s.sys().api(), input), client);
    expect(b.id).toBe(a.id);
    expect((await listRecords(P, "pos.receipt", { filter: { clientId } }, client)).rows).toHaveLength(1);
  });

  it("offline prodej: ceny z kasy, číslo z offline řady, datum prodeje; podruhé se nezapíše", async () => {
    // mezitím zdražení — zákazník zaplatil původní cenu
    await saveRecord(P, "inv.item", item, { salesPrice: "45" }, undefined, client);
    const soldAt = new Date(Date.now() - 26 * 3600_000).toISOString();
    const sale = { clientId: randomUUID(), registerId: regId, shiftId, receiptNum: "OF-AB2CD-00001", soldAt, payment: "cash", cashGiven: "100", lines: [{ itemId: item, qty: "2", unitPrice: "40" }] };
    const bad = { ...sale, clientId: randomUUID(), receiptNum: "X1" };
    const r1 = await syncOfflineSales(P, { sales: [sale, bad] });
    expect(r1.results[0]).toMatchObject({ ok: true, receiptNum: "OF-AB2CD-00001" });
    expect(r1.results[1].ok).toBe(false);
    const rec = (await listRecords(P, "pos.receipt", { filter: { clientId: sale.clientId } }, client)).rows[0];
    expect([rec.offline, Number(rec.amountGross), Number(rec.amountPaid), Number(rec.change), rec.shiftId]).toEqual([true, 80, 80, 20, shiftId]);
    expect(rec.date).toBe(new Date(soldAt).toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" }));
    const lines = (await listRecords(P, "pos.receiptLine", { filter: { receiptId: rec.id } }, client)).rows;
    expect([Number(lines[0].unitPrice), Number(lines[0].qty), Number(lines[0].amountGross)]).toEqual([40, 2, 80]);

    // ztracená odpověď → kasa pošle znovu: žádný druhý prodej
    const r2 = await syncOfflineSales(P, { sales: [sale] });
    expect(r2.results[0]).toMatchObject({ ok: true, receiptNum: "OF-AB2CD-00001" });
    expect((await listRecords(P, "pos.receipt", { filter: { clientId: sale.clientId } }, client)).rows).toHaveLength(1);
  });

  it("uzavřená / neznámá směna → otevřená směna pokladny; stejné číslo z jiné kasy dostane příponu", async () => {
    const sale = { clientId: randomUUID(), registerId: regId, shiftId: randomUUID(), receiptNum: "OF-AB2CD-00001", soldAt: new Date().toISOString(), payment: "card", lines: [{ itemId: item, qty: "1", unitPrice: "45" }] };
    const r = await syncOfflineSales(P, { sales: [sale] });
    expect(r.results[0]).toMatchObject({ ok: true, receiptNum: "OF-AB2CD-00001-2" });
    const rec = (await listRecords(P, "pos.receipt", { filter: { clientId: sale.clientId } }, client)).rows[0];
    expect([rec.shiftId, rec.paymentMethod, Number(rec.amountPaid), rec.cashGiven]).toEqual([shiftId, "card", 45, null]);
  });
});
