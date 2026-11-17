/** Zjednodušit DPH pro neplátce: výchozí nastavení na BEZ / P0, nepoužité kódy pryč, použité v dokladech zůstanou. */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("zjednodušit DPH pro neplátce", () => {
  it("plná sada → BEZ / P0, kód z dokladu zůstane", async () => {
    const r = await provisionTenant(client, { code: `t-sv-${run}`, name: "Sv", adminEmail: `sv-${run}@test.local`, adminPassword: "heslo-12345", modules: ["org", "ar", "ap", "pos"], company: { code: "S", name: "Simple" } });
    const T = r.ctx;
    // doklad s V21 (vznikl, dokud byla firma plátce)
    const [grp] = (await listRecords(T, "ar.group", {}, client)).rows;
    const subj = await saveRecord(T, "gab.subject", null, { name: "Zákazník" }, undefined, client);
    const c = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: c.id }, undefined, client);
    await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Služba", qty: "1", unitPrice: "100" }, undefined, client);
    await runAction(T, "ar.invoice", String(inv.id), "post", client);

    const [org] = (await listRecords(T, "org.entity", {}, client)).rows;
    // plátce: akce odmítne
    await expect(runAction(T, "org.entity", String(org.id), "simplifyVat", client)).rejects.toBeTruthy();
    await saveRecord(T, "org.entity", String(org.id), { ...org, vatPayer: false }, undefined, client);
    const W = { ...T, warnings: [] as string[] };
    await runAction(W, "org.entity", String(org.id), "simplifyVat", client);
    expect(W.warnings[0]).toMatch(/^DPH zjednodušeno\. Smazáno: .*P21.*Ponecháno \(použité v dokladech\): .*V21/);

    const codes = (await listRecords(T, "tax.taxCode", {}, client)).rows;
    expect(codes.map((x) => x.code).sort()).toEqual(["BEZ", "P0", "V21"]);
    const id = (code: string) => codes.find((x) => x.code === code)!.id;
    const groups = (await listRecords(T, "inv.itemGroup", {}, client)).rows;
    expect(groups.every((g) => g.taxCodeId === id("BEZ") && g.purchaseTaxCodeId === id("P0"))).toBe(true);
    const [arg] = (await listRecords(T, "ar.group", {}, client)).rows;
    const [apg] = (await listRecords(T, "ap.group", {}, client)).rows;
    expect([arg.taxCodeId, apg.taxCodeId]).toEqual([id("BEZ"), id("P0")]);
    expect((await listRecords(T, "tax.taxGroup", {}, client)).rows.map((x) => x.code)).toEqual(["TUZ"]);
    expect((await listRecords(T, "tax.itemTaxGroup", {}, client)).rows.map((x) => x.code)).toEqual(["BEZ"]);
    // druhé spuštění nic nerozbije
    await runAction(T, "org.entity", String(org.id), "simplifyVat", client);
  }, 180_000);
});
