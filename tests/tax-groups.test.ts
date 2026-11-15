/**
 * DPH přes skupiny (jako v AX): skupina DPH partnera × položka DPH → kód, ručně zadaný kód zůstane,
 * samovyměření (služba z EU, přenesená povinnost) MD i D 343 a dvě daňové transakce, DPH v deníku
 * (kód přímo i ze skupin, částky včetně DPH), řádky přiznání 5/40/43 a oddíl A.2 kontrolního hlášení.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { downloadFile, getRecord, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("DPH přes skupiny", () => {
  it("výchozí sada, faktury přes skupiny, samovyměření, deník, přiznání a KH", async () => {
    const T = (await provisionTenant(client, { code: `t-tg-${run}`, name: "TG", adminEmail: `tg-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "inv"], company: { code: "T", name: "TG s.r.o." } })).ctx;
    const C = { ...T, dims: undefined };
    const one = async (obj: string, filter: Record<string, string>) => (await listRecords(C, obj, { filter }, client)).rows[0];
    const id = async (obj: string, code: string) => String((await one(obj, { code })).id);

    // výchozí sada pro české firmy
    const codes = (await listRecords(C, "tax.taxCode", { pageSize: 100 }, client)).rows.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["V21", "P21", "VPDP", "PPDP21", "PEUZ21", "PEUS21", "V0EU", "VOSV", "PDOV21"]));
    expect((await listRecords(C, "tax.taxGroupCode", { pageSize: 100 }, client)).total).toBe(36);
    const apGroup = await one("ap.group", {});
    expect(apGroup.taxGroupId).toBe(await id("tax.taxGroup", "TUZ"));

    // dodavatel z EU: služba 21 % → PEUS21 (samovyměření), faktura bez daně
    const subj = await saveRecord(C, "gab.subject", null, { name: "Cloud GmbH", vatId: "DE123456789" }, undefined, client);
    const vendor = await saveRecord(C, "ap.vendor", null, { subjectId: subj.id, groupId: apGroup.id, taxGroupId: await id("tax.taxGroup", "EU") }, undefined, client);
    const inv = await saveRecord(C, "ap.invoice", null, { vendorId: vendor.id, externalNum: "INV-77", invoiceDate: "2026-11-10", taxDate: "2026-11-10" }, undefined, client);
    expect(inv.taxGroupId).toBe(await id("tax.taxGroup", "EU"));
    const line = await saveRecord(C, "ap.invoiceLine", null, { invoiceId: inv.id, description: "Hosting", qty: "1", unitPrice: "1000", itemTaxGroupId: await id("tax.itemTaxGroup", "S21") }, undefined, client);
    expect([line.taxCodeId, line.taxAmount]).toEqual([await id("tax.taxCode", "PEUS21"), "0.00"]);
    // ručně zadaný kód zůstane i po změně položky DPH
    const manual = await saveRecord(C, "ap.invoiceLine", null, { invoiceId: inv.id, description: "Ručně", qty: "1", unitPrice: "100", itemTaxGroupId: await id("tax.itemTaxGroup", "S21"), taxCodeId: await id("tax.taxCode", "P0") }, undefined, client);
    const manual2 = await saveRecord(C, "ap.invoiceLine", String(manual.id), { ...manual, itemTaxGroupId: await id("tax.itemTaxGroup", "Z21") }, undefined, client);
    expect(manual2.taxCodeId).toBe(await id("tax.taxCode", "P0"));
    // změna položky DPH u kódu ze skupin = nový kód
    const line2 = await saveRecord(C, "ap.invoiceLine", String(line.id), { ...line, itemTaxGroupId: await id("tax.itemTaxGroup", "Z21") }, undefined, client);
    expect(line2.taxCodeId).toBe(await id("tax.taxCode", "PEUZ21"));
    await saveRecord(C, "ap.invoiceLine", String(line.id), { ...line2, itemTaxGroupId: await id("tax.itemTaxGroup", "S21") }, undefined, client);

    await runAction(C, "ap.invoice", String(inv.id), "post", client);
    const posted = (await getRecord(C, "ap.invoice", String(inv.id), client))!;
    expect([posted.amountNet, posted.taxAmount, posted.amountGross]).toEqual(["1100.00", "0.00", "1100.00"]);
    const gl = (await listRecords(C, "gl.trans", { filter: { voucherId: String(posted.voucherId) }, pageSize: 20 }, client)).rows;
    const acc = (r: Record<string, unknown>) => String((r._titles as Record<string, string>).accountId).slice(0, 6);
    expect(gl.filter((r) => acc(r) === "343000").map((r) => r.amount).sort()).toEqual(["-210.00", "210.00"]);
    const tt = (await listRecords(C, "tax.trans", { filter: { voucherId: String(posted.voucherId) }, pageSize: 20 }, client)).rows;
    expect(tt.filter((r) => r.tax !== "0.00").map((r) => [r.direction, r.reportLine, r.khSection, r.base, r.tax]).sort()).toEqual([
      ["input", "43", "-", "1000.00", "210.00"],
      ["output", "5", "A2", "1000.00", "210.00"],
    ]);

    // vlastní kód položky (potraviny 12 %) má přednost před položkou DPH skupiny položek (Z21)
    const ig = await one("inv.itemGroup", { code: "ZBOZI" });
    expect(ig.itemTaxGroupId).toBe(await id("tax.itemTaxGroup", "Z21"));
    const food = await saveRecord(C, "inv.item", null, { itemNum: "SUN01", name: "Šunka", groupId: ig.id, unitId: (await one("inv.unit", { code: "KG" })).id, salesPrice: "100", taxCodeId: await id("tax.taxCode", "V12") }, undefined, client);
    const cs = await saveRecord(C, "gab.subject", null, { name: "Odběratel" }, undefined, client);
    const cust = await saveRecord(C, "ar.customer", null, { subjectId: cs.id, groupId: (await one("ar.group", {})).id }, undefined, client);
    const sinv = await saveRecord(C, "ar.invoice", null, { customerId: cust.id }, undefined, client);
    const sl = await saveRecord(C, "ar.invoiceLine", null, { invoiceId: sinv.id, itemId: food.id, qty: "1" }, undefined, client);
    expect([sl.taxCodeId, sl.taxAmount]).toEqual([await id("tax.taxCode", "V12"), "12.00"]);

    // deník: dodavatel tuzemsko + účet nákladů s položkou DPH S21 → P21; částky včetně DPH
    const a518 = await one("gl.account", { accountNum: "518000" });
    await saveRecord(C, "gl.account", String(a518.id), { ...a518, itemTaxGroupId: await id("tax.itemTaxGroup", "S21") }, undefined, client);
    const gen = await one("gl.journalName", { code: "GEN" });
    await saveRecord(C, "gl.journalName", String(gen.id), { ...gen, amountsIncludeTax: true }, undefined, client);
    const s2 = await saveRecord(C, "gab.subject", null, { name: "Tuzemec s.r.o.", vatId: "CZ11223344" }, undefined, client);
    const v2 = await saveRecord(C, "ap.vendor", null, { subjectId: s2.id, groupId: apGroup.id }, undefined, client);
    const j = await saveRecord(C, "gl.journal", null, { journalNameId: gen.id, date: "2026-11-12", description: "Faktura deníkem" }, undefined, client);
    const jl = await saveRecord(C, "gl.journalLine", null, { journalId: j.id, accountType: "ledger", accountId: a518.id, debit: "12100", offsetType: "vendor", offsetVendorId: v2.id, taxDocNum: "FA-555" }, undefined, client);
    expect([jl.taxGroupId, jl.itemTaxGroupId, jl.taxCodeId, jl.taxAmount, jl.taxExtra ?? null]).toEqual([await id("tax.taxGroup", "TUZ"), await id("tax.itemTaxGroup", "S21"), await id("tax.taxCode", "P21"), "2100.00", null]);
    await runAction(C, "gl.journal", String(j.id), "post", client);
    // kód přímo, bez DPH v částce (jiný název deníku) — přičtené DPH mění vyrovnanost
    const gen2 = (await getRecord(C, "gl.journalName", String(gen.id), client))!;
    await saveRecord(C, "gl.journalName", String(gen.id), { ...gen2, amountsIncludeTax: false }, undefined, client);
    const j2 = await saveRecord(C, "gl.journal", null, { date: "2026-11-12", description: "Bez DPH v částce" }, undefined, client);
    const jl2 = await saveRecord(C, "gl.journalLine", null, { journalId: j2.id, accountType: "ledger", accountId: (await one("gl.account", { accountNum: "501000" })).id, debit: "100", taxCodeId: await id("tax.taxCode", "P21") }, undefined, client);
    expect([jl2.taxAmount, jl2.taxExtra]).toEqual(["21.00", "21.00"]);

    const jr = (await getRecord(C, "gl.journal", String(j.id), client))!;
    const jgl = (await listRecords(C, "gl.trans", { filter: { voucherId: String(jr.voucherId) }, pageSize: 20 }, client)).rows;
    expect(jgl.map((r) => `${acc(r)}:${r.amount}`).sort()).toEqual(["321000:-12100.00", "343000:2100.00", "518000:10000.00"].sort());
    const jt = (await listRecords(C, "tax.trans", { filter: { sourceId: String(j.id) }, pageSize: 20 }, client)).rows;
    expect(jt.map((r) => [r.direction, r.reportLine, r.base, r.tax, r.documentNum, r.vatId])).toEqual([["input", "40", "10000.00", "2100.00", "FA-555", "CZ11223344"]]);

    // přiznání: ř. 5, 40, 43; KH: A.2 (EU) a B.2 (tuzemsko nad 10 000)
    await saveRecord(C, "tax.parameters", null, { taxOfficeCode: "451", subjectType: "P", street: "Ulice", houseNo: "1", city: "Praha", zipCode: "11000" }, undefined, client);
    const ret = await saveRecord(C, "tax.return", null, { kind: "dp3", year: 2026, month: 11 }, undefined, client);
    await runAction(C, "tax.return", String(ret.id), "calculate", client);
    const r = (await getRecord(C, "tax.return", String(ret.id), client))!;
    expect([r.taxOut, r.deduction, r.result]).toEqual(["210.00", "2310.00", "-2100.00"]);
    expect(String(r.lineSummary)).toContain("ř. 43");
    const xml = String((await downloadFile(C, "tax.return", String(ret.id), "xml", client)).data);
    expect(xml).toContain('<Veta1 p_sl23_e="1000" dan_psl23_e="210"/>');
    expect(xml).toContain('pln23="10000" odp_tuz23_nar="2100" nar_zdp23="1000" od_zdp23="210" odp_sum_nar="2310"');
    expect(xml).toContain('dano_no="2100"');
    const kh = await saveRecord(C, "tax.return", null, { kind: "kh", year: 2026, month: 11 }, undefined, client);
    const khXml = String((await downloadFile(C, "tax.return", String(kh.id), "xml", client)).data);
    expect(khXml).toContain('<VetaA2 c_radku="1" k_stat="DE" vatid_dod="123456789" c_evid_dd="INV-77" dppd="10.11.2026" zakl_dane1="1000.00" dan1="210.00"/>');
    expect(khXml).toContain('<VetaB2 c_radku="1" dic_dod="11223344" c_evid_dd="FA-555"');
    expect(khXml).toContain('celk_zd_a2="1000.00"');
  }, 180_000);
});
