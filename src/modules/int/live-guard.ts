/**
 * Ostrý provoz na testovacím serveru: napojení, která mají účinek mimo Shanon (ostré EET, datová schránka, pošta
 * skutečným adresátům, platby kartou), se na testovacím serveru nepoužijí — ledaže je u napojení ručně zapnuté
 * „Povolit ostrý provoz na testovacím serveru“ (`liveOnTest`). Veřejné služby (ARES, ČNB) a zařízení (tiskárna,
 * váha) se netýká. Platí pro každé čtení napojení k použití (`usable`), ne pro jejich správu.
 */
import type { RecordData } from "@/core/module";

/** Testovací server: `SHANON_SERVER_MODE=test|production`, jinak prostředí Railway jiné než production. */
export function isTestServer(): boolean {
  const mode = process.env.SHANON_SERVER_MODE;
  if (mode) return mode === "test";
  const env = process.env.RAILWAY_ENVIRONMENT_NAME;
  return !!env && env !== "production";
}

/** Napojení s účinkem mimo Shanon (testovací protějšky TEST-…, simulátory a Playground ne). */
export function isLiveConnection(c: RecordData): boolean {
  if (String(c.code ?? "").startsWith("TEST-")) return false;
  switch (c.kind) {
    case "eet":
      return c.driver === "eet2" && c.environment === "production";
    case "isds":
      return c.driver === "isds";
    case "mail":
      return c.driver === "smtp" || c.driver === "system";
    case "payment":
      return c.driver === "sumup" || (c.driver === "comgate" && !c.testMode);
    default:
      return false;
  }
}

/** Ostré napojení, které se na testovacím serveru nesmí použít. */
export const liveBlocked = (c: RecordData): boolean => isTestServer() && isLiveConnection(c) && !c.liveOnTest;

/** Ostré napojení povolené ručně na testovacím serveru (upozornění v UI). */
export const liveOnTestActive = (c: RecordData | null | undefined): boolean => !!c && isTestServer() && isLiveConnection(c) && !!c.liveOnTest;

/** Napojení, která smí logika použít (na testovacím serveru bez zablokovaných ostrých). */
export const usable = <T extends RecordData>(list: T[]): T[] => list.filter((c) => !liveBlocked(c));
