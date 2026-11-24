/**
 * Podání datovou schránkou: XML přiznání odejde datovou zprávou do schránky finančního úřadu (síť napodobená),
 * podání je pak Podané s číslem zprávy; chyby schránky (přihlášení, chybějící napojení, příjemce) se hlásí srozumitelně.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);
const ok = (inner: string) => new Response(`<?xml version="1.0"?><soap:Envelope><soap:Body>${inner}</soap:Body></soap:Envelope>`, { status: 200 });

describe("datová schránka", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("odeslání přiznání, ověření napojení, chyby", async () => {
    const P = (await provisionTenant(client, { code: `t-isds-${run}`, name: "ISDS", adminEmail: `isds-${run}@test.local`, adminPassword: "heslo-12345", modules: ["tax", "int"], company: { code: "I", name: "I s.r.o.", regNo: "12345678", vatId: "CZ12345678" } })).ctx;
    await saveRecord(P, "tax.parameters", null, { taxOfficeCode: "451", subjectType: "P", street: "Na Poříčí", houseNo: "1", city: "Praha", zipCode: "110 00" }, undefined, client);
    const ret = await saveRecord(P, "tax.return", null, { kind: "dp3", year: 2026, month: 10 }, undefined, client);
    await runAction(P, "tax.return", String(ret.id), "calculate", client);

    // bez napojení
    await expect(runAction(P, "tax.return", String(ret.id), "sendIsds", client)).rejects.toMatchObject({ label: "@INT:IsdsNoConnection" });
    const conn = await saveRecord(P, "int.connection", null, { code: "ISDS", name: "Datová schránka", kind: "isds", driver: "isdsTest", isdsLogin: "firma1", isdsPassword: "tajne-heslo", active: true }, undefined, client);
    // bez schránky finančního úřadu
    await expect(runAction(P, "tax.return", String(ret.id), "sendIsds", client)).rejects.toMatchObject({ label: "@TAX:IsdsNoRecipient" });
    const [params] = (await listRecords(P, "tax.parameters", {}, client)).rows;
    // adresát = schránka firmy → odmítnout ještě před přihlášením
    await saveRecord(P, "tax.parameters", String(params.id), { ...params, taxOfficeDataBox: "abc1234", dataBoxId: "abc1234", naceCode: "46900" }, params.version as number, client);
    await expect(runAction(P, "tax.return", String(ret.id), "sendIsds", client)).rejects.toMatchObject({ label: "@TAX:IsdsToSelf" });
    const p2 = (await listRecords(P, "tax.parameters", {}, client)).rows[0];
    await saveRecord(P, "tax.parameters", String(p2.id), { ...p2, taxOfficeDataBox: "4n2aaaa", dataBoxId: "zzz9999" }, p2.version as number, client);

    // ověření napojení (Test spojení)
    const calls: { url: string; body: string; auth: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), auth: String((init.headers as Record<string, string>).authorization) });
      return url.endsWith("/DS/DsManage") ? ok("<p:dbOwnerInfo><p:dbID>abc1234</p:dbID></p:dbOwnerInfo><p:dbStatus><p:dbStatusCode>0000</p:dbStatusCode></p:dbStatus>") : ok("<p:dmID>987654321</p:dmID><p:dmStatus><p:dmStatusCode>0000</p:dmStatusCode></p:dmStatus>");
    });
    await runAction(P, "int.connection", String(conn.id), "test", client);
    expect(calls[0].url).toBe("https://ws1.czebox.cz/DS/DsManage");
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("firma1:tajne-heslo").toString("base64")}`);
    expect(String((await getRecord(P, "int.connection", String(conn.id), client))!.lastResult)).toContain("abc1234");

    // napojení se přihlásí do jiné schránky, než je schránka firmy → neodeslat
    await expect(runAction(P, "tax.return", String(ret.id), "sendIsds", client)).rejects.toMatchObject({ label: "@TAX:IsdsWrongSender", params: { own: "abc1234", expected: "zzz9999" } });
    expect(calls.some((c) => c.url.endsWith("/DS/dz"))).toBe(false);
    const p3 = (await listRecords(P, "tax.parameters", {}, client)).rows[0];
    await saveRecord(P, "tax.parameters", String(p3.id), { ...p3, dataBoxId: "abc1234" }, p3.version as number, client);
    // Zkontrolovat odeslání: souhrn odkud kam, nic neodešle
    const check = await runAction(P, "tax.return", String(ret.id), "checkIsds", client);
    expect(String((check as { message?: string })?.message)).toMatch(/testovací schránka.*abc1234.*4n2aaaa/);
    expect(calls.some((c) => c.url.endsWith("/DS/dz"))).toBe(false);
    expect((await getRecord(P, "tax.return", String(ret.id), client))!.status).toBe("draft");

    // odeslání přiznání
    await runAction(P, "tax.return", String(ret.id), "sendIsds", client);
    const sent = calls.at(-1)!;
    expect(sent.url).toBe("https://ws1.czebox.cz/DS/dz");
    expect(sent.body).toContain("<p:dbIDRecipient>4n2aaaa</p:dbIDRecipient>");
    const b64 = /<p:dmEncodedContent>([^<]+)</.exec(sent.body)![1];
    expect(Buffer.from(b64, "base64").toString("utf8")).toContain("DPHDP3");
    expect(Buffer.from(b64, "base64").toString("utf8")).toContain('c_okec="46900"');
    const after = (await getRecord(P, "tax.return", String(ret.id), client))!;
    expect([after.status, after.isdsMessageId]).toEqual(["filed", "987654321"]);
    // podané už znovu odeslat nejde
    await expect(runAction(P, "tax.return", String(ret.id), "sendIsds", client)).rejects.toBeTruthy();

    // odmítnuté přihlášení
    const r2 = await saveRecord(P, "tax.return", null, { kind: "dp3", year: 2026, month: 9 }, undefined, client);
    await runAction(P, "tax.return", String(r2.id), "calculate", client);
    vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
    await expect(runAction(P, "tax.return", String(r2.id), "sendIsds", client)).rejects.toMatchObject({ label: "@INT:IsdsBadLogin" });
    expect((await getRecord(P, "tax.return", String(r2.id), client))!.status).toBe("draft");

    // na serveru TEST ostrá schránka nejde (jen czebox)
    const prev = process.env.RAILWAY_ENVIRONMENT_NAME;
    process.env.RAILWAY_ENVIRONMENT_NAME = "test";
    try {
      const c2 = (await getRecord(P, "int.connection", String(conn.id), client))!;
      await saveRecord(P, "int.connection", String(conn.id), { ...c2, driver: "isds" }, c2.version as number, client);
      await expect(runAction(P, "tax.return", String(r2.id), "sendIsds", client)).rejects.toMatchObject({ label: "@INT:IsdsLiveOnTest" });
    } finally {
      if (prev === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
      else process.env.RAILWAY_ENVIRONMENT_NAME = prev;
    }
  }, 180_000);
});
