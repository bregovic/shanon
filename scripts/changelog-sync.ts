/**
 * Deník vývoje při nasazení: `docs/qa/4-denik-vyvoje.csv` → `qa.changelog` všech tenantů se zapnutým modulem
 * Testování a vývoj (TEST i PROD). Klíč = datum nasazení + nadpis; nové zápisy se založí, změněné aktualizují.
 * Požadavek (CR-…) se propojí, jen když ho tenant má. Zápisy přidané ručně v aplikaci se nemění.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dependencyClosure, type RecordData } from "../src/core/module";
import { ADMIN } from "../src/core/security";
import { registry } from "../src/registry";
import { inTenant, type Ctx } from "../src/server/data";
import { createPrisma } from "../src/server/db";
import { readTable } from "../src/server/import";

export const CHANGELOG_FILE = "docs/qa/4-denik-vyvoje.csv";

export interface ChangelogRow {
  releasedAt: string;
  kind: string;
  area: string;
  title: string;
  issue: string;
  commit: string;
  body: string;
}

export async function readChangelog(file = CHANGELOG_FILE): Promise<ChangelogRow[]> {
  const t = await readTable(file, readFileSync(file));
  const col = (n: string) => t.headers.findIndex((h) => h.trim().toLowerCase() === n);
  const [d, k, a, s, p, c, b] = ["nasazeno", "druh", "oblast", "stručně", "požadavek", "commit", "popis"].map(col);
  return t.rows
    .filter((r) => r[d]?.trim() && r[s]?.trim())
    .map((r) => ({ releasedAt: r[d].trim(), kind: r[k]?.trim() || "feature", area: r[a]?.trim() ?? "", title: r[s].trim(), issue: r[p]?.trim() ?? "", commit: r[c]?.trim() ?? "", body: r[b] ?? "" }));
}

/** Zapíše deník do tenanta (ctx s modulem qa). Vrací počet založených a změněných. */
export async function syncChangelog(ctx: Ctx, rows: ChangelogRow[], client?: Parameters<typeof inTenant>[2]): Promise<{ created: number; updated: number }> {
  return inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const issues = new Map((await api.find("qa.issue", {}, { take: 5000 })).map((i) => [String(i.issueNum), String(i.id)]));
      const have = await api.find("qa.changelog", {}, { take: 10000 });
      const key = (d: unknown, t: unknown) => `${String(d instanceof Date ? d.toISOString() : d).slice(0, 10)}|${t}`;
      const byKey = new Map(have.map((h) => [key(h.releasedAt, h.title), h]));
      let created = 0;
      let updated = 0;
      for (const r of rows) {
        const data: RecordData = { releasedAt: r.releasedAt, kind: r.kind, area: r.area || null, title: r.title, body: r.body || null, commit: r.commit || null, issueId: issues.get(r.issue) ?? null };
        const old = byKey.get(key(r.releasedAt, r.title));
        if (!old) {
          await api.create("qa.changelog", { ...data, published: true });
          created++;
        } else if (["kind", "area", "body", "commit", "issueId"].some((f) => (old[f] ?? null) !== data[f])) {
          await api.update("qa.changelog", String(old.id), data);
          updated++;
        }
      }
      return { created, updated };
    },
    client,
  );
}

async function main() {
  const client = createPrisma();
  const rows = await readChangelog();
  const tenants = await client.sysTenant.findMany({ include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  for (const t of tenants) {
    if (!t.modules.some((m) => m.moduleId === "qa")) continue;
    const modules = dependencyClosure(registry, ["sys", ...t.modules.map((m) => m.moduleId)]);
    const ctx: Ctx = { tenantId: t.id, userId: t.users[0]?.id ?? t.id, companyId: null, role: "admin", perms: ADMIN, modules, extensions: new Set() };
    const r = await syncChangelog(ctx, rows, client);
    if (r.created || r.updated) console.log(`Deník vývoje ${t.code}: nové ${r.created}, změněné ${r.updated}`);
  }
  await client.$disconnect();
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/changelog-sync.ts"))
  main().catch((e) => {
    // deník nesmí zastavit nasazení
    console.error("Deník vývoje:", e instanceof Error ? e.message : e);
    process.exit(0);
  });
