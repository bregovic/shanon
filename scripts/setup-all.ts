/**
 * Doplní výchozí nastavení (src/server/setup.ts) ve všech firmách všech
 * tenantů. Idempotentní — běží při každém nasazení (db:deploy), aby nové
 * výchozí řady a číselníky dostali i existující tenanti.
 */
import "dotenv/config";
import { dependencyClosure } from "../src/core/module";
import { ADMIN } from "../src/core/security";
import { registry } from "../src/registry";
import { inTenant, type Ctx } from "../src/server/data";
import { createPrisma, withTenant } from "../src/server/db";
import { setupCompany } from "../src/server/setup";

async function main() {
  const client = createPrisma();
  const tenants = await client.sysTenant.findMany({ include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  for (const t of tenants) {
    const modules = dependencyClosure(registry, ["sys", ...t.modules.map((m) => m.moduleId)]);
    // nosné firmy virtuálních společností nedostávají výchozí nastavení (jen sdílená data);
    // co v nich vzniklo dřív, se vypne (dávky, napojení)
    await withTenant(t.id, async (tx) => {
      const virt = (await tx.sysCompany.findMany({ where: { tenantId: t.id, virtual: true }, select: { id: true } })).map((c) => c.id);
      if (!virt.length) return;
      await tx.sysBatchJob.updateMany({ where: { tenantId: t.id, companyId: { in: virt }, active: true }, data: { active: false } });
      await tx.intConnection.updateMany({ where: { tenantId: t.id, companyId: { in: virt }, active: true }, data: { active: false } });
    }, client);
    const companies = await withTenant(t.id, (tx) => tx.sysCompany.findMany({ where: { tenantId: t.id, virtual: false }, select: { id: true, code: true } }), client);
    for (const c of companies) {
      const ctx: Ctx = { tenantId: t.id, userId: t.users[0]?.id ?? t.id, companyId: c.id, role: "admin", perms: ADMIN, modules, extensions: new Set() };
      const created = await inTenant(ctx, (s) => setupCompany(s.sys().api(), modules), client);
      const n = Object.values(created).reduce((a, b) => a + b, 0);
      if (n) console.log(`${t.code}/${c.code}: doplněno ${JSON.stringify(created)}`);
    }
  }
  console.log("Výchozí nastavení: hotovo");
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
