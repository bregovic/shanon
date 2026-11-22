/**
 * Společná data (DAT): nová firma převezme parametry modulu z DAT; vlastní kurz firmy má přednost před společným.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { ensureDat } from "@/server/dat";
import { enableModulesWithSetup } from "@/server/company-modules";
import { rateFor } from "@/modules/sys/currency";

const client = createPrisma();
const run = Date.now().toString(36);

describe("Společná data (DAT)", () => {
  it("parametry z DAT do nové firmy, kurz firmy s předností", async () => {
    const P = (await provisionTenant(client, { code: `t-dat-${run}`, name: "DAT", adminEmail: `dat-${run}@test.local`, adminPassword: "heslo-12345", modules: ["gl"], company: { code: "A", name: "A s.r.o." } })).ctx;
    const datId = await ensureDat(P.tenantId, client);
    expect(await ensureDat(P.tenantId, client)).toBe(datId); // jedna na tenanta

    // výchozí konfigurace v DAT: parametry účetnictví s jiným stářím kurzu
    const D = { ...P, companyId: datId };
    const czk = (await listRecords(P, "sys.currency", { filter: { code: "CZK" } }, client)).rows[0];
    await saveRecord(D, "gl.parameters", null, { accountingCurrencyId: czk.id, rateSource: "cnb", rateMaxAgeDays: 14 }, undefined, client);

    // nová firma: zapnutí účetnictví převezme parametry z DAT
    const b = await inTenant(P, (s) => s.save("sys.company", null, { code: "B", name: "B s.r.o." }), client);
    const B = { ...P, companyId: String(b.id) };
    await enableModulesWithSetup(B, String(b.id), ["gl"], "cs", client);
    const [bp] = (await listRecords(B, "gl.parameters", {}, client)).rows;
    expect(Number(bp.rateMaxAgeDays)).toBe(14);
    // firma A (založená dřív) má svoje
    const [ap] = (await listRecords(P, "gl.parameters", {}, client)).rows;
    expect(Number(ap.rateMaxAgeDays)).toBe(7);

    // kurz: společný 25,00, vlastní kurz firmy A 24,50
    const eur = (await listRecords(P, "sys.currency", { filter: { code: "EUR" } }, client)).rows[0] ?? (await saveRecord(P, "sys.currency", null, { code: "EUR", name: "Euro" }, undefined, client));
    await saveRecord(P, "sys.exchangeRate", null, { currencyId: eur.id, date: "2026-11-20", amount: 1, rate: "25.00", base: "CZK", source: "manual" }, undefined, client);
    await saveRecord(P, "sys.exchangeRate", null, { currencyId: eur.id, date: "2026-11-20", amount: 1, rate: "24.50", base: "CZK", source: "manual", forCompanyId: P.companyId }, undefined, client);
    const rateIn = (ctx: typeof P) => inTenant(ctx, (s) => rateFor(s.sys().api(), String(eur.id), "2026-11-20"), client);
    expect(Number((await rateIn(P)).rate)).toBe(24.5);
    expect(Number((await rateIn(B)).rate)).toBe(25);
  }, 180_000);

  it("číselníky z DAT: doplnění, propsání, přednost upravené kopie a vlastního kódu, nová firma", async () => {
    const P = (await provisionTenant(client, { code: `t-datl-${run}`, name: "DATL", adminEmail: `datl-${run}@test.local`, adminPassword: "heslo-12345", modules: ["inv"], company: { code: "A", name: "A s.r.o." } })).ctx;
    const D = { ...P, companyId: await ensureDat(P.tenantId, client) };
    const unit = async (ctx: typeof P, code: string) => (await listRecords(ctx, "inv.unit", { filter: { code } }, client)).rows[0];

    // nový záznam v DAT → firma A ho dostane jako kopii
    const bal = await saveRecord(D, "inv.unit", null, { code: "KRT", name: "Balení" }, undefined, client);
    const a1 = await unit(P, "KRT");
    expect([a1?.name, a1?.datSourceId, a1?.datLocal]).toEqual(["Balení", String(bal.id), false]);
    // změna v DAT → neupravená kopie se přepíše
    const bal2 = await saveRecord(D, "inv.unit", String(bal.id), { ...bal, name: "Balíček" }, bal.version as number, client);
    expect((await unit(P, "KRT")).name).toBe("Balíček");
    // úprava ve firmě → vlastní záznam, další změna v DAT ho nepřepíše
    const a2 = await unit(P, "KRT");
    await saveRecord(P, "inv.unit", String(a2.id), { ...a2, name: "Bal. A" }, a2.version as number, client);
    expect((await unit(P, "KRT")).datLocal).toBe(true);
    await saveRecord(D, "inv.unit", String(bal.id), { ...bal2, name: "Balík" }, bal2.version as number, client);
    expect((await unit(P, "KRT")).name).toBe("Bal. A");
    // vlastní kód firmy má přednost (KS z výchozího nastavení firmy se nepřepíše)
    const ksBefore = await unit(P, "KS");
    await saveRecord(D, "inv.unit", null, { code: "KS", name: "Kus DAT" }, undefined, client);
    expect((await unit(P, "KS")).name).toBe(ksBefore.name);

    // nová firma se skladem: převezme číselník z DAT (aktuální stav)
    const b = await inTenant(P, (s) => s.save("sys.company", null, { code: "B", name: "B s.r.o." }), client);
    const B = { ...P, companyId: String(b.id) };
    await enableModulesWithSetup(B, String(b.id), ["inv"], "cs", client);
    expect((await unit(B, "KRT")).name).toBe("Balík");
    expect((await unit(B, "KS")).name).toBe("Kus DAT");
  }, 180_000);

  it("Naplnit DAT z firmy: parametry a číselníky do DAT, firma napojená na kopie", async () => {
    const P = (await provisionTenant(client, { code: `t-datn-${run}`, name: "DATN", adminEmail: `datn-${run}@test.local`, adminPassword: "heslo-12345", modules: ["inv", "gl"], company: { code: "A", name: "A s.r.o." } })).ctx;
    await runAction(P, "sys.company", String(P.companyId), "fillDat", client);
    const D = { ...P, companyId: await ensureDat(P.tenantId, client) };
    const datUnits = (await listRecords(D, "inv.unit", { pageSize: 200 }, client)).rows;
    const ownUnits = (await listRecords(P, "inv.unit", { pageSize: 200 }, client)).rows;
    expect(datUnits.length).toBe(ownUnits.length);
    expect(ownUnits.every((u) => u.datSourceId && !u.datLocal)).toBe(true);
    expect((await listRecords(D, "gl.parameters", {}, client)).rows.length).toBe(1);
    // změna v DAT se teď propíše i do zdrojové firmy
    const ks = datUnits.find((u) => u.code === "KS")!;
    await saveRecord(D, "inv.unit", String(ks.id), { ...ks, name: "Kus (DAT)" }, ks.version as number, client);
    expect((await listRecords(P, "inv.unit", { filter: { code: "KS" } }, client)).rows[0].name).toBe("Kus (DAT)");
    // podruhé nic nového
    await runAction(P, "sys.company", String(P.companyId), "fillDat", client);
    expect((await listRecords(D, "inv.unit", { pageSize: 200 }, client)).rows.length).toBe(datUnits.length);
  }, 180_000);

  it("formát výpisu z DAT se zkopíruje i s poli", async () => {
    const P = (await provisionTenant(client, { code: `t-datf-${run}`, name: "DATF", adminEmail: `datf-${run}@test.local`, adminPassword: "heslo-12345", modules: ["bank"], company: { code: "A", name: "A s.r.o." } })).ctx;
    const D = { ...P, companyId: await ensureDat(P.tenantId, client) };
    const tr = (await listRecords(P, "sys.transformation", {}, client)).rows.find((x) => String(x.code).toUpperCase().includes("CSV")) ?? (await listRecords(P, "sys.transformation", {}, client)).rows[0];
    const fmt = await saveRecord(D, "bank.statementFormat", null, { code: "TST", name: "Testovací banka", transformationId: tr.id }, undefined, client);
    await saveRecord(D, "bank.statementFormatField", null, { formatId: fmt.id, section: "line", target: "amount", source: "Částka" }, undefined, client);
    const [copy] = (await listRecords(P, "bank.statementFormat", { filter: { code: "TST" } }, client)).rows;
    expect(copy?.datSourceId).toBe(String(fmt.id));
    const fields = (await listRecords(P, "bank.statementFormatField", { filter: { formatId: String(copy.id) } }, client)).rows;
    expect(fields.map((f) => f.source)).toEqual(["Částka"]);
  }, 180_000);
});
