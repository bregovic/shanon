/**
 * Smazání firmy i s daty (zkušební firma): zaúčtované doklady, zápisy HK, DPH, saldo, přílohy, číselníky
 * a přiřazení uživatelů zmizí; jiná firma tenanta zůstane netknutá; vlastní (přihlášenou) firmu smazat nejde.
 */
import { enableModulesWithSetup } from "@/server/company-modules";
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { addFile } from "@/server/docuref";
import { registry } from "@/registry";

const client = createPrisma();
const run = Date.now().toString(36);

async function countCompanyRows(tenantId: string, companyId: string) {
  let n = 0;
  for (const o of registry.objects.values()) {
    if (o.scope !== "company") continue;
    const r = await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE shanon_app");
      await tx.$queryRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", tenantId);
      return tx.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) AS c FROM "${o.table}" WHERE company_id = $1::uuid`, companyId);
    });
    n += Number(r[0].c);
  }
  return n;
}

describe("smazání firmy s daty", () => {
  it("smaže zkušební firmu i se zaúčtovanými doklady, druhou firmu nechá", async () => {
    const A = (await provisionTenant(client, { code: `t-del-${run}`, name: "Del", adminEmail: `del-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "inv"], company: { code: "A", name: "Ostrá" } })).ctx;
    const b = await saveRecord(A, "sys.company", null, { code: "ZK", name: "Zkušební", currency: "CZK", country: "CZ" }, undefined, client);
    // další firma organizace začíná s minimem modulů — zapnout agendu jako ve Správě systému → Moduly
    await enableModulesWithSetup(A, String(b.id), ["ar", "ap", "inv"], "cs", client);
    const B: Ctx = { ...A, companyId: String(b.id) };

    // zkušební firma: odběratel, zaúčtovaná faktura s přílohou, skupina položek
    const subj = await saveRecord(B, "gab.subject", null, { name: "Odběratel zkoušky" }, undefined, client);
    const grp = (await listRecords(B, "ar.group", {}, client)).rows[0];
    const cust = await saveRecord(B, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(B, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-15" }, undefined, client);
    await saveRecord(B, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Služba", qty: "1", unitPrice: "1000" }, undefined, client);
    await runAction(B, "ar.invoice", String(inv.id), "post", client);
    await addFile(B, "ar.invoice", String(inv.id), { name: "priloha.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 test") }, client);
    expect((await listRecords(B, "gl.trans", {}, client)).total).toBeGreaterThan(0);
    const before = await countCompanyRows(A.tenantId, String(b.id));
    expect(before).toBeGreaterThan(20);
    const aRows = await countCompanyRows(A.tenantId, String(A.companyId));

    // člen virtuální společnosti (vazba na firmu jiným sloupcem než company_id)
    const vc = await saveRecord(A, "sys.virtualCompany", null, { code: "SKUP", name: "Skupina" }, undefined, client);
    await saveRecord(A, "sys.virtualMember", null, { virtualCompanyId: vc.id, memberCompanyId: b.id }, undefined, client);

    // vlastní firmu smazat nejde
    await expect(runAction(B, "sys.company", String(b.id), "deleteWithData", client)).rejects.toMatchObject({ label: "@SYS:DeleteCompanyCurrent" });
    // z ostré firmy: zkušební i se vším zmizí
    await runAction(A, "sys.company", String(b.id), "deleteWithData", client);
    expect(await countCompanyRows(A.tenantId, String(b.id))).toBe(0);
    expect((await listRecords(A, "sys.company", {}, client)).rows.filter((c) => !c.virtual).map((c) => c.code)).toEqual(["A"]);
    const refs = await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE shanon_app");
      await tx.$queryRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", A.tenantId);
      return tx.$queryRawUnsafe<{ c: bigint }[]>("SELECT count(*) AS c FROM sys_docuref WHERE tenant_id = $1::uuid AND record_id = $2::uuid", A.tenantId, String(inv.id));
    });
    expect(Number(refs[0].c)).toBe(0);
    expect(await client.sysUserCompany.count({ where: { companyId: String(b.id) } })).toBe(0);
    expect((await listRecords(A, "sys.virtualMember", {}, client)).rows.filter((m) => m.memberCompanyId === b.id)).toEqual([]);
    // ostrá firma beze změny
    expect(await countCompanyRows(A.tenantId, String(A.companyId))).toBe(aRows);
  }, 180_000);
});
