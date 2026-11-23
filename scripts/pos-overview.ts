/**
 * Údržba (jen čtení): přehled pokladních směn a účtenek po organizacích a firmách — co mazat skriptem
 * scripts/delete-receipts.ts.
 *
 *   npx tsx --conditions=react-server scripts/pos-overview.ts
 */
import "dotenv/config";
import { createPrisma, withTenant } from "../src/server/db";

async function main() {
  const client = createPrisma();
  const tenants = await client.sysTenant.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } });
  let any = false;
  for (const t of tenants) {
    const rows = await withTenant(
      t.id,
      async (tx) => {
        const companies = await tx.sysCompany.findMany({ where: { tenantId: t.id }, select: { id: true, code: true, name: true } });
        const out: string[] = [];
        for (const c of companies) {
          const shifts = await tx.posShift.count({ where: { tenantId: t.id, companyId: c.id } });
          const receipts = await tx.posReceipt.findMany({ where: { tenantId: t.id, companyId: c.id }, select: { receiptNum: true, date: true }, orderBy: { createdAt: "desc" }, take: 3 });
          const count = await tx.posReceipt.count({ where: { tenantId: t.id, companyId: c.id } });
          if (shifts || count)
            out.push(`${t.code} · ${c.code} ${c.name} · směn ${shifts} · účtenek ${count}${receipts.length ? ` · poslední ${receipts.map((r) => `${r.receiptNum} (${r.date.toISOString().slice(0, 10)})`).join(", ")}` : ""}`);
        }
        return out;
      },
      client,
    );
    for (const r of rows) console.log(r);
    if (rows.length) any = true;
  }
  if (!any) console.log("žádné směny ani účtenky");
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
