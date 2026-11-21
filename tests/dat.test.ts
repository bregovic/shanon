/**
 * Společná data (DAT): nová firma převezme parametry modulu z DAT; vlastní kurz firmy má přednost před společným.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord } from "@/server/data";
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
});
