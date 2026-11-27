/**
 * Oprava vystavené účtenky: změna způsobu platby do uzávěrky (nové zaokrouhlení), storno (opravná účtenka,
 * sklad zpět), smazání jen poslední účtenky (číslo dostane další prodej), odběratel po uzávěrce (KH A.4 ↔ A.5).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { sell } from "@/modules/pos/sale";
import type { DataApi } from "@/core/module";

const client = createPrisma();
const run = Date.now().toString(36);

describe("oprava účtenky", () => {
  let P: Ctx;
  let regId: string;
  const ids: Record<string, string> = {};
  const api = <T>(fn: (a: DataApi) => Promise<T>) => inTenant(P, (s) => fn(s.sys().api()), client);
  const onhand = async (itemId: string) => Number((await listRecords(P, "whs.onhand", { filter: { itemId } }, client)).rows[0]?.qty ?? 0);
  const del = (id: string) => inTenant(P, (s) => s.remove("pos.receipt", id), client);

  beforeAll(async () => {
    P = (await provisionTenant(client, { code: `t-posf-${run}`, name: "Posf", adminEmail: `posf-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "ar", "whs"], company: { code: "PF", name: "Oprava s.r.o.", regNo: "12345678", vatId: "CZ12345678" } })).ctx;
    regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    const g = (await listRecords(P, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const ks = (await listRecords(P, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    ids.small = String((await saveRecord(P, "inv.item", null, { itemNum: "R1", name: "Rohlík box", groupId: g.id, unitId: ks.id, salesPrice: "99.60", priceInclTax: true }, undefined, client)).id);
    ids.item = String((await saveRecord(P, "inv.item", null, { itemNum: "K1", name: "Koš", groupId: g.id, unitId: ks.id, salesPrice: "1210", priceInclTax: true }, undefined, client)).id);
    const subj = await saveRecord(P, "gab.subject", null, { name: "Odběratel s DIČ s.r.o.", regNo: "87654321", vatId: "CZ87654321" }, undefined, client);
    const grp = (await listRecords(P, "ar.group", {}, client)).rows[0];
    ids.cust = String((await saveRecord(P, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client)).id);
    await saveRecord(P, "pos.shift", null, { registerId: regId, openingCash: "0" }, undefined, client);
  }, 120_000);

  it("způsob platby do uzávěrky: hotovost se zaokrouhlí, karta ne", async () => {
    const r = await api((a) => sell(a, { registerId: regId, payment: "cash", lines: [{ itemId: ids.small, qty: "1" }] }));
    expect([r.amountPaid, r.rounding]).toEqual(["100.00", "0.40"]);
    const c = await saveRecord(P, "pos.receipt", String(r.id), { paymentMethod: "card" }, undefined, client);
    expect([c.paymentMethod, c.amountPaid, c.rounding]).toEqual(["card", "99.60", "0.00"]);
    const b = await saveRecord(P, "pos.receipt", String(r.id), { paymentMethod: "cash" }, undefined, client);
    expect([b.amountPaid, b.rounding]).toEqual(["100.00", "0.40"]);
    // částky uživatel nepřepíše (jen pro čtení)
    const x = await saveRecord(P, "pos.receipt", String(r.id), { amountPaid: "1.00" }, undefined, client);
    expect(x.amountPaid).toBe("100.00");
    ids.first = String(r.id);
  }, 120_000);

  it("storno: opravná účtenka se zápornými částkami, zboží zpět na sklad", async () => {
    const r = await api((a) => sell(a, { registerId: regId, payment: "cash", lines: [{ itemId: ids.item, qty: "2" }] }));
    expect(await onhand(ids.item)).toBe(-2);
    const out = await runAction(P, "pos.receipt", String(r.id), "storno", client);
    const stId = (out as { open?: { id: string } }).open!.id;
    const st = (await getRecord(P, "pos.receipt", stId, client))!;
    expect([st.amountGross, st.amountPaid, st.stornoOfId, st.paymentMethod]).toEqual(["-2420.00", "-2420.00", r.id, "cash"]);
    const lines = (await listRecords(P, "pos.receiptLine", { filter: { receiptId: stId } }, client)).rows;
    expect(lines.map((l) => [l.qty, l.amountGross])).toEqual([["-2.0000", "-2420.00"]]);
    expect(await onhand(ids.item)).toBe(0);
    expect((await getRecord(P, "pos.receipt", String(r.id), client))!.stornoId).toBe(stId);
    await expect(runAction(P, "pos.receipt", String(r.id), "storno", client)).rejects.toMatchObject({ label: "@POS:ReceiptIsStorno" });
    await expect(saveRecord(P, "pos.receipt", String(r.id), { paymentMethod: "card" }, undefined, client)).rejects.toMatchObject({ label: "@POS:ReceiptIsStorno" });
  }, 120_000);

  it("smazat jde jen poslední účtenku; číslo dostane další prodej", async () => {
    const r = await api((a) => sell(a, { registerId: regId, payment: "cash", lines: [{ itemId: ids.item, qty: "1" }] }));
    expect(await onhand(ids.item)).toBe(-1);
    await expect(del(ids.first)).rejects.toMatchObject({ label: "@POS:ReceiptDeleteRule" });
    await del(String(r.id));
    expect(await getRecord(P, "pos.receipt", String(r.id), client)).toBeNull();
    expect(await onhand(ids.item)).toBe(0);
    const next = await api((a) => sell(a, { registerId: regId, payment: "cash", lines: [{ itemId: ids.item, qty: "1" }] }));
    expect(next.receiptNum).toBe(r.receiptNum);
  }, 120_000);

  it("odběratel po uzávěrce: účtenka přejde do KH jednotlivě (A.4) a zpět do souhrnu", async () => {
    const r = await api((a) => sell(a, { registerId: regId, payment: "cash", lines: [{ itemId: ids.item, qty: "10" }] }));
    const [shift] = (await listRecords(P, "pos.shift", { filter: { status: "open" } }, client)).rows;
    await runAction(P, "pos.shift", String(shift.id), "close", client);
    const tax = async () => {
      const rows = (await listRecords(P, "tax.trans", { filter: { sourceId: { in: [String(shift.id), String(r.id)] } } }, client)).rows;
      return {
        own: rows.filter((t) => t.sourceObject === "pos.receipt").map((t) => [t.khSection, t.vatId, t.base, t.tax]),
        agg: rows.filter((t) => t.sourceObject === "pos.shift").reduce((s, t) => s + Number(t.base), 0),
      };
    };
    const before = await tax();
    expect(before.own).toEqual([]);
    await saveRecord(P, "pos.receipt", String(r.id), { customerId: ids.cust }, undefined, client);
    const mid = await tax();
    expect(mid.own).toEqual([["A4", "CZ87654321", "10000.00", "2100.00"]]);
    expect(Math.round((before.agg - mid.agg) * 100) / 100).toBe(10000);
    // po uzávěrce už jen odběratel
    await expect(saveRecord(P, "pos.receipt", String(r.id), { paymentMethod: "card" }, undefined, client)).rejects.toMatchObject({ label: "@POS:ReceiptShiftClosed" });
    await expect(del(String(r.id))).rejects.toMatchObject({ label: "@POS:ReceiptDeleteRule" });
    await saveRecord(P, "pos.receipt", String(r.id), { customerId: null }, undefined, client);
    const after = await tax();
    expect(after.own).toEqual([]);
    expect(Math.round(after.agg * 100) / 100).toBe(Math.round(before.agg * 100) / 100);
  }, 120_000);
});
