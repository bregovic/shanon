/** Role Auditor: vidí a exportuje účetnictví (HK, banka, odběratelé, dodavatelé, pokladna, DPH), nic nezaloží, nezmění, nesmaže ani nezaúčtuje. */
import { afterAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { deleteRecord, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());

describe("role Auditor", () => {
  it("výchozí role s právy čtení; čte, ale nezakládá, nemění, nemaže ani neúčtuje", async () => {
    const A = (await provisionTenant(client, { code: `t-aud-${run}`, name: "AUD", adminEmail: `aud-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "bank", "cash"], company: { code: "A", name: "A" } })).ctx;
    const [role] = (await listRecords(A, "sys.role", { filter: { code: "AUDITOR" } }, client)).rows;
    const perms = (await listRecords(A, "sys.rolePermission", { filter: { roleId: role.id } }, client)).rows;
    const levels = Object.fromEntries(perms.map((p) => [String(p.target), p.level as "read"]));
    expect(levels).toEqual({ gl: "read", cash: "read", bank: "read", ar: "read", ap: "read", tax: "read", gab: "read" });
    const [grp] = (await listRecords(A, "ar.group", {}, client)).rows;
    const subj = await saveRecord(A, "gab.subject", null, { name: "Odběratel" }, undefined, client);
    const cust = await saveRecord(A, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const j = await saveRecord(A, "gl.journal", null, { date: "2026-11-20", description: "Test" }, undefined, client);

    const U: Ctx = { ...A, role: "user", perms: { admin: false, levels } };
    expect((await listRecords(U, "ar.customer", {}, client)).total).toBe(1);
    expect((await listRecords(U, "gl.account", { pageSize: 1 }, client)).total).toBeGreaterThan(0);
    expect((await listRecords(U, "gl.journal", {}, client)).total).toBe(1);
    await expect(saveRecord(U, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client)).rejects.toMatchObject({ label: "@SYS:NoAccess" });
    await expect(saveRecord(U, "gl.journal", String(j.id), { description: "Změna" }, j.version as number, client)).rejects.toMatchObject({ label: "@SYS:NoAccess" });
    await expect(deleteRecord(U, "ar.customer", String(cust.id), client)).rejects.toMatchObject({ label: "@SYS:NoAccess" });
    await expect(runAction(U, "gl.journal", String(j.id), "post", client)).rejects.toMatchObject({ label: "@SYS:NoAccess" });
    // pokladna (prodej) a nastavení mimo roli
    await expect(listRecords(U, "sys.role", {}, client)).rejects.toMatchObject({ label: "@SYS:NoAccess" });
  }, 120_000);
});
