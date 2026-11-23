/**
 * Tisková stanice a Správa tisku: osobní instalátor s párovacím kódem → spárování (kód jen jednou) → stanice
 * nahlásí tiskárny Windows (zapíší se k zařízení, papír odhadem) → pravidla určí, co kam tisknout (uživatel >
 * počítač > pokladna > obecné) → účtenka a faktura do fronty, PDF s nastavením tisku, výsledek → odpojení.
 * Instalace z Nastavení založí zařízení samo a pojmenuje ho podle počítače.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord, getRecord, runAction, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { sell } from "@/modules/pos/sale";
import { guessPaper, resolvePrintTarget } from "@/modules/int/print-rules";
import { jobPdf, pairStation, printSettings, queueStationPrint, reportJob, stationAuth, stationHello, stationSetup, takeJobs } from "@/server/station";

const client = createPrisma();
const run = Date.now().toString(36);
const pairCode = (cmd: string) => /\$SetupPair = '([^']+)'/.exec(Buffer.from(cmd.slice(cmd.lastIndexOf("::PAYLOAD::") + 11).trim(), "base64").toString("utf8"))![1];

describe("tisková stanice", () => {
  let P: Ctx;
  let regId: string;
  let deviceId: string;
  let token: string;
  let xp: string;
  let canon: string;

  beforeAll(async () => {
    P = (await provisionTenant(client, { code: `t-stanice-${run}`, name: "Stanice", adminEmail: `stanice-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "int"], company: { code: "ST", name: "Stanice s.r.o.", regNo: "12345678", vatId: "CZ12345678" } })).ctx;
    regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    deviceId = String((await saveRecord(P, "int.device", null, { code: "KASA1", name: "Pokladna u pultu", registerId: regId }, undefined, client)).id);
  }, 120_000);

  it("instalátor nese párovací kód a program stanice; kód spáruje jen jednou", async () => {
    const file = await inTenant(P, (s) => s.download("int.device", deviceId, "installer"), client);
    expect(file.name).toBe("Shanon-KASA1.cmd");
    const cmd = String(file.data);
    expect(cmd.startsWith("@echo off\r\n")).toBe(true);
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(cmd)).toBe(true);
    const ps1 = Buffer.from(cmd.slice(cmd.lastIndexOf("::PAYLOAD::") + 11).trim(), "base64").toString("utf8");
    expect(ps1.charCodeAt(0)).toBe(0xfeff);
    expect(ps1).toContain("#--AGENT--");
    const code = pairCode(cmd);
    expect(code.startsWith(`shp.${P.tenantId}.`)).toBe(true);
    const r = await pairStation(code, { host: "PC-PULT", version: "1.0.0" });
    expect(r?.deviceId).toBe(deviceId);
    token = r!.token;
    expect(await pairStation(code, {})).toBeNull();
    const dev = (await getRecord(P, "int.device", deviceId, client))!;
    // ručně založené zařízení si kód a název nechá
    expect([dev.paired, dev.hostName, dev.code]).toEqual([true, "PC-PULT", "KASA1"]);
    expect(dev.tokenHash).not.toContain(token);
  });

  it("stanice nahlásí tiskárny Windows — zapíší se k zařízení, virtuální ne, chybějící se označí", async () => {
    const st = (await stationAuth(`Bearer ${token}`))!;
    await stationHello(st, { host: "PC-PULT", printers: [{ name: "XP-58", default: true }, { name: "Canon LBP646C" }, { name: "Microsoft Print to PDF" }, { name: "Stará" }] });
    await stationHello(st, { host: "PC-PULT", printers: [{ name: "XP-58", default: true }, { name: "Canon LBP646C" }, { name: "Microsoft Print to PDF" }] });
    const rows = (await listRecords(P, "int.devicePrinter", { filter: { deviceId } }, client)).rows;
    const by = (n: string) => rows.find((r) => r.printerName === n)!;
    expect(rows.map((r) => r.printerName).sort()).toEqual(["Canon LBP646C", "Stará", "XP-58"]);
    expect([by("XP-58").label, by("XP-58").paper, by("XP-58").isDefault]).toEqual(["KASA1 · XP-58", "58", true]);
    expect(by("Canon LBP646C").paper).toBe("a4");
    expect(by("Stará").present).toBe(false);
    xp = String(by("XP-58").id);
    canon = String(by("Canon LBP646C").id);
    // první hlášení: výchozí pravidla pro tento počítač — účtenky na roli hned po zaplacení, ostatní na A4
    const defaults = (await listRecords(P, "int.printRule", { filter: { fromDeviceId: deviceId } }, client)).rows;
    expect(defaults.map((r) => [r.docType, r.printerId, r.autoPrint]).sort()).toEqual([["*", canon, false], ["pos.receipt", xp, true]].sort());
    await saveRecord(P, "int.devicePrinter", xp, { copies: 2 }, undefined, client);
  });

  it("pravidla: účtenka na XP-58, faktura na Canon; přesnější pravidlo má přednost", async () => {
    await saveRecord(P, "int.printRule", null, { docType: "pos.receipt", printerId: xp }, undefined, client);
    await saveRecord(P, "int.printRule", null, { docType: "ar.invoice", printerId: canon }, undefined, client);
    // jen při tisku z tohoto počítače → XP-58
    await saveRecord(P, "int.printRule", null, { docType: "ar.invoice", printerId: xp, fromDeviceId: deviceId, registerId: regId, autoPrint: true }, undefined, client);
    const t = (who: { stationId?: string; userId?: string }) => inTenant(P, (s) => resolvePrintTarget(s.sys().api(), "ar.invoice", who), client);
    expect((await t({}))?.printer.id).toBe(canon);
    expect((await t({ stationId: deviceId }))?.printer.id).toBe(xp);
    await saveRecord(P, "int.printRule", null, { docType: "ar.invoice", printerId: canon, userId: P.userId }, undefined, client);
    expect((await t({ stationId: deviceId, userId: P.userId }))?.printer.id).toBe(canon);
    // ostatní doklady z tohoto počítače → A4 (výchozí pravidlo „*“)
    expect((await inTenant(P, (s) => resolvePrintTarget(s.sys().api(), "pos.shift", { stationId: deviceId }), client))?.printer.id).toBe(canon);
    // tiskárna vybraná u pokladny má u účtenek přednost před obecným pravidlem
    await saveRecord(P, "pos.register", regId, { stationPrinterId: canon }, undefined, client);
    expect((await inTenant(P, (s) => resolvePrintTarget(s.sys().api(), "pos.receipt", { registerId: regId }), client))?.printer.id).toBe(canon);
    await saveRecord(P, "pos.register", regId, { stationPrinterId: null }, undefined, client);
    // pokladna a automatický tisk jen u účtenek
    const rules = (await listRecords(P, "int.printRule", { filter: { fromDeviceId: deviceId } }, client)).rows;
    expect([rules[0].registerId, rules[0].autoPrint]).toEqual([null, false]);
  });

  it("účtenka z pokladny jde na tiskárnu stanice, stanice vytiskne a nahlásí výsledek", async () => {
    const g = (await listRecords(P, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const ks = (await listRecords(P, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const item = String((await saveRecord(P, "inv.item", null, { itemNum: "S1", name: "Rohlík", groupId: g.id, unitId: ks.id, salesPrice: "5", priceInclTax: true }, undefined, client)).id);
    await saveRecord(P, "pos.shift", null, { registerId: regId, openingCash: "0" }, undefined, client);
    const sale = await inTenant(P, (s) => sell(s.sys().api(), { registerId: regId, payment: "cash", cashGiven: "10", lines: [{ itemId: item, qty: "2" }] }), client);

    const q = await queueStationPrint(P, "pos.receipt", [String(sale.id)]);
    expect(q).toMatchObject({ printer: "KASA1 · XP-58", device: "Pokladna u pultu", online: true });

    const st = (await stationAuth(`Bearer ${token}`))!;
    const jobs = await takeJobs(st, 0);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ printer: "XP-58", copies: 2 });
    // předaná úloha se hned znovu nevydá
    expect(await takeJobs(st, 0)).toHaveLength(0);
    const pdf = await jobPdf(st, jobs[0].id);
    expect(pdf.pdf.subarray(0, 4).toString()).toBe("%PDF");
    // papír tiskárny (58 mm) → účtenka na roli 58
    expect(pdf.settings).toBe("noscale,2x");
    await reportJob(st, jobs[0].id, true);
    expect((await getRecord(P, "int.printJob", jobs[0].id, client))!.status).toBe("done");

    // zkušební stránka tiskárny = úloha ve frontě
    const out = await runAction(P, "int.devicePrinter", canon, "test", client);
    expect(out).toMatchObject({ open: { object: "int.printJob" } });
    const test = await takeJobs(st, 0);
    expect(test).toMatchObject([{ printer: "Canon LBP646C" }]);
    expect((await jobPdf(st, test[0].id)).settings).toBe("fit,paper=A4");
  });

  it("doklad bez pravidla tiskne prohlížeč; odpojená stanice nemá přístup", async () => {
    expect(await queueStationPrint(P, "pos.shift", [String((await listRecords(P, "pos.shift", {}, client)).rows[0].id)])).toBeNull();
    await runAction(P, "int.device", deviceId, "unpair", client);
    expect(await stationAuth(`Bearer ${token}`)).toBeNull();
  });

  it("instalace z Nastavení založí zařízení a při spárování ho pojmenuje podle počítače", async () => {
    const f = await stationSetup(P, null);
    expect(f.name).toMatch(/^Shanon-PC\d+\.cmd$/);
    const r = await pairStation(pairCode(f.data), { host: "kancelar-2", version: "1.0.0" });
    const dev = (await getRecord(P, "int.device", r!.deviceId, client))!;
    expect([dev.code, dev.name, dev.autoName]).toEqual(["KANCELAR-2", "kancelar-2", false]);
    // znovu z téhož počítače (zástupce zná zařízení) → stejné zařízení, nový kód
    const again = await stationSetup(P, r!.deviceId);
    expect(again.name).toBe("Shanon-KANCELAR-2.cmd");
  });

  it("nastavení tisku podle papíru a odhad papíru z názvu", () => {
    expect(printSettings({ paper: "receiptA6" }, 1)).toBe("noscale,paper=A6");
    expect(printSettings({ paper: "a4" }, 3)).toBe("fit,paper=A4,3x");
    expect(printSettings({ paper: "receipt80" }, 1)).toBe("noscale");
    expect([guessPaper("XP-58"), guessPaper("POS-80C"), guessPaper("EPSON TM-T20II"), guessPaper("HP LaserJet M404")]).toEqual(["58", "80", "80", "a4"]);
  });
});
