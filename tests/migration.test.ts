/**
 * Migrace firmy ze souboru JSON: šablona s pokyny, kontrola, založení firmy z ARES (registr DPH, účty,
 * NACE), moduly s dimenzí Partner, organizace s logem, agendy obecným importem, uživatelé, export
 * a opakované spuštění bez zdvojení. Síť (ARES, registr DPH) je nahrazená.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { listRecords, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { imagesFromUploads } from "@/server/import";
import { companyModules } from "@/server/modules";
import { exportMigration, migrationTemplate, runMigration } from "@/server/migration";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());
afterEach(() => vi.unstubAllGlobals());

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const SUBJECTS: Record<string, { name: string; city: string }> = {
  "11223344": { name: "Prvky s.r.o.", city: "Brandýs nad Labem-Stará Boleslav" },
  "27079864": { name: "Dodavatel termostatů s.r.o.", city: "Davle" },
};

function stubRegistries() {
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("ciselniky-nazevniky"))
      return new Response(JSON.stringify({ ciselniky: [{ polozkyCiselniku: [{ kod: "46900", nazev: [{ kodJazyka: "cs", nazev: "Nespecializovaný velkoobchod" }] }] }] }), { status: 200 });
    if (u.includes("ekonomicke-subjekty-res/")) return new Response(JSON.stringify({ zaznamy: [{ primarniZaznam: true, czNacePrevazujici: "46900", czNace: ["46900"] }] }), { status: 200 });
    const ico = /ekonomicke-subjekty\/(\d{8})/.exec(u)?.[1];
    if (ico && SUBJECTS[ico])
      return new Response(JSON.stringify({ ico, obchodniJmeno: SUBJECTS[ico].name, dic: `CZ${ico}`, pravniForma: "112", sidlo: { kodStatu: "CZ", nazevObce: SUBJECTS[ico].city, nazevUlice: "Hlavní", cisloDomovni: 1, psc: 25001 } }), { status: 200 });
    if (u.includes("rozhraniCRPDPH")) {
      const dics = [...String(init?.body ?? "").matchAll(/<roz:dic>(\d+)<\/roz:dic>/g)].map((m) => m[1]);
      const one = (d: string) =>
        d === "11223344"
          ? `<statusPlatceDPH dic="${d}" nespolehlivyPlatce="NE" cisloFu="057"><zverejneneUcty><ucet datumZverejneni="2017-04-01"><standardniUcet cislo="123456789" kodBanky="0100"/></ucet></zverejneneUcty></statusPlatceDPH>`
          : `<statusPlatceDPH dic="${d}" nespolehlivyPlatce="NE" cisloFu="451"/>`;
      return new Response(`<x><status statusCode="0"/>${dics.map(one).join("")}</x>`, { status: 200 });
    }
    return new Response("", { status: 404 });
  });
}

const FILE = {
  format: "shanon-migrace",
  verze: 1,
  pokyny: ["ignoruje se"],
  firma: { ico: "11223344", organizace: { tradeName: "KO-EL test", email: "info@prvky.test", logo: "obrazky/logo.png", publicSlug: `prvky-${run}` }, obchod: { name: "Prvky shop", active: true, headline: "Termostaty a regulace", accentColor: "#0f6cbd", logo: "obrazky/logo.png" } },
  moduly: ["gl", "tax", "inv", "ap", "bank", "hr", "shop"],
  slozkaObrazku: "obrazky",
  uzivatele: [{ email: `pokladni-${run}@test.local`, jmeno: "Petra", prijmeni: "Pokladní", role: ["POKLADNIK"], spravceFirmy: false, pozvat: false }],
  data: [
    { objekt: "inv.itemGroup", nazev: "x", pole: {}, zaznamy: [{ code: "KE_REG", name: "Regulace a měření", itemTaxGroupId: "Z21", revenueAccountId: "604000", costAccountId: "504000" }] },
    { objekt: "inv.category", zaznamy: [{ code: "KE", name: "KO-EL" }, { code: "KE_REG", name: "Regulace", parentId: "KE", sortOrder: 1 }] },
    {
      objekt: "inv.item",
      zaznamy: [
        { itemNum: "000110", name: "Prostorový termostat RTR-E 6763", groupId: "KE_REG", unitId: "KS", ean: "4017254092237", salesPrice: 992, priceInclTax: true, brand: "Eberle", image: "obrazky/KE11.png", categoryId: "KE_REG" },
        { itemNum: "000111", name: "Prostorový termostat RTR-E 6705", groupId: "KE_REG", unitId: "KS", salesPrice: 860.5, priceInclTax: true, categoryId: "KE_REG", neznamePole: 1 },
      ],
    },
    { objekt: "ap.vendor", zaznamy: [{ regNo: "27079864" }] },
    { objekt: "hr.employee", zaznamy: [{ personalNum: "1001", firstName: "Petra", lastName: "Pokladní", position: "Prodavačka" }] },
  ],
};

describe("migrace firmy", () => {
  it("šablona s pokyny u agend a polí", () => {
    const t = migrationTemplate("cs");
    expect(t.format).toBe("shanon-migrace");
    const item = (t.data as { objekt: string; pole: Record<string, string> }[]).find((d) => d.objekt === "inv.item")!;
    expect(item.pole.itemNum).toMatch(/klíč/);
    expect(item.pole.groupId).toMatch(/povinné.*kód z: Skupiny položek/);
    expect(item.pole.image).toMatch(/složce obrázků/);
    expect(Object.keys(t.dostupneModuly as object)).toContain("inv");
  });

  it("kontrola, založení z ARES, dimenze Partner, logo a obrázky, uživatel; export a opakování bez zdvojení", async () => {
    const T: Ctx = (
      await provisionTenant(client, { code: `t-mig-${run}`, name: "Mig", adminEmail: `mig-${run}@test.local`, adminPassword: "heslo-12345", modules: ["org", "gl", "tax", "inv", "ap", "ar", "bank", "hr", "pos", "int"], company: { code: "A", name: "A" } })
    ).ctx;
    stubRegistries();
    const images = imagesFromUploads([
      { path: "obrazky/logo.png", data: PNG },
      { path: "obrazky/KE11.png", data: PNG },
    ]);
    // kontrola: firma ještě není → jen soubor, neznámé pole jako varování, nic se nezaloží
    const dry = await runMigration(T, FILE, { dryRun: true, lang: "cs", images }, client);
    expect(dry.applied).toBe(false);
    expect(dry.steps[0].messages.join("\n")).toMatch(/neznámé pole „neznamePole“[\s\S]*zatím neexistuje/);
    await expect(runMigration(T, { ...FILE, format: "x" }, { dryRun: true, lang: "cs", images }, client)).rejects.toMatchObject({ label: "@ORG:MigFormat" });

    const rep = await runMigration(T, FILE, { dryRun: false, lang: "cs", images }, client);
    expect(rep.steps.filter((s) => s.status === "error")).toEqual([]);
    const C: Ctx = { ...T, companyId: rep.companyId!, modules: await companyModules(T.tenantId, rep.companyId!, [], client) };
    const org = (await listRecords(C, "org.entity", {}, client)).rows[0];
    expect([org.legalName, org.tradeName, org.vatPayer, org.naceCode, org.bankAccount, !!org.logo]).toEqual(["Prvky s.r.o.", "KO-EL test", true, "46900", "123456789/0100", true]);
    expect((await listRecords(C, "bank.account", {}, client)).rows.map((b) => b.accountNum)).toEqual(["123456789/0100"]);
    const items = (await listRecords(C, "inv.item", { sort: "itemNum" }, client)).rows;
    expect(items.map((i) => [i.itemNum, i.ean, i.salesPrice, !!i.image])).toEqual([
      ["000110", "4017254092237", "992.00", true],
      ["000111", null, "860.50", false],
    ]);
    // dodavatel z ARES s hodnotou dimenze Partner (výchozí nastavení Hlavní knihy ji založilo před importem)
    const [par] = (await listRecords(C, "gl.dimension", { filter: { code: "PAR" } }, client)).rows;
    const [vendor] = (await listRecords(C, "ap.vendor", {}, client)).rows;
    expect(String(vendor[`dim${par.position}`])).toMatch(/^P\d{5}$/);
    expect((await listRecords(C, "hr.employee", {}, client)).rows.map((e) => e.personalNum)).toEqual(["1001"]);
    // e-shop: zveřejněný s nadpisem a logem na adrese zkratky organizace
    const shop = (await listRecords(C, "shop.shop", {}, client)).rows[0];
    expect([shop.name, shop.active, shop.headline, shop.accentColor, !!shop.logo, shop.publicUrl]).toEqual(["Prvky shop", true, "Termostaty a regulace", "#0f6cbd", true, `/prvky-${run}`]);
    expect(rep.steps.find((s) => s.key === "shop")?.messages.join()).toMatch(/zveřejněný/);
    const user = await client.sysUser.findUnique({ where: { email: `pokladni-${run}@test.local` }, include: { companies: true } });
    expect(user?.companies.map((c) => c.companyId)).toEqual([rep.companyId]);
    expect(user?.companies[0].roleIds.length).toBe(1);

    // export z nové firmy → stejný soubor znovu: nic nového
    const exp = await exportMigration(C, "cs", client);
    expect((exp.firma as { ico: string }).ico).toBe("11223344");
    const expItems = (exp.data as { objekt: string; zaznamy: Record<string, unknown>[] }[]).find((d) => d.objekt === "inv.item")!.zaznamy;
    expect(expItems.find((i) => i.itemNum === "000110")).toMatchObject({ name: "Prostorový termostat RTR-E 6763", salesPrice: 992, priceInclTax: true, image: "obrazky/KE11.png" });
    expect((exp.uzivatele as { email: string }[]).map((u) => u.email)).toContain(`pokladni-${run}@test.local`);
    expect((exp.firma as { obchod: Record<string, unknown> }).obchod).toMatchObject({ name: "Prvky shop", active: true, headline: "Termostaty a regulace" });
    expect(String((exp.firma as { obchod: Record<string, unknown> }).obchod.logo)).toMatch(/^obrazky\//);
    const again = await runMigration(T, exp, { dryRun: false, lang: "cs", images }, client);
    expect(again.steps.filter((s) => s.status === "error")).toEqual([]);
    expect(again.steps.reduce((n, s) => n + (s.key !== "users" ? (s.created ?? 0) : 0), 0)).toBe(0);
    expect((await listRecords(C, "inv.item", {}, client)).total).toBe(2);
    expect((await listRecords(C, "ap.vendor", {}, client)).total).toBe(1);
    // kontrola nad existující firmou projde agendy nanečisto
    const dry2 = await runMigration(T, exp, { dryRun: true, lang: "cs", images }, client);
    expect(dry2.steps.map((s) => s.key)).toContain("inv.item");
  }, 60000);
});
