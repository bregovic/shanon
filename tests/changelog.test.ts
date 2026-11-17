/** Deník vývoje: výchozí obsah (docs/qa/4-denik-vyvoje.csv) se při nasazení zapíše do tenantů s modulem qa; import tlačítkem. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createPrisma } from "@/server/db";
import { listRecords, saveRecord } from "@/server/data";
import { importRecords, readTable } from "@/server/import";
import { provisionTenant } from "@/server/provision";
import { readChangelog, syncChangelog } from "../scripts/changelog-sync";

const client = createPrisma();
const run = Date.now().toString(36);

describe("deník vývoje", () => {
  it("synchronizace při nasazení: založí, propojí požadavek, podruhé nic nemění, ruční zápis zůstane", async () => {
    const T = (await provisionTenant(client, { code: `t-cl-${run}`, name: "Cl", adminEmail: `cl-${run}@test.local`, adminPassword: "heslo-12345", modules: ["qa"], company: { code: "C", name: "C" } })).ctx;
    await saveRecord(T, "qa.issue", null, { issueNum: "CR-086", type: "change", title: "Spisová značka" }, undefined, client);
    const own = await saveRecord(T, "qa.changelog", null, { title: "Interní úprava", kind: "fix", published: false }, undefined, client);
    const rows = await readChangelog();
    expect(rows.length).toBeGreaterThan(40);
    expect(await syncChangelog(T, rows, client)).toEqual({ created: rows.length, updated: 0 });
    expect(await syncChangelog(T, rows, client)).toEqual({ created: 0, updated: 0 });
    const list = (await listRecords(T, "qa.changelog", { pageSize: 500, sort: "releasedAt", dir: "desc" }, client)).rows;
    expect(list.length).toBe(rows.length + 1);
    const sz = list.find((x) => x.title === "Spisová značka a zápis v rejstříku na dokladech")!;
    expect([String(sz.releasedAt).slice(0, 10), sz.kind, sz.published, String(((sz._titles ?? {}) as Record<string, string>).issueId).startsWith("CR-086")]).toEqual(["2026-11-17", "feature", true, true]);
    // souhrn úprav deníku HK = jeden zápis
    expect(list.filter((x) => String(x.releasedAt).startsWith("2026-11-15") && x.area === "Hlavní kniha").length).toBe(1);
    expect([own.published, String(own.releasedAt).slice(0, 10)]).toEqual([false, new Date().toISOString().slice(0, 10)]);
    expect(list.some((x) => x.id === own.id)).toBe(true);
  }, 180_000);

  it("import tlačítkem: sloupce souboru odpovídají polím", async () => {
    const T = (await provisionTenant(client, { code: `t-cl2-${run}`, name: "Cl2", adminEmail: `cl2-${run}@test.local`, adminPassword: "heslo-12345", modules: ["qa"], company: { code: "C", name: "C" } })).ctx;
    const file = "docs/qa/4-denik-vyvoje.csv";
    const r = await importRecords(T, "qa.changelog", await readTable(file, readFileSync(file)), { dryRun: true, lang: "cs" }, client);
    expect(r.columns.filter((c) => c.status !== "mapped").map((c) => c.header)).toEqual([]);
  }, 120_000);
});
