/** Náhled dokladu: zaúčtování nanečisto ukáže zápisy HK a DPH, nic nezapíše. */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { previewPosting } from "@/server/posting-preview";

const client = createPrisma();
const run = Date.now().toString(36);

describe("náhled dokladu", () => {
  it("faktura v konceptu: zápisy 311/604/343 a DPH, faktura zůstane nezaúčtovaná; deník; chyba jako hláška", async () => {
    const T = (await provisionTenant(client, { code: `t-pp-${run}`, name: "PP", adminEmail: `pp-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar"], company: { code: "P", name: "P" } })).ctx;
    const subj = await saveRecord(T, "gab.subject", null, { name: "Bistro" }, undefined, client);
    const cust = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: (await listRecords(T, "ar.group", {}, client)).rows[0].id }, undefined, client);
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-15" }, undefined, client);
    await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Uzeniny", qty: "1", unitPrice: "100" }, undefined, client);

    const p = await previewPosting(T, "ar.invoice", String(inv.id), client);
    expect(p.vouchers.length).toBe(1);
    const lines = p.vouchers[0].lines.map((l) => [l.account.slice(0, 6), l.debit, l.credit]);
    expect(lines).toEqual(expect.arrayContaining([["311000", "121.00", null], ["604000", null, "100.00"], ["343000", null, "21.00"]]));
    expect(p.tax.map((x) => [x.base, x.tax])).toEqual([["100.00", "21.00"]]);
    // nic se nezapsalo
    expect((await getRecord(T, "ar.invoice", String(inv.id), client))!.status).toBe("draft");
    expect((await listRecords(T, "gl.voucher", {}, client)).total).toBe(0);

    // deník: dva doklady
    const acc = async (n: string) => (await listRecords(T, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id;
    const j = await saveRecord(T, "gl.journal", null, { description: "Mzdy", date: "2026-11-15" }, undefined, client);
    for (const [a, d, c] of [["521000", "100", null], ["331000", null, "100"], ["524000", "34", null], ["336000", null, "34"]] as const)
      await saveRecord(T, "gl.journalLine", null, { journalId: j.id, accountId: await acc(a), debit: d, credit: c }, undefined, client);
    const pj = await previewPosting(T, "gl.journal", String(j.id), client);
    expect(pj.vouchers.length).toBe(2);
    expect((await getRecord(T, "gl.journal", String(j.id), client))!.status).toBe("draft");

    // chyba zaúčtování (nevyrovnaný deník) jako výjimka s hláškou
    await saveRecord(T, "gl.journalLine", null, { journalId: j.id, accountId: await acc("521000"), debit: "5" }, undefined, client);
    await expect(previewPosting(T, "gl.journal", String(j.id), client)).rejects.toMatchObject({ label: expect.stringMatching(/^@GL:/) });
  }, 120_000);
});
