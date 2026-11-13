/**
 * Údržba: import souboru (CSV, XML, Excel) do objektu — stejná logika jako
 * tlačítko Import (validace, události, vše nebo nic). Data do repa nepatří.
 *
 *   npx tsx --conditions=react-server scripts/import-file.ts <tenant> <kód firmy> <objekt> <soubor> [--check] [--images=<složka>]
 *   npx tsx --conditions=react-server scripts/import-file.ts <tenant> <kód firmy> --ares     (sídla subjektů s IČO z ARES)
 */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { dependencyClosure } from "../src/core/module";
import { ADMIN } from "../src/core/security";
import { registry } from "../src/registry";
import { inTenant, type Ctx } from "../src/server/data";
import { createPrisma, withTenant } from "../src/server/db";
import { importRecords, readTable } from "../src/server/import";
import { fillFromAres } from "../src/modules/gab/ares";

async function main() {
  const [tenantCode, companyCode, objectId, file] = process.argv.slice(2);
  const client = createPrisma();
  const t = await client.sysTenant.findUniqueOrThrow({ where: { code: tenantCode }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  const c = await withTenant(t.id, (tx) => tx.sysCompany.findFirstOrThrow({ where: { tenantId: t.id, code: companyCode } }), client);
  const modules = dependencyClosure(registry, ["sys", ...t.modules.map((m) => m.moduleId)]);
  const ctx: Ctx = { tenantId: t.id, userId: t.users[0].id, companyId: c.id, role: "admin", perms: ADMIN, modules, extensions: new Set(), lang: "cs" };

  if (objectId === "--ares") {
    for (const s of (await inTenant(ctx, (x) => x.find("gab.subject", {}, 5000), client)).filter((x) => x.regNo)) {
      try {
        const a = await inTenant(ctx, (x) => fillFromAres(x.sys().api(), String(s.id)), client);
        console.log(`ARES ${a.ico} ${a.name} | ${a.street ?? ""}, ${a.zipCode ?? ""} ${a.city ?? ""}`);
      } catch (e) {
        console.log(`ARES ${s.name}: ${(e as Error).message}`);
      }
    }
  } else {
    const imgDir = process.argv.find((a) => a.startsWith("--images="))?.slice(9) ?? dirname(file);
    const images = (p: string) => {
      const full = isAbsolute(p) ? p : join(imgDir, p);
      return existsSync(full) ? { name: basename(full), data: readFileSync(full) } : null;
    };
    const r = await importRecords(ctx, objectId, await readTable(basename(file), readFileSync(file)), { dryRun: process.argv.includes("--check"), lang: "cs", images }, client);
    console.log(`${basename(file)} → ${objectId}: nových ${r.created}, upravených ${r.updated}, ${r.applied ? "uloženo" : "NEULOŽENO"}`);
    const ignored = r.columns.filter((x) => x.status !== "mapped").map((x) => x.header);
    if (ignored.length) console.log(`  nepoužité sloupce: ${ignored.join(", ")}`);
    if (r.missing.length) console.log(`  chybí sloupce: ${r.missing.join(", ")}`);
    for (const e of r.errors) console.log(`  ř. ${e.row} ${e.column ?? ""}: ${e.message}`);
  }
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
