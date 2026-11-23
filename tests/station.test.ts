/**
 * Tisková stanice: osobní instalátor s párovacím kódem → spárování (kód jen jednou) → tisk účtenky z pokladny
 * na tiskárnu stanice (fronta, PDF s nastavením tisku, výsledek) → odpojení. Doklad bez pravidla = tisk z prohlížeče.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord, getRecord, runAction, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { sell } from "@/modules/pos/sale";
import { jobPdf, pairStation, printSettings, queueStationPrint, reportJob, stationAuth, takeJobs } from "@/server/station";

const client = createPrisma();
const run = Date.now().toString(36);

describe("tisková stanice", () => {
  let P: Ctx;
  let regId: string;
  let deviceId: string;
  let token: string;

  beforeAll(async () => {
    P = (await provisionTenant(client, { code: `t-stanice-${run}`, name: "Stanice", adminEmail: `stanice-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "int"], company: { code: "ST", name: "Stanice s.r.o.", regNo: "12345678", vatId: "CZ12345678" } })).ctx;
    regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    deviceId = String((await saveRecord(P, "int.device", null, { code: "KASA1", name: "Pokladna u pultu", registerId: regId }, undefined, client)).id);
  }, 120_000);

  it("instalátor nese párovací kód a program stanice; kód spáruje jen jednou", async () => {
    const file = await inTenant(P, (s) => s.download("int.device", deviceId, "installer"), client);
    expect(file.name).toBe("Shanon-Pokladna-KASA1.cmd");
    const cmd = String(file.data);
    expect(cmd.startsWith("@echo off\r\n")).toBe(true);
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(cmd)).toBe(true);
    const ps1 = Buffer.from(cmd.slice(cmd.lastIndexOf("::PAYLOAD::") + 11).trim(), "base64").toString("utf8");
    expect(ps1.charCodeAt(0)).toBe(0xfeff);
    expect(ps1).toContain("#--AGENT--");
    const code = /\$SetupPair = '([^']+)'/.exec(ps1)![1];
    expect(code.startsWith(`shp.${P.tenantId}.`)).toBe(true);
    const r = await pairStation(code, { host: "PC-PULT", version: "1.0.0" });
    expect(r?.deviceId).toBe(deviceId);
    token = r!.token;
    expect(await pairStation(code, {})).toBeNull();
    const dev = (await getRecord(P, "int.device", deviceId, client))!;
    expect([dev.paired, dev.hostName]).toEqual([true, "PC-PULT"]);
    expect(dev.tokenHash).not.toContain(token);
  });

  it("účtenka z pokladny jde na tiskárnu stanice, stanice vytiskne a nahlásí výsledek", async () => {
    const conn = await saveRecord(P, "int.connection", null, { code: "XP58", name: "Účtenky", kind: "printer", driver: "station", deviceId, printerName: "XP-58", paperWidth: "58", copies: 2 }, undefined, client);
    await saveRecord(P, "pos.register", regId, { printerConnId: conn.id }, undefined, client);
    const g = (await listRecords(P, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const ks = (await listRecords(P, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const item = String((await saveRecord(P, "inv.item", null, { itemNum: "S1", name: "Rohlík", groupId: g.id, unitId: ks.id, salesPrice: "5", priceInclTax: true }, undefined, client)).id);
    await saveRecord(P, "pos.shift", null, { registerId: regId, openingCash: "0" }, undefined, client);
    const sale = await inTenant(P, (s) => sell(s.sys().api(), { registerId: regId, payment: "cash", cashGiven: "10", lines: [{ itemId: item, qty: "2" }] }), client);

    const q = await queueStationPrint(P, "pos.receipt", [String(sale.id)]);
    expect(q).toMatchObject({ printer: "XP-58", device: "Pokladna u pultu", online: true });

    const st = (await stationAuth(`Bearer ${token}`))!;
    expect(st.deviceId).toBe(deviceId);
    const jobs = await takeJobs(st, 0);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ printer: "XP-58", copies: 2 });
    // předaná úloha se hned znovu nevydá
    expect(await takeJobs(st, 0)).toHaveLength(0);
    const pdf = await jobPdf(st, jobs[0].id);
    expect(pdf.pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.settings).toBe("noscale,2x");
    await reportJob(st, jobs[0].id, true);
    const job = (await getRecord(P, "int.printJob", jobs[0].id, client))!;
    expect(job.status).toBe("done");

    // zkouška tiskárny = zkušební stránka do fronty
    await runAction(P, "int.connection", String(conn.id), "test", client);
    const test = await takeJobs(st, 0);
    expect(test).toHaveLength(1);
    expect((await jobPdf(st, test[0].id)).pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("doklad bez pravidla tiskárny stanice tiskne prohlížeč; odpojená stanice nemá přístup", async () => {
    const reg = (await getRecord(P, "pos.register", regId, client))!;
    expect(await queueStationPrint(P, "pos.shift", [String((await listRecords(P, "pos.shift", {}, client)).rows[0].id)])).toBeNull();
    await runAction(P, "int.device", deviceId, "unpair", client);
    expect(await stationAuth(`Bearer ${token}`)).toBeNull();
    expect(reg.printerConnId).toBeTruthy();
  });

  it("nastavení tisku podle papíru", () => {
    expect(printSettings({ paper: "receiptA6" }, 1)).toBe("noscale,paper=A6");
    expect(printSettings({ paper: "a4" }, 3)).toBe("fit,paper=A4,3x");
    expect(printSettings({ paper: "receipt80" }, 1)).toBe("noscale");
  });
});
