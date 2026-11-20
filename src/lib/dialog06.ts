/**
 * Protokol Dialog 06 pro pokladní váhy se stanoveným měřidlem (cenu počítá váha, pokladna jen posílá cenu za kg).
 *
 * POZOR — PŘEDBĚŽNÉ RÁMCE. Zatím podle obecně publikované podoby Dialog 06 (Mettler Toledo a kompatibilní);
 * oficiální specifikace pro TEM EGE (vahy-praha.cz) se teprve shání. Po jejím dodání se mění jen tento
 * soubor (konstanty rámců a tabulka STATUS), zbytek pokladny pracuje s `Dialog06Message`.
 *
 * Výměna pro jednu položku (řídí vždy pokladna, váha sama nic neposílá):
 *   pokladna → váha   EOT STX "01" ESC cena(6, haléře) ESC ETX             cena za kg      → ACK / NAK
 *                     EOT STX "04" ESC cena(6) ESC text(≤13) ESC ETX       cena + název    → ACK / NAK
 *   pokladna → váha   EOT ENQ                                               dotaz na stav
 *   váha → pokladna   STX "02" ESC "3" ESC hmotnost(5, g) ESC cena(6) ESC k zaplacení(6) ETX   ustálené čtení
 *                     STX "09" ESC stav(2) ETX                              stav / chyba
 *   pokladna → váha   cena 000000 = vymazat cenu ve váze
 *
 * Hodnoty se předávají jako text přesně z rámce (hmotnost „0.384“, ceny „319.00“) — žádné zaokrouhlování ani
 * přepočty, jen vložení desetinné čárky do čísla, které poslala váha.
 */

export const EOT = 0x04;
export const STX = 0x02;
export const ETX = 0x03;
export const ENQ = 0x05;
export const ACK = 0x06;
export const NAK = 0x15;
export const ESC = 0x1b;

/**
 * Výchozí linka Dialog 06: 8 bitů, bez parity, 1 stop bit — ověřeno na TEM EGE-M (20. 11. 2026: cenu potvrdí ACK
 * na 9600 8N1, na 7O1 mlčí). Skutečné nastavení bere pokladna z napojení váhy (Zkouška váhy ho uloží).
 */
export const DIALOG06_LINE = { dataBits: 8 as const, parity: "none" as const, stopBits: 1 as const };

export type Dialog06Status = "unstable" | "belowMin" | "overload" | "negative" | "noPrice" | "noZero" | "error";

/**
 * Kódy stavů ve zprávě 09 → význam. Podle popisu protokolu Dialog (Mettler Toledo / Bizerba), který TEM přebírá;
 * TEM EGE-M (20. 11. 2026): cenu bere záznamem 01 (ACK), záznamy s tárou 03 / 05 odmítá (NAK); stav 12 hlásí při
 * tárování na váze, 31 prázdná váha, 33 zboží na váze už při zadání ceny (sundat a položit znovu).
 * 00 bez chyby, 01 obecná chyba, 02 parita / délka, 10 špatné číslo záznamu, 11 neplatná cena, 12 neplatná tára,
 * 13 neplatný text, 20 neustálená, 21 od posledního vážení se nevrátila na nulu, 22 cena ještě není spočítaná,
 * 30 pod minimem, 31 záporná / podtížení, 32 přetížení.
 */
export const STATUS: Record<string, Dialog06Status> = {
  "11": "noPrice",
  "20": "unstable",
  "21": "noZero",
  "22": "unstable",
  "30": "belowMin",
  // TEM EGE-M (ověřeno 20. 11. 2026): 31 = prázdná váha / podtížení, 33 = zboží leželo na váze už při zadání ceny
  "31": "belowMin",
  "32": "overload",
  "33": "noZero",
};

export type Dialog06Message =
  | { kind: "ack" }
  | { kind: "nak" }
  | { kind: "status"; status: Dialog06Status; code: string; raw: string }
  | { kind: "data"; weight: string; unitPrice: string; total: string; raw: string };

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0x7f);
const digits = (n: number, len: number) => String(Math.max(0, Math.trunc(n))).padStart(len, "0").slice(-len);

/** Text pro displej váhy: bez diakritiky (7bitová linka), nejvýš 13 znaků. */
export function scaleText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .slice(0, 13);
}

/**
 * Cena za kg do váhy (v haléřích): záznam 01, s textem 04. S tárou v gramech (`tareGrams`) záznam 03 / 05 —
 * TEM EGE-M je odmítá (NAK), proto výchozí bez táry.
 */
export function encodeUnitPrice(priceCents: number, text?: string, tareGrams: number | null = null): Uint8Array {
  const price = digits(priceCents, 6);
  const t = text ? scaleText(text) : "";
  const body = tareGrams === null ? (t ? ["04", price, t] : ["01", price]) : t ? ["05", price, digits(tareGrams, 4), t] : ["03", price, digits(tareGrams, 4)];
  return Uint8Array.from([EOT, STX, ...body.flatMap((p, i) => (i ? [ESC, ...ascii(p)] : ascii(p))), ESC, ETX]);
}

/** Vymazat cenu ve váze (cena 000000). */
export const encodeClear = (): Uint8Array => encodeUnitPrice(0);

/** Dotaz na stav / hmotnost. */
export const encodeStatusRequest = (): Uint8Array => Uint8Array.from([EOT, ENQ]);

/** Po NAK na dotaz: proč — záznam 08 (váha odpoví záznamem 09 s kódem stavu). */
export const encodeStatusQuery = (): Uint8Array => Uint8Array.from([EOT, STX, ...ascii("08"), ETX]);

export const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

/** „00384“ (g) → „0.384“, „031900“ (haléře) → „319.00“ — jen vložení desetinné čárky do čísla z váhy. */
const decimalOf = (s: string, places: number) => {
  const d = s.replace(/\D/g, "").padStart(places + 1, "0");
  return `${String(Number(d.slice(0, -places)))}.${d.slice(-places)}`;
};

/**
 * Rozbor přijatých bajtů: první úplná zpráva a kolik bajtů spotřebovala (zbytek patří další zprávě).
 * null = zpráva ještě není celá.
 */
export function parseDialog06(bytes: number[]): { msg: Dialog06Message; used: number } | null {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === ACK) return { msg: { kind: "ack" }, used: i + 1 };
    if (b === NAK) return { msg: { kind: "nak" }, used: i + 1 };
    if (b !== STX) continue;
    const end = bytes.indexOf(ETX, i + 1);
    if (end < 0) return null;
    const frame = bytes.slice(i, end + 1);
    const parts = String.fromCharCode(...bytes.slice(i + 1, end)).split(String.fromCharCode(ESC));
    const raw = hex(frame);
    if (parts[0] === "02" && parts.length >= 5) {
      return { msg: { kind: "data", weight: decimalOf(parts[2], 3), unitPrice: decimalOf(parts[3], 2), total: decimalOf(parts[4], 2), raw }, used: end + 1 };
    }
    if (parts[0] === "09") {
      const code = (parts[1] ?? "").trim();
      return { msg: { kind: "status", status: STATUS[code] ?? "error", code, raw }, used: end + 1 };
    }
    return { msg: { kind: "status", status: "error", code: parts[0] ?? "", raw }, used: end + 1 };
  }
  return null;
}
