/**
 * Síťová tiskárna Epson TM (ePOS-Print): kasa v prohlížeči (tablet) pošle tiskárně v místní síti stejné příkazy
 * ESC/POS jako přes USB (`receiptEscPos`: čeština, řez papíru, pokladní zásuvka) — zabalené v ePOS-Print XML
 * (`<command>` = surová data v hex). Tiskárna přijímá HTTPS (vlastní certifikát: v Chrome ho jednou potvrdit
 * otevřením https://<IP tiskárny>) a povoluje volání z webové stránky (CORS i přístup do místní sítě).
 */

const NS = "http://www.epson-pos.com/schemas/2011/03/epos-print";

export interface EposResult {
  ok: boolean;
  /** kód tiskárny (EPTR_COVER_OPEN, EPTR_REC_EMPTY…) nebo „network“ = tiskárna neodpovídá / nepotvrzený certifikát */
  code: string;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function envelope(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><epos-print xmlns="${NS}">${body}</epos-print></s:Body></s:Envelope>`;
}

/** adresa služby ePOS tiskárny (IP nebo název, volitelně :port) */
export function eposUrl(host: string, timeoutMs = 10000): string {
  return `https://${host.trim()}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=${timeoutMs}`;
}

async function post(host: string, body: string): Promise<EposResult> {
  let res: Response;
  try {
    res = await fetch(eposUrl(host), {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
      body: envelope(body),
      // Chrome: požadavek do místní sítě (tiskárna) ze stránky na internetu
      ...({ targetAddressSpace: "local" } as RequestInit),
    });
  } catch {
    return { ok: false, code: "network" };
  }
  const xml = await res.text().catch(() => "");
  const ok = /<response[^>]*success="true"/.test(xml);
  const code = /<response[^>]*code="([^"]*)"/.exec(xml)?.[1] ?? (res.ok ? "" : `HTTP ${res.status}`);
  return { ok, code };
}

/** Vytisknout data ESC/POS (účtenka, otevření zásuvky). */
export function eposPrint(host: string, bytes: Uint8Array): Promise<EposResult> {
  return post(host, `<command>${hex(bytes)}</command>`);
}

/** Je tiskárna dostupná? (prázdný požadavek – nic se netiskne) */
export function eposCheck(host: string): Promise<EposResult> {
  return post(host, "");
}
