/**
 * Údržba (jen čtení): stav firmy pro veřejné vstupy — organizace a její zkratka, obsazení zkratky,
 * moduly, e-shop (zveřejnění, doprava, platby, katalog). Nic nezapisuje.
 *
 *   npx tsx --conditions=react-server scripts/company-check.ts <tenant> <kód firmy | IČO>
 */
import "dotenv/config";
import { createPrisma, withTenant } from "../src/server/db";
import { companyModules } from "../src/server/modules";

async function main() {
  const [tenantCode, which] = process.argv.slice(2);
  const client = createPrisma();
  const t = await client.sysTenant.findUniqueOrThrow({ where: { code: tenantCode }, include: { modules: true } });
  const out = await withTenant(
    t.id,
    async (tx) => {
      const c = await tx.sysCompany.findFirstOrThrow({ where: { tenantId: t.id, OR: [{ code: which }, { regNo: which }] } });
      const org = await tx.orgEntity.findFirst({ where: { companyId: c.id } });
      const shops = await tx.shopShop.findMany({ where: { companyId: c.id }, select: { name: true, active: true, publicUrl: true, customerId: true } });
      const count = (m: { count: (a: { where: Record<string, unknown> }) => Promise<number> }, where: Record<string, unknown>) => m.count({ where: { companyId: c.id, ...where } });
      return {
        company: { code: c.code, name: c.name, regNo: c.regNo, vatPayer: c.vatPayer },
        org: org && { legalName: org.legalName, tradeName: org.tradeName, publicSlug: org.publicSlug, email: org.email, phone: org.phone, naceCode: org.naceCode, bankAccount: org.bankAccount, logo: !!org.logo },
        shops,
        items: { all: await count(tx.invItem, {}), eshop: await count(tx.invItem, { eshop: true }), withImage: await count(tx.invItem, { image: { not: null } }) },
        categories: { all: await count(tx.invCategory, {}), eshop: await count(tx.invCategory, { eshop: true }) },
        paymentMethods: await tx.bankPaymentMethod.findMany({ where: { companyId: c.id }, select: { code: true, kind: true, eshop: true, blocked: true } }),
        deliveries: await tx.shopDelivery.findMany({ where: { companyId: c.id }, select: { code: true, name: true, active: true } }).catch(() => "?"),
        accounts: await count(tx.glAccount, {}),
        companyId: c.id,
        orgId: org?.id,
      };
    },
    client,
  );
  const slug = out.org?.publicSlug ?? null;
  const key = slug ? await client.sysGlobalKey.findUnique({ where: { namespace_key: { namespace: "entity", key: slug } } }) : null;
  const modules = [...(await companyModules(t.id, out.companyId, t.modules.map((m) => m.moduleId), client))];
  console.log(
    JSON.stringify(
      {
        ...out,
        tenantHasShop: t.modules.some((m) => m.moduleId === "shop"),
        companyModules: modules,
        slugKey: key ? { ownerIsThisOrg: key.ownerId === out.orgId, tenantMatches: key.tenantId === t.id } : slug ? "ZKRATKA NENÍ ZAREGISTROVANÁ" : "BEZ ZKRATKY",
      },
      null,
      1,
    ),
  );
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
