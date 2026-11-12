/**
 * Nová migrace bez stínové databáze (funguje i s lokálním PGlite):
 * rozdíl mezi snímkem schématu po poslední migraci
 * (prisma/migrations/schema.snapshot.prisma) a aktuálním schema.prisma.
 * Po vytvoření migrace se snímek aktualizuje — commitovat spolu s migrací.
 *   npm run schema:gen && npm run db:new-migration -- nazev_zmeny
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const name = (process.argv[2] ?? "").replace(/[^a-z0-9_]/gi, "_");
if (!name) {
  console.error("Použití: npm run db:new-migration -- nazev_zmeny");
  process.exit(1);
}
const root = join(__dirname, "..");
const snapshot = join(root, "prisma", "migrations", "schema.snapshot.prisma");
let old = snapshot;
if (!existsSync(snapshot)) {
  // bez snímku: porovnat s posledním commitem
  old = join(mkdtempSync(join(tmpdir(), "shanon-")), "old.prisma");
  writeFileSync(old, execSync("git show HEAD:prisma/schema.prisma", { cwd: root }));
}
// razítko vždy za poslední migrací (pořadí migrací = pořadí názvů)
const last = readdirSync(join(root, "prisma", "migrations")).filter((d) => /^\d{14}_/.test(d)).sort().pop()?.slice(0, 14) ?? "0";
const now = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const stamp = now > last ? now : String(BigInt(last) + BigInt(1));
const dir = join(root, "prisma", "migrations", `${stamp}_${name}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, "migration.sql");
execSync(`npx prisma migrate diff --from-schema "${old}" --to-schema prisma/schema.prisma --script -o "${file}"`, { cwd: root, stdio: "inherit" });
if (!readFileSync(file, "utf8").trim()) console.log("Beze změn — migraci smažte.");
else {
  copyFileSync(join(root, "prisma", "schema.prisma"), snapshot);
  console.log(`Migrace: ${dir}`);
}
