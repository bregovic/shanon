/**
 * Moduly po firmách (agenda firmy): nová firma převezme moduly firmy, ze které vzniká; zapnutí / vypnutí
 * v jedné firmě nemění ostatní; souhrn tenanta drží moduly zapnuté aspoň v jedné firmě.
 */
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

    // druhá firma vznikne z firmy A → stejné moduly; pak jí vypneme pokladnu
    const b = String((await inTenant(T, (s) => s.save("sys.company", null, { code: "B", name: "Firma B" }), client)).id);
    expect((await companyModules(T.tenantId, b, await tenantMods(), client)).has("pos")).toBe(true);
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
