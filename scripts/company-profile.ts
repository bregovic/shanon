/**
 * Údržba: profil firmy ze souboru JSON (údaje firmy, zapnuté moduly, daňové
 * parametry, skupiny položek). Údaje (IČO, DIČ, adresy) do repa nepatří —
 * soubor se předá zvenku. Bez parametrů vypíše tenanty, firmy a moduly.
 *
 *   npx tsx scripts/company-profile.ts
 *   npx tsx scripts/company-profile.ts <tenant> <kód firmy> <profil.json | base64:…>
 *
 * {
 *   "company": { "name": "…", "regNo": "…", "vatId": "…" },
 *   "modules": ["inv"],
 *   "taxParameters": { "taxOfficeCode": "451", … },
 *   "itemGroups": [{ "code": "UZENINY", "name": "Uzeniny", "taxCode": "V12", "revenueAccount": "601",
 *                    "purchaseTaxCode": "P12", "costAccount": "504" }]
 * }
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dependencyClosure, type RecordData } from "../src/core/module";
import { ADMIN } from "../src/core/security";
import { registry } from "../src/registry";
import { inTenant, type Ctx } from "../src/server/data";
import { createPrisma, withTenant } from "../src/server/db";
import { setupCompany } from "../src/server/setup";

interface Profile {
  company?: RecordData;
  modules?: string[];
  taxParameters?: RecordData;
  itemGroups?: { code: string; name: string; taxCode?: string; revenueAccount?: string; purchaseTaxCode?: string; costAccount?: string }[];
}

async function main() {
  const client = createPrisma();
  const [tenantCode, companyCode, src] = process.argv.slice(2);
  if (!tenantCode) {
    for (const t of await client.sysTenant.findMany({ include: { modules: true } })) {
      const cs = await withTenant(t.id, (tx) => tx.sysCompany.findMany({ where: { tenantId: t.id }, select: { code: true, name: true } }), client);
      console.log(`${t.code} (${t.name}): moduly ${t.modules.map((m) => m.moduleId).join(", ")}; firmy ${cs.map((c) => `${c.code}=${c.name}`).join(", ")}`);
    }
    return client.$disconnect();
  }
  const raw = src.startsWith("base64:") ? Buffer.from(src.slice(7), "base64").toString("utf8") : readFileSync(src, "utf8");
  const p = JSON.parse(raw) as Profile;

  const tenant = await client.sysTenant.findUniqueOrThrow({ where: { code: tenantCode }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  // moduly: přidat chybějící (i se závislostmi), nic nevypínat
  const have = new Set(tenant.modules.map((m) => m.moduleId));
  const wanted = dependencyClosure(registry, ["sys", ...have, ...(p.modules ?? [])]);
  for (const m of wanted) if (!have.has(m)) await client.sysTenantModule.create({ data: { tenantId: tenant.id, moduleId: m } });
  const company = await withTenant(tenant.id, (tx) => tx.sysCompany.findFirstOrThrow({ where: { tenantId: tenant.id, code: companyCode } }), client);
  const ctx: Ctx = { tenantId: tenant.id, userId: tenant.users[0]?.id ?? tenant.id, companyId: company.id, role: "admin", perms: ADMIN, modules: wanted, extensions: new Set() };

  await inTenant(
    ctx,
    async (s) => {
      if (p.company) await s.save("sys.company", company.id, p.company);
      const api = s.sys().api();
      await setupCompany(api, wanted);
      if (p.taxParameters) {
        const [tp] = await api.find("tax.parameters", {}, { take: 1 });
        if (tp) await api.update("tax.parameters", String(tp.id), p.taxParameters);
        else await api.create("tax.parameters", p.taxParameters);
      }
      const id = async (obj: string, field: string, v?: string) => (v ? ((await api.find(obj, { [field]: v }, { take: 1 }))[0]?.id ?? null) : null);
      for (const g of p.itemGroups ?? []) {
        const data = {
          code: g.code,
          name: g.name,
          taxCodeId: await id("tax.taxCode", "code", g.taxCode),
          revenueAccountId: await id("gl.account", "accountNum", g.revenueAccount),
          purchaseTaxCodeId: await id("tax.taxCode", "code", g.purchaseTaxCode),
          costAccountId: await id("gl.account", "accountNum", g.costAccount),
        };
        const [ex] = await api.find("inv.itemGroup", { code: g.code }, { take: 1 });
        if (ex) await api.update("inv.itemGroup", String(ex.id), data);
        else await api.create("inv.itemGroup", data);
      }
    },
    client,
  );
  console.log(`${tenantCode}/${companyCode}: profil nastaven (moduly ${[...wanted].join(", ")})`);
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
