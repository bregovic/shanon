/**
 * Ostrý provoz na testovacím serveru: ostrá napojení (EET produkce, schránka, pošta, platby) se tam nepoužijí bez
 * ručního povolení; migrace zakládá testovací protějšek, na produkci testovací napojení vynechá; export pro ostrý
 * provoz je bez testovacích napojení a ostrá zapne.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { imagesFromUploads } from "@/server/import";
import { companyModules } from "@/server/modules";
import { exportMigration, runMigration } from "@/server/migration";
import { connectionsFor } from "@/modules/int/drivers";
import { isLiveConnection, liveBlocked } from "@/modules/int/live-guard";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubRegistries(ico: string) {
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("ciselniky-nazevniky") || u.includes("ekonomicke-subjekty-res/")) return new Response("{}", { status: 404 });
    if (u.includes(`ekonomicke-subjekty/${ico}`))
      return new Response(JSON.stringify({ ico, obchodniJmeno: "Ordinace s.r.o.", dic: `CZ${ico}`, pravniForma: "112", sidlo: { kodStatu: "CZ", nazevObce: "Praha", nazevUlice: "Hlavní", cisloDomovni: 1, psc: 11000 } }), { status: 200 });
    if (u.includes("rozhraniCRPDPH")) {
      const dics = [...String(init?.body ?? "").matchAll(/<roz:dic>(\d+)<\/roz:dic>/g)].map((m) => m[1]);
      return new Response(`<x><status statusCode="0"/>${dics.map((d) => `<statusPlatceDPH dic="${d}" nespolehlivyPlatce="NE" cisloFu="451"/>`).join("")}</x>`, { status: 200 });
    }
    return new Response("", { status: 404 });
  });
}

const EET_LIVE = { code: "EET", name: "EET ostré", kind: "eet", driver: "eet2", environment: "production", unitId: "11", posId: "KASA1", active: true };
const file = (ico: string) => ({
  format: "shanon-migrace",
  verze: 1,
  firma: { ico },
  moduly: ["tax", "pos", "int"],
  data: [
    {
      objekt: "int.connection",
      zaznamy: [
        EET_LIVE,
        { code: "TEST-EET", name: "EET Playground", kind: "eet", driver: "eet2", environment: "playground", unitId: "1", posId: "TEST", active: true },
        { code: "ARES", name: "ARES", kind: "service", driver: "ares", active: true },
      ],
    },
  ],
});

describe("ostrý provoz na testovacím serveru", () => {
  it("rozpozná ostrá napojení", () => {
    expect(isLiveConnection(EET_LIVE)).toBe(true);
    expect(isLiveConnection({ ...EET_LIVE, environment: "playground" })).toBe(false);
    expect(isLiveConnection({ ...EET_LIVE, code: "TEST-EET" })).toBe(false);
    expect(isLiveConnection({ kind: "isds", driver: "isdsTest" })).toBe(false);
    expect(isLiveConnection({ kind: "mail", driver: "system" })).toBe(true);
    expect(isLiveConnection({ kind: "payment", driver: "comgate", testMode: true })).toBe(false);
    expect(isLiveConnection({ kind: "printer", driver: "browser" })).toBe(false);
    vi.stubEnv("SHANON_SERVER_MODE", "test");
    expect(liveBlocked(EET_LIVE)).toBe(true);
    expect(liveBlocked({ ...EET_LIVE, liveOnTest: true })).toBe(false);
    vi.stubEnv("SHANON_SERVER_MODE", "production");
    expect(liveBlocked(EET_LIVE)).toBe(false);
  });

  it("migrace na testovacím serveru: ostré EET se nepoužije, založí se TEST-EET; povolení ho pustí; export pro ostrý provoz", async () => {
    vi.stubEnv("SHANON_SERVER_MODE", "test");
    const ico = "55667788";
    const T: Ctx = (await provisionTenant(client, { code: `t-live-${run}`, name: "Live", adminEmail: `live-${run}@test.local`, adminPassword: "heslo-12345", modules: ["org", "tax", "pos", "int"], company: { code: "A", name: "A" } })).ctx;
    stubRegistries(ico);
    const images = imagesFromUploads([]);
    const rep = await runMigration(T, file(ico), { dryRun: false, lang: "cs", images }, client);
    expect(rep.steps.filter((s) => s.status === "error")).toEqual([]);
    const conn = rep.steps.find((s) => s.key === "int.connection")!;
    expect(conn.messages.join("\n")).toMatch(/certifikát EET[\s\S]*Testovací server: ostrá napojení EET/);
    const C: Ctx = { ...T, companyId: rep.companyId!, modules: await companyModules(T.tenantId, rep.companyId!, [], client) };
    const codes = (await listRecords(C, "int.connection", { filter: { kind: "eet" } }, client)).rows.map((c) => c.code).sort();
    expect(codes).toEqual(["EET", "TEST-EET"]);
    // TEST-EET ze souboru dostal veřejný testovací certifikát Playgroundu
    const [pg] = (await listRecords(C, "int.connection", { filter: { code: "TEST-EET" } }, client)).rows;
    expect(pg.certSubject).toBeTruthy();
    // pokladna dostane testovací EET, ostré až po ručním povolení
    const eetOf = () => inTenant(C, async (s) => (await connectionsFor(s.sys().api(), "")).eet?.code, client);
    expect(await eetOf()).toBe("TEST-EET");
    const [testEet] = (await listRecords(C, "int.connection", { filter: { code: "TEST-EET" } }, client)).rows;
    await saveRecord(C, "int.connection", String(testEet.id), { active: false }, testEet.version as number, client);
    expect(await eetOf()).toBeUndefined();
    const [live] = (await listRecords(C, "int.connection", { filter: { code: "EET" } }, client)).rows;
    await saveRecord(C, "int.connection", String(live.id), { liveOnTest: true }, live.version as number, client);
    expect(await eetOf()).toBe("EET");

    // export pro ostrý provoz: bez TEST-…, bez veřejných služeb, ostré zapnuté a bez povolení pro test
    const exp = await exportMigration(C, "cs", client, { production: true });
    const rows = (exp.data as { objekt: string; zaznamy: Record<string, unknown>[] }[]).find((d) => d.objekt === "int.connection")!.zaznamy;
    expect(rows.map((r) => r.code)).not.toContain("TEST-EET");
    expect(rows.some((r) => r.kind === "service")).toBe(false);
    expect(rows.find((r) => r.code === "EET")).toMatchObject({ environment: "production", unitId: "11", posId: "KASA1", active: true });
    expect(rows.find((r) => r.code === "EET")).not.toHaveProperty("liveOnTest");
    expect(rows.find((r) => r.code === "EET")).not.toHaveProperty("certPassword");
    expect(exp.provoz).toBe("ostry");
    const expTest = await exportMigration(C, "cs", client);
    expect((expTest.data as { objekt: string; zaznamy: Record<string, unknown>[] }[]).find((d) => d.objekt === "int.connection")!.zaznamy.map((r) => r.code)).toContain("TEST-EET");
  }, 60000);

  it("migrace na produkci: testovací napojení se nezaloží", async () => {
    vi.stubEnv("SHANON_SERVER_MODE", "production");
    const ico = "55667799";
    const T: Ctx = (await provisionTenant(client, { code: `t-live2-${run}`, name: "Live2", adminEmail: `live2-${run}@test.local`, adminPassword: "heslo-12345", modules: ["org", "tax", "pos", "int"], company: { code: "A", name: "A" } })).ctx;
    stubRegistries(ico);
    const rep = await runMigration(T, file(ico), { dryRun: false, lang: "cs", images: imagesFromUploads([]) }, client);
    expect(rep.steps.filter((s) => s.status === "error")).toEqual([]);
    expect(rep.steps.find((s) => s.key === "int.connection")!.messages.join("\n")).toMatch(/Vynecháno napojení: 2/);
    const C: Ctx = { ...T, companyId: rep.companyId!, modules: await companyModules(T.tenantId, rep.companyId!, [], client) };
    expect((await listRecords(C, "int.connection", { filter: { kind: "eet" } }, client)).rows.map((c) => c.code)).toEqual(["EET"]);
    expect(await inTenant(C, async (s) => (await connectionsFor(s.sys().api(), "")).eet?.code, client)).toBe("EET");
  }, 60000);
});
