/**
 * Testovací prostředí jedním krokem: testovací napojení (EET simulátor,
 * simulátor platebního terminálu, tisk z prohlížeče) a testovací data
 * (boxy). Ostrá napojení stejného druhu se po dobu testu pozastaví
 * (`pausedByTest`) a vypnutím testu se zase zapnou.
 *
 * Testovací napojení mají kód TEST-…; nemažou se (drží je log), jen vypínají.
 */
import type { DataApi, RecordData } from "@/core/module";
import { PLAYGROUND_CERT_DIC, PLAYGROUND_CERT_P12, PLAYGROUND_CERT_PASSWORD } from "./assets/eet-playground";

const TEST_CONNECTIONS = [
  // skutečný EET Playground Finanční správy s veřejným testovacím certifikátem (vrací testovací FIK)
  { code: "TEST-EET", kind: "eet", driver: "eet2", name: "@INT:TestEet", extra: { unitId: "1", posId: "TEST", environment: "playground", certPassword: PLAYGROUND_CERT_PASSWORD, certData: PLAYGROUND_CERT_P12, certSubject: PLAYGROUND_CERT_DIC, certValidTo: "2027-05-14" } },
  { code: "TEST-PAY", kind: "payment", driver: "simulator", name: "@INT:TestPay", extra: {} },
  { code: "TEST-PRINT", kind: "printer", driver: "browser", name: "@INT:TestPrint", extra: { paperWidth: "80" } },
  // vytěžování dokladů klíčem z prostředí serveru (do databáze se neukládá)
  { code: "TEST-OCR", kind: "ocr", driver: "openaiTest", name: "@INT:TestOcr", extra: { model: "gpt-5-mini", dailyLimit: 30 } },
  // pošta jen do protokolu (nic neodchází)
  { code: "TEST-MAIL", kind: "mail", driver: "mailTest", name: "@INT:TestMail", extra: { fromEmail: "test@shanon.local", fromName: "Shanon – test" } },
] as const;

export interface TestEnvState {
  active: boolean;
  connections: { code: string; name: string; active: boolean }[];
  paused: string[];
}

export async function testEnvState(data: DataApi): Promise<TestEnvState> {
  const all = await data.find("int.connection", {}, { take: 500 });
  const tests = all.filter((c) => String(c.code).startsWith("TEST-"));
  return {
    active: tests.some((c) => c.active),
    connections: tests.map((c) => ({ code: String(c.code), name: String(c.name), active: !!c.active })),
    paused: all.filter((c) => c.pausedByTest).map((c) => String(c.code)),
  };
}

/** Zapnout testovací prostředí (idempotentní). `t` = překlad názvů. */
export async function enableTestEnv(data: DataApi, t: (ref: string) => string, withPos: boolean): Promise<void> {
  const all = await data.find("int.connection", {}, { take: 500 });
  for (const def of TEST_CONNECTIONS) {
    // ostrá napojení stejného druhu pozastavit
    for (const c of all.filter((x) => x.kind === def.kind && x.active && !String(x.code).startsWith("TEST-"))) {
      await data.update("int.connection", String(c.id), { active: false, pausedByTest: true });
    }
    const have = all.find((x) => x.code === def.code);
    // starší testovací napojení (simulátor) převést na aktuální nastavení
    if (have) await data.update("int.connection", String(have.id), { active: true, driver: def.driver, ...def.extra });
    else await data.create("int.connection", { code: def.code, name: t(def.name), kind: def.kind, driver: def.driver, active: true, ...def.extra });
  }
  // platební brána Comgate: testovací kopie ostrého napojení (stejné přístupy, testovací platby —
  // na platební stránce se zvolí výsledek, peníze se nepohybují); bez ostrého napojení není s čím testovat
  const live = (await data.find("int.connection", { driver: "comgate" }, { take: 50 })).find((c) => !String(c.code).startsWith("TEST-") && (c.active || c.pausedByTest));
  if (live) {
    const copy = { merchantCode: live.merchantCode, apiKey: live.apiKey, payMethods: live.payMethods ?? null, posQr: !!live.posQr, testMode: true, active: true };
    const [have] = await data.find("int.connection", { code: "TEST-COMGATE" }, { take: 1 });
    if (have) await data.update("int.connection", String(have.id), copy);
    else await data.create("int.connection", { code: "TEST-COMGATE", name: t("@INT:TestComgate"), kind: "payment", driver: "comgate", ...copy });
  } else {
    // bez Comgate: simulátor platební brány (testovací stránka Zaplatit / Zrušit, žádné přístupy)
    const [have] = await data.find("int.connection", { code: "TEST-GATEWAY" }, { take: 1 });
    if (have) await data.update("int.connection", String(have.id), { active: true, driver: "gatewaySim" });
    else await data.create("int.connection", { code: "TEST-GATEWAY", name: t("@INT:TestGateway"), kind: "payment", driver: "gatewaySim", posQr: false, active: true });
  }
  // testovací data: boxy pro odložené nákupy
  if (withPos && !(await data.find("pos.box", {}, { take: 1 })).length) {
    for (let i = 1; i <= 5; i++) await data.create("pos.box", { code: `B${String(i).padStart(2, "0")}`, name: `Box ${i}` });
  }
}

/**
 * Simulátor váhy už testovací prostředí nezakládá (falešné vážení se pletlo se skutečnou váhou): dříve
 * založený TEST-SCALE vypnout a skutečné váhy pozastavené testem zapnout. Idempotentní, volá výchozí nastavení.
 */
export async function retireTestScale(data: DataApi): Promise<void> {
  for (const c of await data.find("int.connection", { kind: "scale" }, { take: 50 })) {
    if (c.code === "TEST-SCALE" && c.active) await data.update("int.connection", String(c.id), { active: false });
    if (c.pausedByTest) await data.update("int.connection", String(c.id), { active: true, pausedByTest: false } as RecordData);
  }
}

/** Vypnout testovací prostředí: testovací napojení vypnout, pozastavená ostrá zapnout. */
export async function disableTestEnv(data: DataApi): Promise<void> {
  for (const c of await data.find("int.connection", {}, { take: 500 })) {
    if (String(c.code).startsWith("TEST-") && c.active) await data.update("int.connection", String(c.id), { active: false });
    if (c.pausedByTest) await data.update("int.connection", String(c.id), { active: true, pausedByTest: false } as RecordData);
  }
}
