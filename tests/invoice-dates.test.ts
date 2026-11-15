/**
 * Faktura: DUZP a splatnost následují datum vystavení (i u uložené faktury), dokud je uživatel nezmění ručně;
 * splatnost podle dnů partnera, jinak skupiny, jinak 14. Výchozí nastavení: dimenze Partner z adresáře, skupina Služby.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);
const d = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

describe("data faktury", () => {
  it("DUZP a splatnost podle data vystavení, ruční hodnota zůstane", async () => {
    const T = (await provisionTenant(client, { code: `t-dt-${run}`, name: "Dt", adminEmail: `dt-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "inv"], company: { code: "D", name: "D" } })).ctx;
    const grp = (await listRecords(T, "ar.group", {}, client)).rows[0];
    const s1 = await saveRecord(T, "gab.subject", null, { name: "Bez splatnosti" }, undefined, client);
    const c1 = await saveRecord(T, "ar.customer", null, { subjectId: s1.id, groupId: grp.id }, undefined, client);
    const s2 = await saveRecord(T, "gab.subject", null, { name: "Splatnost 30" }, undefined, client);
    const c2 = await saveRecord(T, "ar.customer", null, { subjectId: s2.id, groupId: grp.id, paymentDays: 30 }, undefined, client);
    const days = Number(grp.paymentDays ?? 14);
    const plus = (x: string, n: number) => new Date(Date.parse(`${x}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

    // uložená faktura (po výběru odběratele), pak změna data vystavení → DUZP i splatnost se posunou
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: c1.id, invoiceDate: "2026-11-01" }, undefined, client);
    let r = (await getRecord(T, "ar.invoice", String(inv.id), client))!;
    expect([d(r.taxDate), d(r.dueDate)]).toEqual(["2026-11-01", plus("2026-11-01", days)]);
    await saveRecord(T, "ar.invoice", String(inv.id), { ...r, invoiceDate: "2026-11-10" }, undefined, client);
    r = (await getRecord(T, "ar.invoice", String(inv.id), client))!;
    expect([d(r.taxDate), d(r.dueDate)]).toEqual(["2026-11-10", plus("2026-11-10", days)]);
    // ručně změněné DUZP a splatnost zůstanou
    await saveRecord(T, "ar.invoice", String(inv.id), { ...r, taxDate: "2026-11-05", dueDate: "2026-12-31" }, undefined, client);
    r = (await getRecord(T, "ar.invoice", String(inv.id), client))!;
    await saveRecord(T, "ar.invoice", String(inv.id), { ...r, invoiceDate: "2026-11-12" }, undefined, client);
    r = (await getRecord(T, "ar.invoice", String(inv.id), client))!;
    expect([d(r.taxDate), d(r.dueDate)]).toEqual(["2026-11-05", "2026-12-31"]);

    // vydaná faktura: číslo jde změnit, VS z čísla se posune
    r = (await getRecord(T, "ar.invoice", String(inv.id), client))!;
    expect(r.vs).toBe(String(r.invoiceNum).replace(/\D/g, ""));
    await saveRecord(T, "ar.invoice", String(inv.id), { ...r, invoiceNum: "FV2026-0777" }, undefined, client);
    r = (await getRecord(T, "ar.invoice", String(inv.id), client))!;
    expect([r.invoiceNum, r.vs]).toEqual(["FV2026-0777", "20260777"]);

    // splatnost z odběratele
    const inv2 = await saveRecord(T, "ar.invoice", null, { customerId: c2.id, invoiceDate: "2026-11-01" }, undefined, client);
    r = (await getRecord(T, "ar.invoice", String(inv2.id), client))!;
    await saveRecord(T, "ar.invoice", String(inv2.id), { ...r, invoiceDate: "2026-11-15" }, undefined, client);
    r = (await getRecord(T, "ar.invoice", String(inv2.id), client))!;
    expect([d(r.taxDate), d(r.dueDate)]).toEqual(["2026-11-15", "2026-12-15"]);

    // výchozí nastavení firmy: skupina položek Služby, dimenze Partner z adresáře
    const sl = (await listRecords(T, "inv.itemGroup", { filter: { code: "SLUZBY" } }, client)).rows[0];
    expect(sl?.name).toBe("Služby");
    const par = (await listRecords(T, "gl.dimension", { filter: { code: "PAR" } }, client)).rows[0];
    expect(par.source).toBe("subject");
    const vals = (await listRecords(T, "gl.dimensionValue", { filter: { dimensionId: String(par.id) } }, client)).rows.map((v) => [v.code, v.name]);
    expect(vals).toEqual(expect.arrayContaining([["P00001", "Bez splatnosti"], ["P00002", "Splatnost 30"]]));
    expect((await getRecord(T, "ar.customer", String(c2.id), client))!.dim3).toBe("P00002");
  }, 120_000);

  it("skupina DPH na hlavičce faktury přepne řádky (kód z kombinace skupina × položka DPH)", async () => {
    const T = (await provisionTenant(client, { code: `t-tgh-${run}`, name: "Tgh", adminEmail: `tgh-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "inv"], company: { code: "D", name: "D" } })).ctx;
    const id = async (obj: string, code: string) => String((await listRecords(T, obj, { filter: { code } }, client)).rows[0].id);
    const grp = (await listRecords(T, "ap.group", {}, client)).rows[0];
    const s = await saveRecord(T, "gab.subject", null, { name: "Dodavatel" }, undefined, client);
    const v = await saveRecord(T, "ap.vendor", null, { subjectId: s.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(T, "ap.invoice", null, { vendorId: v.id, externalNum: "F1", invoiceDate: "2026-11-10" }, undefined, client);
    expect(inv.taxGroupId).toBe(await id("tax.taxGroup", "TUZ"));
    const line = await saveRecord(T, "ap.invoiceLine", null, { invoiceId: inv.id, description: "Služba", qty: "1", unitPrice: "1000", itemTaxGroupId: await id("tax.itemTaxGroup", "S21") }, undefined, client);
    expect(line.taxCodeId).toBe(await id("tax.taxCode", "P21"));
    // dodavatel je ve skutečnosti z EU: změna skupiny na hlavičce → samovyměření na řádku
    const h = (await getRecord(T, "ap.invoice", String(inv.id), client))!;
    await saveRecord(T, "ap.invoice", String(inv.id), { ...h, taxGroupId: await id("tax.taxGroup", "EU") }, undefined, client);
    const l2 = (await getRecord(T, "ap.invoiceLine", String(line.id), client))!;
    expect([l2.taxGroupId, l2.taxCodeId, l2.taxAmount]).toEqual([await id("tax.taxGroup", "EU"), await id("tax.taxCode", "PEUS21"), "0.00"]);
  }, 120_000);
});
