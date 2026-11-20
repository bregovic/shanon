/**
 * Moduly po firmách (agenda firmy): nová firma převezme moduly firmy, ze které vzniká; zapnutí / vypnutí
 * v jedné firmě nemění ostatní; souhrn tenanta drží moduly zapnuté aspoň v jedné firmě.
 */
import { enableModulesWithSetup } from "@/server/company-modules";
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { companyModules, disableCompanyModules, enableCompanyModules } from "@/server/modules";

const client = createPrisma();
const run = Date.now().toString(36);

describe("moduly po firmách", () => {
  it("každá firma má vlastní moduly", async () => {
    const r = await provisionTenant(client, { code: `t-cm-${run}`, name: "Cm", adminEmail: `cm-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "ar"], company: { code: "A", name: "Firma A" } });
    const T = r.ctx;
    const tenantMods = async () => (await client.sysTenantModule.findMany({ where: { tenantId: T.tenantId } })).map((m) => m.moduleId);
    const a = String(r.company.id);
    const modsA = await companyModules(T.tenantId, a, await tenantMods(), client);
    expect([modsA.has("pos"), modsA.has("ar"), modsA.has("sys")]).toEqual([true, true, true]);

    // další firma organizace začíná s minimem (jádro, organizace, adresář); pokladnu a AR jí zapneme, pak pokladnu vypneme
    const b = String((await inTenant(T, (s) => s.save("sys.company", null, { code: "B", name: "Firma B" }), client)).id);
    const modsB0 = await companyModules(T.tenantId, b, await tenantMods(), client);
    expect([modsB0.has("sys"), modsB0.has("org"), modsB0.has("gab"), modsB0.has("pos"), modsB0.has("ar"), modsB0.has("gl")]).toEqual([true, true, true, false, false, false]);
    expect(await enableModulesWithSetup(T, b, ["pos", "ar"], "cs", client)).toContain("pos");
    expect((await companyModules(T.tenantId, b, await tenantMods(), client)).has("pos")).toBe(true);
    // výchozí nastavení zapnutých modulů proběhlo (číselná řada účtenek)
    expect((await inTenant({ ...T, companyId: b, modules: await companyModules(T.tenantId, b, await tenantMods(), client) }, (s) => s.sys().api().find("sys.numberSeq", { usedFor: "pos.receipt" }, { take: 1 }), client)).length).toBe(1);
    await disableCompanyModules(T.tenantId, b, ["pos"], client);
    expect((await companyModules(T.tenantId, b, await tenantMods(), client)).has("pos")).toBe(false);
    expect((await companyModules(T.tenantId, a, await tenantMods(), client)).has("pos")).toBe(true);
    expect(await tenantMods()).toContain("pos"); // firma A ji pořád má

    // vypnout i ve firmě A → zmizí ze souhrnu tenanta; zapnout e-shop jen ve firmě B (i se závislostmi)
    await disableCompanyModules(T.tenantId, a, ["pos"], client);
    expect(await tenantMods()).not.toContain("pos");
    await enableCompanyModules(T.tenantId, b, ["shop"], client);
    const modsB = await companyModules(T.tenantId, b, await tenantMods(), client);
    expect([modsB.has("shop"), modsB.has("inv"), modsB.has("bank")]).toEqual([true, true, true]);
    expect((await companyModules(T.tenantId, a, await tenantMods(), client)).has("shop")).toBe(false);
  }, 120_000);
});
