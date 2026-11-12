/**
 * Definice objektů → prisma/schema.prisma.
 * Spuštění: npm run schema:gen   (kontrola v CI: npm run schema:check)
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FieldDef, ObjectDef } from "../src/core/object";
import { columnName, delegateName, modelName } from "../src/core/object";
import { registry } from "../src/registry";

const ROOT = join(__dirname, "..");
const COMPANY = "sys.company";

const pad = (s: string, n: number) => (s.length >= n ? s + " " : s.padEnd(n));

function scalar(name: string, f: FieldDef): string {
  const e = f.edt;
  const opt = f.mandatory ? "" : "?";
  const attrs: string[] = [];
  let type: string;
  switch (e.kind) {
    case "string":
      type = "String";
      attrs.push(`@db.VarChar(${e.maxLength ?? 255})`);
      break;
    case "text":
      type = "String";
      break;
    case "int":
      type = "Int";
      break;
    case "decimal":
      type = "Decimal";
      attrs.push(`@db.Decimal(${e.precision ?? 18}, ${e.scale ?? 2})`);
      break;
    case "bool":
      type = "Boolean";
      break;
    case "date":
      type = "DateTime";
      attrs.push("@db.Date");
      break;
    case "datetime":
      type = "DateTime";
      break;
    case "enum":
      // hodnoty výčtu hlídá aplikace — rozšíření je mohou přidávat bez migrace
      type = "String";
      attrs.push("@db.VarChar(40)");
      break;
    case "ref":
      type = "String";
      attrs.push("@db.Uuid");
      break;
  }
  const isBool = e.kind === "bool";
  const def = f.default ?? (isBool ? false : undefined);
  if (def !== undefined) {
    if (typeof def === "string" && e.kind !== "decimal") attrs.unshift(`@default("${def}")`);
    else attrs.unshift(`@default(${def})`);
  }
  const col = columnName(name);
  if (col !== name) attrs.push(`@map("${col}")`);
  return `  ${pad(name, 14)}${pad(type + (isBool ? "" : opt), 10)}${attrs.join(" ")}`.trimEnd();
}

interface BackRel {
  target: string;
  line: string;
}

function model(o: ObjectDef, back: BackRel[]): string {
  const m = modelName(o.table);
  const lines: string[] = [];
  const company = o.scope === "company";
  lines.push(`/// ${o.id} — generováno z definice objektu`);
  lines.push(`model ${m} {`);
  lines.push(`  id            String   @id @default(uuid(7)) @db.Uuid`);
  lines.push(`  tenantId      String   @map("tenant_id") @db.Uuid`);
  if (company) lines.push(`  companyId     String   @map("company_id") @db.Uuid`);
  for (const [name, f] of Object.entries(o.fields)) lines.push(scalar(name, f));
  lines.push(`  ext           Json     @default("{}")`);
  lines.push(`  version       Int      @default(1)`);
  lines.push(`  createdAt     DateTime @default(now()) @map("created_at")`);
  lines.push(`  createdBy     String?  @map("created_by") @db.Uuid`);
  lines.push(`  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at")`);
  lines.push(`  updatedBy     String?  @map("updated_by") @db.Uuid`);
  lines.push("");

  const refs: [string, string, boolean][] = []; // [field, targetObject, mandatory]
  if (company) refs.push(["companyId", COMPANY, true]);
  for (const [name, f] of Object.entries(o.fields)) {
    if (f.edt.kind === "ref") refs.push([name, f.edt.refObject!, !!f.mandatory]);
  }
  for (const [field, targetId, mandatory] of refs) {
    const target = registry.objects.get(targetId)!;
    const tm = modelName(target.table);
    const rel = field.replace(/Id$/, "");
    const relName = `${m}_${rel}`;
    lines.push(
      `  ${pad(rel, 14)}${pad(tm + (mandatory ? "" : "?"), 10)}@relation("${relName}", fields: [${field}], references: [id], onDelete: Restrict)`,
    );
    back.push({ target: targetId, line: `  ${pad(`${delegateName(o.table)}_${rel}`, 30)}${m}[] @relation("${relName}")` });
  }
  lines.push("__BACK__");
  lines.push("");
  const scopeCols = company ? ["tenantId", "companyId"] : ["tenantId"];
  lines.push(`  @@index([${scopeCols.join(", ")}])`);
  for (const [field] of refs) if (field !== "companyId") lines.push(`  @@index([${field}])`);
  for (const u of o.unique ?? []) lines.push(`  @@unique([${[...scopeCols, ...u].join(", ")}])`);
  lines.push(`  @@map("${o.table}")`);
  lines.push("}");
  return lines.join("\n");
}

export function generate(): string {
  const back: BackRel[] = [];
  const objs = [...registry.objects.values()];
  const models = objs.map((o) => ({ o, text: model(o, back) }));
  const out = models.map(({ o, text }) => {
    const mine = back.filter((b) => b.target === o.id).map((b) => b.line);
    return text.replace("__BACK__\n", mine.length ? mine.join("\n") + "\n" : "");
  });
  const base = readFileSync(join(ROOT, "prisma/base.prisma"), "utf8");
  return [
    "// !!! GENEROVÁNO — neupravovat. Zdroj: prisma/base.prisma + src/modules (npm run schema:gen)",
    "",
    base.trimEnd(),
    "",
    "// ===========================================================================",
    "// Objekty modulů",
    "// ===========================================================================",
    "",
    out.join("\n\n"),
    "",
  ].join("\n");
}

const target = join(ROOT, "prisma/schema.prisma");

/** zapíše a naformátuje (prisma format), vrátí výsledný text */
function writeFormatted(path: string, text: string): string {
  writeFileSync(path, text);
  execSync(`npx prisma format --schema "${path}"`, { cwd: ROOT, stdio: "ignore" });
  return readFileSync(path, "utf8");
}

if (process.argv.includes("--check")) {
  const tmp = join(mkdtempSync(join(tmpdir(), "shanon-")), "schema.prisma");
  const expected = writeFormatted(tmp, generate());
  const current = readFileSync(target, "utf8");
  if (current !== expected) {
    console.error("prisma/schema.prisma neodpovídá definicím objektů — spusťte npm run schema:gen");
    process.exit(1);
  }
  console.log("schema.prisma je aktuální");
} else {
  writeFormatted(target, generate());
  console.log(`schema.prisma: ${registry.objects.size} objektů`);
}
