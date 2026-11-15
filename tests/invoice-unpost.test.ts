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

    // podané přiznání za říjen → zrušit nejde
    await inTenant(T, (x) => x.sys().api().create("tax.return", { kind: "dp3", year: 2026, month: 10, period: "2026-10", status: "filed" }), client);
    await expect(runAction(T, "ar.invoice", String(inv.id), "unpost", client)).rejects.toMatchObject({ label: "@TAX:UnpostFiled" });
  }, 120_000);
});
