/** Import vydaných faktur z ISDOC: koncept s číslem z ISDOC, odběratel podle IČO (jinak založený), řádky, příloha, duplicita. */
import { describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { listDocuRefs } from "@/server/docuref";
import { invoiceIsdoc } from "@/modules/prt/isdoc";
import { importIssuedIsdoc } from "@/server/isdoc-import";

const client = createPrisma();
const run = Date.now().toString(36);

describe("import vydané faktury z ISDOC", () => {
  it("založí koncept s číslem, odběratelem, řádky a přílohou; podruhé duplicita", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 })); // registr mimo test
    // zdrojový systém: vystavená faktura → ISDOC
    const S = (await provisionTenant(client, { code: `t-isa-${run}`, name: "Src", adminEmail: `isa-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "org", "prt"], company: { code: "S", name: "Zdroj" } })).ctx;
    const subj = await saveRecord(S, "gab.subject", null, { name: "Restaurace U Lípy", regNo: "11223344", vatId: "CZ11223344" }, undefined, client);
    const [grp] = (await listRecords(S, "ar.group", {}, client)).rows;
    const cust = await saveRecord(S, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(S, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-14", dueDate: "2026-11-28" }, undefined, client);
    await saveRecord(S, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Klobása", qty: "2", unitPrice: "100" }, undefined, client);
    await saveRecord(S, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Pečivo", qty: "1", unitPrice: "50", taxCodeId: (await listRecords(S, "tax.taxCode", { filter: { code: "V12" } }, client)).rows[0].id }, undefined, client);
    await runAction(S, "ar.invoice", String(inv.id), "post", client);
    const x = await inTenant(S, (s) => invoiceIsdoc(s.sys().api(), S.companyId, String(inv.id)), client);
    const file = { name: x.name, data: Buffer.from(x.xml) };

    // cílová firma (nový systém): odběratel ještě neexistuje
    const T = (await provisionTenant(client, { code: `t-isb-${run}`, name: "Dst", adminEmail: `isb-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "prt"], company: { code: "T", name: "Cíl" } })).ctx;
    const check = await importIssuedIsdoc(T, file, true, "cs", client);
    expect([check.errors, check.created, check.applied]).toEqual([[], 1, false]);
    expect((await listRecords(T, "ar.invoice", {}, client)).total).toBe(0);

    const r = await importIssuedIsdoc(T, file, false, "cs", client);
    expect([r.errors, r.created, r.applied]).toEqual([[], 1, true]);
    const [imp] = (await listRecords(T, "ar.invoice", {}, client)).rows;
    expect([imp.invoiceNum, imp.status, imp.amountNet, imp.taxAmount, imp.amountGross]).toEqual([inv.invoiceNum, "draft", "250.00", "48.00", "298.00"]);
    const [c] = (await listRecords(T, "ar.customer", {}, client)).rows;
    expect([c.regNo, c.id]).toEqual(["11223344", imp.customerId]);
    const lines = (await listRecords(T, "ar.invoiceLine", { filter: { invoiceId: String(imp.id) } }, client)).rows;
    expect(lines.map((l) => [l.description, l.qty, l.unitPrice])).toEqual(expect.arrayContaining([["Klobása", "2.0000", "100.00"], ["Pečivo", "1.0000", "50.00"]]));
    expect((await listDocuRefs(T, "ar.invoice", String(imp.id), client)).map((d) => d.name)).toEqual([x.name]);

    // podruhé: faktura už existuje
    const again = await importIssuedIsdoc(T, file, false, "cs", client);
    expect(again.errors.map((e) => e.message)).toEqual([`Faktura ${inv.invoiceNum} už existuje.`]);
  }, 120_000);
});
