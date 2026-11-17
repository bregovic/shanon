/** Deník vývoje: import výchozího CSV (docs/qa/4-denik-vyvoje.csv) s odkazy na požadavky, řazení podle data nasazení. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createPrisma } from "@/server/db";
import { listRecords, saveRecord } from "@/server/data";
import { importRecords, readTable } from "@/server/import";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("deník vývoje", () => {
  it("import výchozího deníku a záznam bez zobrazení v Aktualitách", async () => {
    const T = (await provisionTenant(client, { code: `t-cl-${run}`, name: "Cl", adminEmail: `cl-${run}@test.local`, adminPassword: "heslo-12345", modules: ["qa"], company: { code: "C", name: "C" } })).ctx;
    for (const n of [74, 75, 78, 79, 80, 81, 82, 83, 84, 85, 86]) await saveRecord(T, "qa.issue", null, { issueNum: `CR-0${n}`, type: "change", title: `Požadavek ${n}` }, undefined, client);
    const file = "docs/qa/4-denik-vyvoje.csv";
    const r = await importRecords(T, "qa.changelog", await readTable(file, readFileSync(file)), { dryRun: false, lang: "cs" }, client);
    expect([r.errors, r.applied, r.created]).toEqual([[], true, 11]);
    expect(r.columns.filter((c) => c.status !== "mapped").map((c) => c.header)).toEqual([]);
    const rows = (await listRecords(T, "qa.changelog", { pageSize: 50, sort: "releasedAt", dir: "desc" }, client)).rows;
    const sz = rows.find((x) => x.title === "Spisová značka a zápis v rejstříku na dokladech")!;
    expect([String(sz.releasedAt).slice(0, 10), sz.kind, sz.published, String(((sz._titles ?? {}) as Record<string, string>).issueId).startsWith("CR-086")]).toEqual(["2026-11-17", "feature", true, true]);
    expect(String(sz.body)).toContain("Rejstříkový soud");
    const internal = await saveRecord(T, "qa.changelog", null, { title: "Interní úprava", kind: "fix", published: false }, undefined, client);
    expect([internal.published, String(internal.releasedAt).slice(0, 10)]).toEqual([false, new Date().toISOString().slice(0, 10)]);
  }, 120_000);
});
