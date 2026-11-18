/**
 * Zrušit zaúčtování faktury (superuživatel): zpět do konceptu, zápisy HK, DPH a saldo pryč, oprava a nové zaúčtování;
 * správce firmy ne, podané přiznání za období DUZP ne.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("zrušit zaúčtování faktury", () => {
  it("superuživatel vrátí fakturu do konceptu, opraví a znovu zaúčtuje", async () => {
    const T = (await provisionTenant(client, { code: `t-up-${run}`, name: "Up", adminEmail: `up-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar"], company: { code: "U", name: "U" } })).ctx;
    const grp = (await listRecords(T, "ar.group", {}, client)).rows[0];
    const s = await saveRecord(T, "gab.subject", null, { name: "Odběratel" }, undefined, client);
    const c = await saveRecord(T, "ar.customer", null, { subjectId: s.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: c.id, invoiceDate: "2026-10-15" }, undefined, client);
    const line = await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Služba", qty: "1", unitPrice: "1000" }, undefined, client);
    await runAction(T, "ar.invoice", String(inv.id), "post", client);
    const posted = (await getRecord(T, "ar.invoice", String(inv.id), client))!;
    const count = async (obj: string, filter: Record<string, string>) => (await listRecords(T, obj, { filter }, client)).total;
    expect(await count("gl.trans", { voucherId: String(posted.voucherId) })).toBeGreaterThan(0);

    // správce firmy (ne superuživatel) nesmí
    const companyAdmin: Ctx = { ...T, perms: { ...T.perms, admin: false, companyAdmin: true } };
    await expect(runAction(companyAdmin, "ar.invoice", String(inv.id), "unpost", client)).rejects.toMatchObject({ label: "@SYS:NoAccess" });

    await runAction(T, "ar.invoice", String(inv.id), "unpost", client);
    const draft = (await getRecord(T, "ar.invoice", String(inv.id), client))!;
    expect([draft.status, draft.voucherId]).toEqual(["draft", null]);
    expect(await count("gl.trans", { voucherId: String(posted.voucherId) })).toBe(0);
    expect(await count("tax.trans", { voucherId: String(posted.voucherId) })).toBe(0);
    expect(await count("ar.trans", { invoiceId: String(inv.id) })).toBe(0);

    // oprava a nové zaúčtování
    await saveRecord(T, "ar.invoiceLine", String(line.id), { ...line, unitPrice: "1200" }, undefined, client);
    await runAction(T, "ar.invoice", String(inv.id), "post", client);
    const again = (await getRecord(T, "ar.invoice", String(inv.id), client))!;
    expect([again.status, again.amountNet]).toEqual(["posted", "1200.00"]);

    // oprava daňové transakce: DIČ a DUZP jdou změnit, ostatní pole ne
    const [tt] = (await listRecords(T, "tax.trans", { filter: { voucherId: String(again.voucherId) } }, client)).rows;
    await saveRecord(T, "tax.trans", String(tt.id), { ...tt, vatId: "CZ12345678", taxDate: "2026-10-20", tax: "1" }, undefined, client);
    const fixed = (await getRecord(T, "tax.trans", String(tt.id), client))!;
    expect([fixed.vatId, String(fixed.taxDate).slice(0, 10), fixed.tax]).toEqual(["CZ12345678", "2026-10-20", tt.tax]);
    await expect(saveRecord(T, "tax.trans", null, { taxDate: "2026-10-20", taxCodeId: tt.taxCodeId, direction: "output", base: "1", tax: "1" }, undefined, client)).rejects.toBeTruthy();

    // podané přiznání za říjen → zrušit nejde
    await inTenant(T, (x) => x.sys().api().create("tax.return", { kind: "dp3", year: 2026, month: 10, period: "2026-10", status: "filed" }), client);
    await expect(runAction(T, "ar.invoice", String(inv.id), "unpost", client)).rejects.toMatchObject({ label: "@TAX:UnpostFiled" });
    // a transakci podaného období opravit nejde
    await expect(saveRecord(T, "tax.trans", String(tt.id), { ...fixed, vatId: "CZ87654321" }, undefined, client)).rejects.toMatchObject({ label: "@TAX:TransFiled" });
  }, 120_000);

  it("účtenka v přijatých fakturách: bez čísla dokladu dodavatele, DPH jako zjednodušený doklad", async () => {
    const T = (await provisionTenant(client, { code: `t-rc-${run}`, name: "Rc", adminEmail: `rc-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap"], company: { code: "R", name: "R" } })).ctx;
    const grp = (await listRecords(T, "ap.group", {}, client)).rows[0];
    const s = await saveRecord(T, "gab.subject", null, { name: "Papírnictví" }, undefined, client);
    const v = await saveRecord(T, "ap.vendor", null, { subjectId: s.id, groupId: grp.id }, undefined, client);
    // bez čísla dodavatele a bez příznaku účtenky zaúčtovat nejde
    const plain = await saveRecord(T, "ap.invoice", null, { vendorId: v.id, invoiceDate: "2026-11-10" }, undefined, client);
    await saveRecord(T, "ap.invoiceLine", null, { invoiceId: plain.id, description: "Papír", qty: "1", unitPrice: "100" }, undefined, client);
    await expect(runAction(T, "ap.invoice", String(plain.id), "post", client)).rejects.toMatchObject({ label: "@SYS:FixErrors" });
    // účtenka ano
    const h = (await getRecord(T, "ap.invoice", String(plain.id), client))!;
    await saveRecord(T, "ap.invoice", String(plain.id), { ...h, docType: "receipt" }, undefined, client);
    await runAction(T, "ap.invoice", String(plain.id), "post", client);
    const posted = (await getRecord(T, "ap.invoice", String(plain.id), client))!;
    const tt = (await listRecords(T, "tax.trans", { filter: { voucherId: String(posted.voucherId) } }, client)).rows;
    expect(tt.length).toBeGreaterThan(0);
    expect(tt.every((t) => t.simplified === true && t.documentNum === posted.invoiceNum)).toBe(true);
  }, 120_000);

  it("dar v přijatých fakturách: bez DPH, náklad 543100, závazek 379 z profilu darů, úhrada deníkem proti 379", async () => {
    const T = (await provisionTenant(client, { code: `t-dar-${run}`, name: "Dar", adminEmail: `dar-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap"], company: { code: "D", name: "D" } })).ctx;
    const grp = (await listRecords(T, "ap.group", {}, client)).rows[0];
    const acc = Object.fromEntries((await listRecords(T, "gl.account", { filters: { accountNum: "379000, 543100, 321000, 395000, 518000" } }, client)).rows.map((a) => [a.accountNum, a.id]));
    const [params] = (await listRecords(T, "ap.parameters", {}, client)).rows;
    const [dar] = (await listRecords(T, "ap.postingProfile", { filter: { code: "DAR" } }, client)).rows;
    expect(params.donationProfileId).toBe(dar.id);
    const s = await saveRecord(T, "gab.subject", null, { name: "Spolek" }, undefined, client);
    const v = await saveRecord(T, "ap.vendor", null, { subjectId: s.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(T, "ap.invoice", null, { vendorId: v.id, docType: "donation", invoiceDate: "2026-11-10", vs: "777" }, undefined, client);
    expect([inv.postingProfileId, inv.taxGroupId]).toEqual([dar.id, null]);
    const line = await saveRecord(T, "ap.invoiceLine", null, { invoiceId: inv.id, description: "Dar spolku", qty: "1", unitPrice: "5000" }, undefined, client);
    expect([line.expenseAccountId, line.taxCodeId, line.taxAmount]).toEqual([acc["543100"], null, "0.00"]);
    await runAction(T, "ap.invoice", String(inv.id), "post", client);
    const posted = (await getRecord(T, "ap.invoice", String(inv.id), client))!;
    const lines = (await listRecords(T, "gl.trans", { filter: { voucherId: String(posted.voucherId) } }, client)).rows;
    expect(lines.map((l) => `${l.accountId === acc["543100"] ? "543100" : l.accountId === acc["379000"] ? "379000" : "?"}:${l.amount}`).sort()).toEqual(["379000:-5000.00", "543100:5000.00"]);
    expect((await listRecords(T, "tax.trans", { filter: { voucherId: String(posted.voucherId) } }, client)).total).toBe(0);
    const [tr] = (await listRecords(T, "ap.trans", { filter: { invoiceId: String(inv.id) } }, client)).rows;
    expect(tr.accountId).toBe(acc["379000"]);

    // úhrada deníkem s VS: MD 379 (ne 321), dar uhrazen
    const j = await saveRecord(T, "gl.journal", null, { date: "2026-11-12", description: "Úhrada daru" }, undefined, client);
    await saveRecord(T, "gl.journalLine", null, { journalId: j.id, accountType: "vendor", vendorId: v.id, debit: "5000", vs: "777", offsetType: "ledger", offsetAccountId: acc["395000"] }, undefined, client);
    await runAction(T, "gl.journal", String(j.id), "post", client);
    const pj = (await getRecord(T, "gl.journal", String(j.id), client))!;
    const pl = (await listRecords(T, "gl.trans", { filter: { voucherId: String(pj.voucherId) } }, client)).rows;
    expect(pl.find((l) => l.accountId === acc["379000"])?.amount).toBe("5000.00");
    expect(pl.some((l) => l.accountId === acc["321000"])).toBe(false);
    expect((await getRecord(T, "ap.invoice", String(inv.id), client))!.paidAmount).toBe("5000.00");

    // běžná faktura téhož dodavatele dál na 321 (bez profilu = účet skupiny)
    const inv2 = await saveRecord(T, "ap.invoice", null, { vendorId: v.id, externalNum: "F1", invoiceDate: "2026-11-10" }, undefined, client);
    const [std] = (await listRecords(T, "ap.postingProfile", { filter: { code: "STANDARD" } }, client)).rows;
    expect(inv2.postingProfileId).toBe(std.id);
    // přepnutí na dar převezme profil darů, zpět na fakturu ho zase vrátí
    const l2 = await saveRecord(T, "ap.invoiceLine", null, { invoiceId: inv2.id, description: "Dar", qty: "1", unitPrice: "1000" }, undefined, client);
    expect(l2.expenseAccountId).not.toBe(acc["543100"]);
    const sw = await saveRecord(T, "ap.invoice", String(inv2.id), { ...inv2, docType: "donation" }, undefined, client);
    expect(sw.postingProfileId).toBe(dar.id);
    // řádek s výchozím účtem skupiny přejde na účet darů a bez DPH
    const l2d = (await getRecord(T, "ap.invoiceLine", String(l2.id), client))!;
    expect([l2d.expenseAccountId, l2d.taxCodeId]).toEqual([acc["543100"], null]);
    const back = await saveRecord(T, "ap.invoice", String(inv2.id), { ...sw, docType: "invoice" }, undefined, client);
    expect(back.postingProfileId).toBe(std.id);
    // výchozí profily závazků
    expect((await listRecords(T, "ap.postingProfile", {}, client)).rows.map((r) => r.code).sort()).toEqual(["DAR", "FU", "OST", "STANDARD", "ZAM"]);

    // profil pro konkrétního dodavatele (např. zaměstnanec → 333) má přednost před „Všechny“
    const prof = await saveRecord(T, "ap.postingProfile", null, { code: "ZAM2", name: "Zaměstnanci 2" }, undefined, client);
    const [a333] = (await listRecords(T, "gl.account", { filters: { accountNum: "333000" } }, client)).rows;
    await saveRecord(T, "ap.postingProfileLine", null, { profileId: prof.id, accountCode: "all", summaryAccountId: acc["321000"] }, undefined, client);
    await saveRecord(T, "ap.postingProfileLine", null, { profileId: prof.id, accountCode: "partner", vendorId: v.id, summaryAccountId: a333.id }, undefined, client);
    // profil u dodavatele → nová faktura ho převezme
    const vv = (await getRecord(T, "ap.vendor", String(v.id), client))!;
    await saveRecord(T, "ap.vendor", String(v.id), { ...vv, postingProfileId: prof.id }, undefined, client);
    const inv3 = await saveRecord(T, "ap.invoice", null, { vendorId: v.id, externalNum: "CP1", invoiceDate: "2026-11-10" }, undefined, client);
    expect(inv3.postingProfileId).toBe(prof.id);
    await saveRecord(T, "ap.invoiceLine", null, { invoiceId: inv3.id, description: "Cestovné", qty: "1", unitPrice: "300", taxCodeId: null }, undefined, client);
    await runAction(T, "ap.invoice", String(inv3.id), "post", client);
    const [tr3] = (await listRecords(T, "ap.trans", { filter: { invoiceId: String(inv3.id) } }, client)).rows;
    expect(tr3.accountId).toBe(a333.id);
    void acc["518000"];
  }, 120_000);
});
