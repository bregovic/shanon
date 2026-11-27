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
import { jobPdf, pairStation, printSettings, queueStationPrint, reportJob, stationAuth, stationHello, stationInstallerFile, stationDiagnostics, stationSetup, takeJobs } from "@/server/station";

const client = createPrisma();
const run = Date.now().toString(36);

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

  it("instalace: odkaz s párovacím kódem → instalátor .exe a skript s programem stanice; kód spáruje jen jednou", async () => {
    const out = (await runAction(P, "int.device", deviceId, "installer", client)) as { href: string };
    const code = out.href.split("/").pop()!;
    expect(out.href).toBe(`/api/station/installer/${code}`);
    expect(code.startsWith(`shp.${P.tenantId}.`)).toBe(true);
    const exe = (await stationInstallerFile(code, "exe"))!;
    expect(exe.subarray(0, 2).toString()).toBe("MZ");
    const ps1 = (await stationInstallerFile(code, "script"))!.toString("utf8");
    expect(ps1.charCodeAt(0)).toBe(0xfeff);
    expect(ps1).toContain("#--AGENT--");
    expect(/\$SetupPair = '([^']+)'/.exec(ps1)![1]).toBe(code);
    expect(await stationInstallerFile(code.slice(0, -2) + "xx", "exe")).toBeNull();
    const r = await pairStation(code, { host: "PC-PULT", version: "1.0.0" });
    expect(r?.deviceId).toBe(deviceId);
    token = r!.token;
    expect(await pairStation(code, {})).toBeNull();
    // spárováno → odkaz na instalaci už neplatí
    expect(await stationInstallerFile(code, "script")).toBeNull();
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
    const r = await pairStation(f.href.split("/").pop()!, { host: "kancelar-2", version: "1.0.0" });
    const dev = (await getRecord(P, "int.device", r!.deviceId, client))!;
    expect([dev.code, dev.name, dev.autoName]).toEqual(["KANCELAR-2", "kancelar-2", false]);
    // znovu z téhož počítače (zástupce zná zařízení) → stejné zařízení, nový kód
    const again = await stationSetup(P, r!.deviceId);
    expect((await pairStation(again.href.split("/").pop()!, { host: "kancelar-2" }))?.deviceId).toBe(r!.deviceId);
    // přeinstalace z prohlížeče, který počítač nezná (nové zařízení) → spáruje se původní zařízení počítače
    const fresh = await stationSetup(P, null);
    expect(fresh.deviceId).not.toBe(r!.deviceId);
    const re = (await pairStation(fresh.href.split("/").pop()!, { host: "KANCELAR-2", version: "1.1.0" }))!;
    expect(re.deviceId).toBe(r!.deviceId);
    expect(await getRecord(P, "int.device", fresh.deviceId, client)).toBeNull();
  });

  it("tisk z běžného prohlížeče (bez zástupce) jde na počítač uživatele; tiskovou úlohu jde zrušit", async () => {
    // instalace z Nastavení: zařízení dostane uživatele a vrátí se jeho id (prohlížeč si ho zapamatuje)
    const f = await stationSetup(P, null);
    const paired = (await pairStation(f.href.split("/").pop()!, { host: "recepce", version: "1.0.0" }))!;
    expect(f.deviceId).toBe(paired.deviceId);
    expect((await getRecord(P, "int.device", paired.deviceId, client))!.userId).toBe(P.userId);
    const st = (await stationAuth(`Bearer ${paired.token}`))!;
    await stationHello(st, { host: "recepce", printers: [{ name: "EPSON TM-T20III", default: true }, { name: "HP LaserJet" }] });
    // víc počítačů téhož uživatele = nevíme, který → prohlížeč; jediný → ten
    const rc = String((await listRecords(P, "pos.receipt", {}, client)).rows[0].id);
    const before = await queueStationPrint(P, "pos.receipt", [rc]);
    expect(before?.device).not.toBe("recepce");
    for (const d of (await listRecords(P, "int.device", { pageSize: 100 }, client)).rows)
      if (d.id !== paired.deviceId && d.userId) await saveRecord(P, "int.device", String(d.id), { userId: null }, d.version as number, client);
    // výchozí pravidla počítače (ostatní doklady → A4), tisk bez stationId = počítač uživatele
    const q = (await queueStationPrint(P, "pos.receipt", [rc]))!;
    expect(q.device).toBe("recepce");
    const jobs = await takeJobs(st, 0);
    expect(jobs).toHaveLength(1);
    // zrušit: stanice PDF nedostane a pozdní výsledek stav nepřepíše
    await runAction(P, "int.printJob", jobs[0].id, "cancel", client);
    expect((await getRecord(P, "int.printJob", jobs[0].id, client))!.status).toBe("cancelled");
    await expect(jobPdf(st, jobs[0].id)).rejects.toMatchObject({ label: "@SYS:NotFound" });
    await reportJob(st, jobs[0].id, true);
    expect((await getRecord(P, "int.printJob", jobs[0].id, client))!.status).toBe("cancelled");
    await expect(runAction(P, "int.printJob", jobs[0].id, "cancel", client)).rejects.toMatchObject({ label: "@INT:PJCancelDone" });
    expect(await takeJobs(st, 0)).toHaveLength(0);

    // stav tiskáren: stanice 1.1 hlásí stav a frontu; Obnovit stav = dotaz úloh odpoví hned s hello
    const { stationDiagnostics, stationRefresh, helloWanted, stationAgentVersion } = await import("@/server/station");
    await stationHello(st, { host: "recepce", version: "1.1.0", printers: [{ name: "EPSON TM-T20III", default: true, state: "noPaper", queued: 2 }, { name: "HP LaserJet", state: "nesmysl" }] });
    const d = await stationDiagnostics(P, paired.deviceId);
    expect([d.source, d.device?.online, d.device?.version]).toEqual(["browser", true, "1.1.0"]);
    const epson = d.printers.find((x) => x.printerName === "EPSON TM-T20III")!;
    expect([epson.state, epson.stateLabel, epson.queued]).toEqual(["noPaper", "Došel papír", 2]);
    expect(d.printers.find((x) => x.printerName === "HP LaserJet")!.state).toBeNull(); // neznámá hodnota se nezapíše
    expect(d.receipt).toContain("EPSON");
    expect((await stationDiagnostics(P, null)).source).toBe("user");
    await stationRefresh(P, paired.deviceId);
    expect(await helloWanted(st)).toBe(true);
    expect(await takeJobs(st, 5)).toHaveLength(0); // odpoví hned, ne za 5 s
    await stationHello(st, { host: "recepce", version: "1.1.0", printers: [{ name: "EPSON TM-T20III", default: true, state: "ready" }, { name: "HP LaserJet" }] });
    expect(await helloWanted(st)).toBe(false);
    expect(stationAgentVersion()).toBe("1.3.0");
    // nabídka tiskáren: jen skutečné a připojené (Snagit / PDF se nehlásí, odpojená se nenabízí)
    const { refOptions } = await import("@/server/data");
    await stationHello(st, { host: "recepce", version: "1.1.0", printers: [{ name: "EPSON TM-T20III", default: true }, { name: "Snagit 2022" }, { name: "Adobe PDF" }] });
    const opts = (await refOptions(P, "int.devicePrinter", "", client)).map((o) => o.title);
    expect(opts.some((t) => t.includes("EPSON TM-T20III"))).toBe(true);
    expect(opts.some((t) => /Snagit|PDF|HP LaserJet/.test(t))).toBe(false);
    // tiskovou úlohu i celé zařízení (s tiskárnami, pravidly a úlohami) jde smazat
    const { deleteRecord } = await import("@/server/data");
    await queueStationPrint(P, "pos.receipt", [rc]);
    const [j2] = (await listRecords(P, "int.printJob", { filter: { deviceId: paired.deviceId, status: "queued" } }, client)).rows;
    await deleteRecord(P, "int.printJob", String(j2.id), client);
    expect(await getRecord(P, "int.printJob", String(j2.id), client)).toBeNull();
    await queueStationPrint(P, "pos.receipt", [rc]);
    // běžící stanici smazat nejde – nejdřív odpojit
    await expect(deleteRecord(P, "int.device", paired.deviceId, client)).rejects.toMatchObject({ label: "@INT:DeviceDeleteOnline" });
    await runAction(P, "int.device", paired.deviceId, "unpair", client);
    await deleteRecord(P, "int.device", paired.deviceId, client);
    expect(await getRecord(P, "int.device", paired.deviceId, client)).toBeNull();
    expect((await listRecords(P, "int.printRule", { filter: { fromDeviceId: paired.deviceId } }, client)).total).toBe(0);
  });

  it("používané a nalezené tiskárny, katalog modelů: nastavení se přenese na další počítač, USB bez ovladače s odkazem", async () => {
    const pc = async (host: string) => {
      const f = await stationSetup(P, null);
      const pd = (await pairStation(f.href.split("/").pop()!, { host, version: "1.2.0" }))!;
      return { id: pd.deviceId, st: (await stationAuth(`Bearer ${pd.token}`))! };
    };
    const a = await pc(`sklad-${run}`);
    await stationHello(a.st, { host: "sklad", printers: [{ name: "Kancl A4", default: true, driver: "Generic A4" }, { name: "Brother QL-800", driver: "Brother QL-800" }, { name: "XP-80C", driver: "XP-80" }] });
    const rows = (await listRecords(P, "int.devicePrinter", { filter: { deviceId: a.id } }, client)).rows;
    const by = (n: string) => rows.find((r) => r.printerName === n)!;
    // výchozí a účtenková se používají, ostatní jen nalezené (nenabízí se ve výběru)
    expect([by("Kancl A4").enabled, by("XP-80C").enabled, by("Brother QL-800").enabled]).toEqual([true, true, false]);
    expect(by("Brother QL-800").driverName).toBe("Brother QL-800");
    const { refOptions } = await import("@/server/data");
    expect((await refOptions(P, "int.devicePrinter", "Brother", client)).length).toBe(0);
    // zapnout, nastavit papír a uložit do katalogu
    await saveRecord(P, "int.devicePrinter", String(by("Brother QL-800").id), { enabled: true, paper: "58", copies: 2 }, undefined, client);
    await runAction(P, "int.devicePrinter", String(by("Brother QL-800").id), "toCatalog", client);
    const [model] = (await listRecords(P, "int.printerModel", { filter: { match: "Brother QL-800" } }, client)).rows;
    expect([model.paper, model.copies, model.usage]).toEqual(["58", 2, "receipts"]);
    await saveRecord(P, "int.printerModel", String(model.id), { driverUrl: "https://example.com/ql800" }, undefined, client);
    // druhý počítač: stejná tiskárna (jiný název fronty) převezme nastavení z katalogu; USB bez ovladače dostane odkaz
    const b = await pc(`expedice-${run}`);
    await stationHello(b.st, { host: "expedice", printers: [{ name: "Brother QL-800 (kopie 1)", driver: "Brother QL-800" }], usb: ["Brother QL-800 (kopie 1)", "Brother QL800", "Nový ovladač"] });
    const [q] = (await listRecords(P, "int.devicePrinter", { filter: { deviceId: b.id } }, client)).rows;
    expect([q.enabled, q.paper, q.copies, q.modelId]).toEqual([true, "58", 2, model.id]);
    await stationHello(b.st, { host: "expedice", printers: [], usb: ["Brother QL800"] });
    const d = await stationDiagnostics(P, null, b.id);
    expect(d.usbNoDriver).toEqual([{ name: "Brother QL800", model: "Brother QL-800", driverUrl: "https://example.com/ql800" }]);
    expect(d.canEdit).toBe(true);
    // Přidat tento počítač (diagnostika): jen zařízení, bez párovacího kódu a instalace
    const only = await stationSetup(P, null, { pair: false });
    expect(only.href).toBe("");
    const od = (await getRecord(P, "int.device", only.deviceId, client))!;
    expect([od.paired, od.active]).toEqual([false, true]);
    // diagnostika z prohlížeče aktualizuje záznam počítače
    await stationSetup(P, only.deviceId, { pair: false, browser: "Chrome 131 · Windows" });
    const od2 = (await getRecord(P, "int.device", only.deviceId, client))!;
    expect([od2.browserInfo, !!od2.browserSeenAt]).toEqual(["Chrome 131 · Windows", true]);

    // sdílená tiskárna z katalogu: diagnostika ji nabídne, stanice ji připojí a nahlásí
    const { stationConnect, connectWanted, stationConnectReport } = await import("@/server/station");
    await expect(saveRecord(P, "int.printerModel", null, { name: "Kancl", match: "Kancl sdilena", connectPath: "C:\\x & del" }, undefined, client)).rejects.toBeTruthy();
    const share = await saveRecord(P, "int.printerModel", null, { name: "Kancl", match: "Kancl sdilena", connectPath: "\\\\server\\Kancl" }, undefined, client);
    let d2 = await stationDiagnostics(P, null, b.id);
    expect(d2.connectable).toEqual([{ id: share.id, name: "Kancl", path: "\\\\server\\Kancl", queued: false }]);
    await stationConnect(P, b.id, String(share.id));
    expect(await connectWanted(b.st)).toEqual(["\\\\server\\Kancl"]);
    expect(await takeJobs(b.st, 5)).toHaveLength(0); // odpoví hned (je co připojit)
    await stationConnectReport(b.st, "\\\\server\\Kancl", true);
    expect(await connectWanted(b.st)).toEqual([]);
    await stationHello(b.st, { host: "expedice", printers: [{ name: "\\\\server\\Kancl", driver: "HP Universal" }] });
    d2 = await stationDiagnostics(P, null, b.id);
    expect(d2.connectable).toEqual([]);
    expect(d2.device!.connectResult).toMatch(/\\\\server\\Kancl: OK$/);
    // síťová tiskárna kasy na tabletu (Epson ePOS) – diagnostika ji nabídne k ověření z prohlížeče
    await saveRecord(P, "int.connection", null, { code: `NET-${run}`.slice(0, 20), name: "Epson v síti", kind: "printer", driver: "escposNet", printerHost: "192.168.1.32", openDrawer: true }, undefined, client);
    expect((await stationDiagnostics(P, null)).netPrinters).toEqual([expect.objectContaining({ name: "Epson v síti", host: "192.168.1.32", register: null, drawer: true })]);

    // ruční přidání tiskárny k zařízení: Podle tiskárny jiného počítače / Model z katalogu doplní název ve Windows a papír
    const src = (await listRecords(P, "int.devicePrinter", { filter: { deviceId: b.id } }, client)).rows.find((x) => x.printerName === "Brother QL-800 (kopie 1)")!;
    const m1 = await saveRecord(P, "int.devicePrinter", null, { deviceId: only.deviceId, copyFromId: src.id }, undefined, client);
    expect([m1.printerName, m1.label, m1.paper, m1.copies, m1.modelId]).toEqual(["Brother QL-800 (kopie 1)", "Brother QL-800 (kopie 1)", "58", 2, model.id]);
    const m2 = await saveRecord(P, "int.devicePrinter", null, { deviceId: only.deviceId, modelId: model.id }, undefined, client);
    expect([m2.printerName, m2.paper, m2.enabled]).toEqual(["Brother QL-800", "58", true]);
    await expect(saveRecord(P, "int.devicePrinter", null, { deviceId: only.deviceId }, undefined, client)).rejects.toBeTruthy();
  });

  it("nastavení tisku podle papíru a odhad papíru z názvu", () => {
    expect(printSettings({ paper: "receiptA6" }, 1)).toBe("noscale,paper=A6");
    expect(printSettings({ paper: "a4" }, 3)).toBe("fit,paper=A4,3x");
    expect(printSettings({ paper: "receipt80" }, 1)).toBe("noscale");
    expect([guessPaper("XP-58"), guessPaper("POS-80C"), guessPaper("EPSON TM-T20II"), guessPaper("HP LaserJet M404")]).toEqual(["58", "80", "80", "a4"]);
  });
});
