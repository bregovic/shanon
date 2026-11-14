/** Registr plátců DPH: spolehlivost, zveřejněné účty do tabulky účtů subjektu, výchozí účet dodavatele. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

const reply = (flag: string, accounts: string) =>
  `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><StatusNespolehlivyPlatceRozsirenyResponse xmlns="http://adis.mfcr.cz/rozhraniCRPDPH/"><status odpovedGenerovana="2026-11-14" statusCode="0" statusText="OK"/><statusPlatceDPH dic="12345678" nespolehlivyPlatce="${flag}" cisloFu="13"><zverejneneUcty>${accounts}</zverejneneUcty></statusPlatceDPH></StatusNespolehlivyPlatceRozsirenyResponse></soapenv:Body></soapenv:Envelope>`;
const std = '<ucet datumZverejneni="2013-04-01"><standardniUcet predcisli="19" cislo="2808601" kodBanky="0100"/></ucet>';
const iban = '<ucet datumZverejneni="2014-02-14"><nestandardniUcet cislo="CZ4701000000271445680277"/></ucet>';

describe("registr plátců DPH", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ověření: spolehlivost, zveřejněné účty, zrušený účet přestane být zveřejněný; výchozí účet dodavatele", async () => {
    const T = (await provisionTenant(client, { code: `t-dph-${run}`, name: "DPH", adminEmail: `dph-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "int"], company: { code: "D", name: "D" } })).ctx;
    const calls: string[] = [];
    let body = reply("NE", std + iban);
    vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => {
      calls.push(String(init?.body ?? ""));
      return new Response(body, { status: 200 });
    });
    const subj = await saveRecord(T, "gab.subject", null, { name: "Masna", vatId: "CZ12345678" }, undefined, client);
    // ruční účet zůstane
    await saveRecord(T, "gab.bankAccount", null, { subjectId: subj.id, accountNum: "123456789/0300" }, undefined, client);
    await runAction(T, "gab.subject", String(subj.id), "vatCheck", client);
    expect(calls[0]).toContain("<roz:dic>12345678</roz:dic>");
    let s = (await getRecord(T, "gab.subject", String(subj.id), client))!;
    expect([s.vatReliability, s.taxOffice]).toEqual(["reliable", "13"]);
    let accs = (await listRecords(T, "gab.bankAccount", { filter: { subjectId: subj.id }, sort: "accountNum" }, client)).rows;
    expect(accs.map((a) => [a.accountNum ?? a.iban, a.published, a.source])).toEqual([
      ["123456789/0300", false, "manual"],
      ["19-2808601/0100", true, "vatRegistry"],
      ["CZ4701000000271445680277", true, "vatRegistry"],
    ]);
    // log služby v Integraci
    expect((await listRecords(T, "int.log", { filter: { operation: "dphreg.status" } }, client)).total).toBe(1);

    // dodavatel dostane zveřejněný účet jako výchozí
    const [grp] = (await listRecords(T, "ap.group", {}, client)).rows;
    const vend = await saveRecord(T, "ap.vendor", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    expect(accs.filter((a) => a.published).map((a) => a.id)).toContain(vend.bankAccountId);
    // cizí účet odmítne
    const other = await saveRecord(T, "gab.subject", null, { name: "Jiný" }, undefined, client);
    const otherAcc = await saveRecord(T, "gab.bankAccount", null, { subjectId: other.id, iban: "CZ6501000000000123456789" }, undefined, client);
    await expect(saveRecord(T, "ap.vendor", String(vend.id), { bankAccountId: otherAcc.id }, undefined, client)).rejects.toMatchObject({ fields: { bankAccountId: "@GAB:AccountOtherSubject" } });

    // nespolehlivý, IBAN už není zveřejněný
    body = reply("ANO", std);
    await runAction(T, "gab.subject", String(subj.id), "vatCheck", client);
    s = (await getRecord(T, "gab.subject", String(subj.id), client))!;
    expect(s.vatReliability).toBe("unreliable");
    accs = (await listRecords(T, "gab.bankAccount", { filter: { subjectId: subj.id }, sort: "accountNum" }, client)).rows;
    expect(accs.find((a) => a.iban === "CZ4701000000271445680277")!.published).toBe(false);
  });
});
