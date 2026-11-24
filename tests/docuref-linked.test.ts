/**
 * Přílohy navázaných záznamů: sken faktury dodavatele je vidět i na daňové transakci, účetním dokladu, řádku
 * hlavní knihy a položce salda (uložený jednou, jen ke čtení); vydaná faktura má v přílohách své PDF.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { addFile, countDocuRefs, deleteDocuRef, listDocuRefs } from "@/server/docuref";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());

describe("přílohy navázaných záznamů", () => {
  it("sken přijaté faktury na DPH, dokladu, HK a saldu; PDF vydané faktury; bez duplicit", async () => {
    const T = (await provisionTenant(client, { code: `t-dref-${run}`, name: "Dref", adminEmail: `dref-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap"], company: { code: "D", name: "D" } })).ctx;

    // přijatá faktura se skenem
    const vs = await saveRecord(T, "gab.subject", null, { name: "Dodavatel" }, undefined, client);
    const vgrp = (await listRecords(T, "ap.group", {}, client)).rows[0];
    const vendor = await saveRecord(T, "ap.vendor", null, { subjectId: vs.id, groupId: vgrp.id }, undefined, client);
    const pinv = await saveRecord(T, "ap.invoice", null, { vendorId: vendor.id, invoiceDate: "2026-11-15", externalNum: "DF-1" }, undefined, client);
    await saveRecord(T, "ap.invoiceLine", null, { invoiceId: pinv.id, description: "Materiál", qty: "1", unitPrice: "1000" }, undefined, client);
    await addFile(T, "ap.invoice", String(pinv.id), { name: "sken.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 sken") }, client);
    await runAction(T, "ap.invoice", String(pinv.id), "post", client);
    const posted = (await listRecords(T, "ap.invoice", { filter: { externalNum: "DF-1" } }, client)).rows[0];

    const tt = (await listRecords(T, "tax.trans", { filter: { voucherId: String(posted.voucherId) } }, client)).rows[0];
    const gl = (await listRecords(T, "gl.trans", { filter: { voucherId: String(posted.voucherId) } }, client)).rows[0];
    const sal = (await listRecords(T, "ap.trans", { filter: { voucherId: String(posted.voucherId) } }, client)).rows[0];
    for (const [obj, id] of [["tax.trans", tt.id], ["gl.voucher", posted.voucherId], ["gl.trans", gl.id], ["ap.trans", sal.id]] as const) {
      const items = await listDocuRefs(T, obj, String(id), client);
      const scan = items.filter((i) => i.name === "sken.pdf");
      expect(scan.length, obj).toBe(1); // jednou, i když vede víc cest
      expect(scan[0].source?.objectId, obj).toBe("ap.invoice");
    }
    // na faktuře samotné vlastní příloha bez označení zdroje
    const own = await listDocuRefs(T, "ap.invoice", String(pinv.id), client);
    expect(own.filter((i) => i.name === "sken.pdf").map((i) => i.source)).toEqual([undefined]);
    // soubor existuje jednou
    expect(await client.sysDocuRef.count({ where: { tenantId: T.tenantId, name: "sken.pdf" } })).toBe(1);
    // přílohu zdroje z navázaného záznamu smazat nejde (právo i kontrola jsou na faktuře) — smazání na faktuře zmizí všude
    await deleteDocuRef(T, own.find((i) => i.name === "sken.pdf")!.id, client);
    expect((await listDocuRefs(T, "tax.trans", String(tt.id), client)).filter((i) => i.name === "sken.pdf")).toEqual([]);

    // vydaná faktura: PDF z tiskové šablony u faktury i na její daňové transakci
    const cs = await saveRecord(T, "gab.subject", null, { name: "Odběratel" }, undefined, client);
    const cgrp = (await listRecords(T, "ar.group", {}, client)).rows[0];
    const cust = await saveRecord(T, "ar.customer", null, { subjectId: cs.id, groupId: cgrp.id }, undefined, client);
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-15" }, undefined, client);
    await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Služba", qty: "1", unitPrice: "500" }, undefined, client);
    await runAction(T, "ar.invoice", String(inv.id), "post", client);
    const issued = (await listRecords(T, "ar.invoice", { filter: { id: String(inv.id) } }, client)).rows[0] ?? (await listRecords(T, "ar.invoice", {}, client)).rows[0];
    const self = await listDocuRefs(T, "ar.invoice", String(inv.id), client);
    expect(self.find((i) => i.kind === "pdf")?.href).toBe(`/api/pdf/ar.invoice/${inv.id}`);
    const itt = (await listRecords(T, "tax.trans", { filter: { voucherId: String(issued.voucherId) } }, client)).rows[0];
    const fromTax = await listDocuRefs(T, "tax.trans", String(itt.id), client);
    expect(fromTax.filter((i) => i.kind === "pdf").map((i) => [i.href, i.source?.objectId])).toEqual([[`/api/pdf/ar.invoice/${inv.id}`, "ar.invoice"]]);
    expect(await countDocuRefs(T, "tax.trans", String(itt.id), client)).toBe(fromTax.length);
  }, 60000);
});
