/**
 * Testovací prostředí jedním krokem: testovací napojení (EET simulátor,
 * simulátor platebního terminálu, tisk z prohlížeče) a testovací data
 * (boxy). Ostrá napojení stejného druhu se po dobu testu pozastaví
 * (`pausedByTest`) a vypnutím testu se zase zapnou.
 *
 * Testovací napojení mají kód TEST-…; nemažou se (drží je log), jen vypínají.
 */
import type { DataApi, RecordData } from "@/core/module";

const TEST_CONNECTIONS = [
  { code: "TEST-EET", kind: "eet", driver: "eetSimulator", name: "@INT:TestEet", extra: { unitId: "1", posId: "TEST", environment: "playground" } },
  { code: "TEST-PAY", kind: "payment", driver: "simulator", name: "@INT:TestPay", extra: {} },
  { code: "TEST-PRINT", kind: "printer", driver: "browser", name: "@INT:TestPrint", extra: { paperWidth: "80" } },
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
    if (have) await data.update("int.connection", String(have.id), { active: true });
    else await data.create("int.connection", { code: def.code, name: t(def.name), kind: def.kind, driver: def.driver, active: true, ...def.extra });
  }
  // testovací data: boxy pro odložené nákupy
  if (withPos && !(await data.find("pos.box", {}, { take: 1 })).length) {
    for (let i = 1; i <= 5; i++) await data.create("pos.box", { code: `B${String(i).padStart(2, "0")}`, name: `Box ${i}` });
  }
}

/** Vypnout testovací prostředí: testovací napojení vypnout, pozastavená ostrá zapnout. */
export async function disableTestEnv(data: DataApi): Promise<void> {
  for (const c of await data.find("int.connection", {}, { take: 500 })) {
    if (String(c.code).startsWith("TEST-") && c.active) await data.update("int.connection", String(c.id), { active: false });
    if (c.pausedByTest) await data.update("int.connection", String(c.id), { active: true, pausedByTest: false } as RecordData);
  }
}
