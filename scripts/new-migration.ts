/**
 * Nová migrace bez stínové databáze (funguje i s lokálním PGlite):
 * rozdíl mezi schema.prisma v posledním commitu a aktuálním.
 *   npm run schema:gen && npm run db:new-migration -- nazev_zmeny
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const name = (process.argv[2] ?? "").replace(/[^a-z0-9_]/gi, "_");
if (!name) {
  console.error("Použití: npm run db:new-migration -- nazev_zmeny");
  process.exit(1);
}
const root = join(__dirname, "..");
const old = join(mkdtempSync(join(tmpdir(), "shanon-")), "old.prisma");
writeFileSync(old, execSync("git show HEAD:prisma/schema.prisma", { cwd: root }));
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const dir = join(root, "prisma", "migrations", `${stamp}_${name}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, "migration.sql");
execSync(`npx prisma migrate diff --from-schema "${old}" --to-schema prisma/schema.prisma --script -o "${file}"`, { cwd: root, stdio: "inherit" });
if (!readFileSync(file, "utf8").trim()) console.log("Beze změn — migraci smažte.");
else console.log(`Migrace: ${dir}`);
