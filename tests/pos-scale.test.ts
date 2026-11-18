/**
 * Pokladna s ověřenou vahou (Dialog 06): cena vážené položky přesně z váhy (nepřepočítává se), kontrola ceny za kg
 * proti ceníku, bez údajů z váhy vážené zboží neprodat, údaje k doložení na řádku účtenky. Odběratel bez evidence.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { receiptPrint, sell, sellOnInvoice } from "@/modules/pos/sale";
import { receiptData } from "@/lib/receipt-data";
import type { DataApi } from "@/core/module";

const client = createPrisma();
const run = Date.now().toString(36);
const VERIFIED = { name: "Váha 1", serial: "TEM-0001", protocol: "dialog06" };
const READ = { weight: "0.384", unitPrice: "319.00", total: "122.50", raw: "02 30 32 1b 33", weighedAt: "2026-11-18T18:00:00.000Z" };

describe("pokladna s ověřenou vahou", () => {
  let P: Ctx;
  let regId: string;
  const ids: Record<string, string> = {};
  const api = <T>(fn: (a: DataApi) => Promise<T>) => inTenant(P, (s) => fn(s.sys().api()), client);

  beforeAll(async () => {
    P = (await provisionTenant(client, { code: `t-posv-${run}`, name: "Posv", adminEmail: `posv-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "ar", "int"], company: { code: "PV", name: "Řeznictví s.r.o.", regNo: "12345679", vatId: "CZ12345679" } })).ctx;
    regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    const g = (await listRecords(P, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const kg = (await listRecords(P, "inv.unit", { filter: { code: "KG" } }, client)).rows[0];
    const ks = (await listRecords(P, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    ids.ham = String((await saveRecord(P, "inv.item", null, { itemNum: "S1", name: "Pražská šunka", groupId: g.id, unitId: kg.id, salesPrice: "319", priceInclTax: true, weighed: true }, undefined, client)).id);
    ids.water = String((await saveRecord(P, "inv.item", null, { itemNum: "V1", name: "Voda", groupId: g.id, unitId: ks.id, salesPrice: "20", priceInclTax: true }, undefined, client)).id);
    await saveRecord(P, "pos.shift", null, { registerId: regId, openingCash: "0" }, undefined, client);
  }, 120_000);

  it("cena vážené položky přesně z váhy, údaje z váhy na řádku účtenky", async () => {
    const r = await api((a) => sell(a, { registerId: regId, payment: "card", verifiedScale: VERIFIED, lines: [{ itemId: ids.ham, qty: "0.384", scale: READ }, { itemId: ids.water, qty: "2" }] }));
    // 122,50 z váhy + 2 × 20 kusového zboží
    expect(r.amountGross).toBe("162.50");
    const [line] = (await listRecords(P, "pos.receiptLine", { filter: { itemId: ids.ham } }, client)).rows;
    expect([line.qty, line.unitPrice, line.amountGross, line.scaleWeight, line.scaleUnitPrice, line.scaleTotal, line.scaleName, line.scaleSerial, line.scaleProtocol, line.scaleRaw]).toEqual([
      "0.3840",
      "319.00",
      "122.50",
      "0.3840",
      "319.00",
      "122.50",
      "Váha 1",
      "TEM-0001",
      "DIALOG06",
      "02 30 32 1b 33",
    ]);
    expect(line.weighedAt).toBeTruthy();
  }, 120_000);

  it("cena za kg z váhy jiná než ceník = odmítnuto", async () => {
    await expect(api((a) => sell(a, { registerId: regId, payment: "card", verifiedScale: VERIFIED, lines: [{ itemId: ids.ham, qty: "0.384", scale: { ...READ, unitPrice: "299.00" } }] }))).rejects.toMatchObject({
      label: "@POS:ScalePriceMismatch",
    });
  }, 120_000);

  it("na pokladně s ověřenou vahou nejde vážené zboží bez váhy; kusové jde", async () => {
    await expect(api((a) => sell(a, { registerId: regId, payment: "card", verifiedScale: VERIFIED, lines: [{ itemId: ids.ham, qty: "0.5" }] }))).rejects.toMatchObject({ label: "@POS:WeighOnScale" });
    const r = await api((a) => sell(a, { registerId: regId, payment: "card", verifiedScale: VERIFIED, lines: [{ itemId: ids.water, qty: "1" }] }));
    expect(r.amountGross).toBe("20.00");
    // údaje z váhy u kusového zboží = odmítnuto
    await expect(api((a) => sell(a, { registerId: regId, payment: "card", lines: [{ itemId: ids.water, qty: "1", scale: READ }] }))).rejects.toMatchObject({ label: "@POS:ScaleNotWeighed" });
    // nečíselné údaje z váhy
    await expect(api((a) => sell(a, { registerId: regId, payment: "card", verifiedScale: VERIFIED, lines: [{ itemId: ids.ham, qty: "1", scale: { ...READ, total: "12x" } }] }))).rejects.toMatchObject({ label: "@POS:ScaleBadValue" });
  }, 120_000);

  it("vážené zboží z ověřené váhy zatím ne na fakturu", async () => {
    await expect(api((a) => sellOnInvoice(a, { registerId: regId, payment: "invoice", customerId: "x", verifiedScale: VERIFIED, lines: [{ itemId: ids.ham, qty: "0.384", scale: READ }] }))).rejects.toBeTruthy();
  }, 120_000);

  it("odběratel bez evidence: jméno a adresa na zjednodušeném dokladu", async () => {
    const r = await api((a) => sell(a, { registerId: regId, payment: "cash", buyer: { name: "Jan Novák", street: "Dlouhá 12", zip: "110 00", city: "Praha 1" }, lines: [{ itemId: ids.water, qty: "1" }] }));
    expect([r.buyerName, r.customerId ?? null]).toEqual(["Jan Novák", null]);
    const d = receiptData(await api((a) => receiptPrint(a, P.companyId, String(r.id))));
    expect([d.doc.title, d.customer.name, d.customer.address, d.customer.ids]).toEqual(["Zjednodušený daňový doklad", "Jan Novák", "Dlouhá 12, 110 00 Praha 1", ""]);
  }, 120_000);
});
