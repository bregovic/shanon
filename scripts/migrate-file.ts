/**
 * Údržba: migrace firmy ze souboru JSON (stejná logika jako Organizace → Migrace firmy). Data do repa nepatří.
 *
 *   npx tsx --conditions=react-server scripts/migrate-file.ts <tenant> <kód firmy, ze které se spouští> <soubor.json> [--check] [--images=<složka>]
 *   npx tsx --conditions=react-server scripts/migrate-file.ts <tenant> <kód firmy> --export=<soubor.json>     (konfigurace firmy do souboru)
 *
 * Obrázky se hledají ve složce `--images` (výchozí = složka souboru) podle cesty v souboru (obrazky/KE1.jpg).
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ADMIN } from "../src/core/security";
import type { Ctx } from "../src/server/data";
import { createPrisma, withTenant } from "../src/server/db";
import { companyModules } from "../src/server/modules";
import { exportMigration, runMigration } from "../src/server/migration";

async function main() {
  const [tenantCode, companyCode, file] = process.argv.slice(2);
  const client = createPrisma();
  const t = await client.sysTenant.findUniqueOrThrow({ where: { code: tenantCode }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  const c = await withTenant(t.id, (tx) => tx.sysCompany.findFirstOrThrow({ where: { tenantId: t.id, code: companyCode } }), client);
  const modules = await companyModules(t.id, c.id, t.modules.map((m) => m.moduleId), client);
  const ctx: Ctx = { tenantId: t.id, userId: t.users[0].id, companyId: c.id, role: "admin", perms: ADMIN, modules, extensions: new Set(), lang: "cs" };

  const out = process.argv.find((a) => a.startsWith("--export="))?.slice(9);
  if (out) {
    writeFileSync(out, JSON.stringify(await exportMigration(ctx, "cs", client), null, 2));
    console.log(`konfigurace firmy ${companyCode} → ${out}`);
  } else {
    const dir = process.argv.find((a) => a.startsWith("--images="))?.slice(9) ?? dirname(file);
    const images = (p: string) => {
      const full = [join(dir, p), join(dir, basename(p))].find((x) => existsSync(x));
      return full ? { name: basename(full), data: readFileSync(full) } : null;
    };
    const r = await runMigration(ctx, JSON.parse(readFileSync(file, "utf8")), { dryRun: process.argv.includes("--check"), lang: "cs", images }, client);
    for (const s of r.steps) {
      const n = s.created !== undefined || s.updated !== undefined ? ` (nových ${s.created ?? 0}, upravených ${s.updated ?? 0})` : "";
      console.log(`${s.status === "ok" ? "OK " : s.status === "warning" ? " ! " : " × "} ${s.label}${n}`);
      for (const m of s.messages.slice(0, 30)) console.log(`     ${m}`);
    }
    console.log(r.applied ? `firma ${r.companyId}` : "nic se neuložilo (kontrola)");
  }
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
