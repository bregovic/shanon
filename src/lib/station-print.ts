/**
 * Tisk přes tiskovou stanici (klient): zkusí poslat doklady na tiskárnu stanice; když pro doklad žádná
 * není, vrátí false a volající tiskne z prohlížeče. Počítač se stanicí si pamatuje zástupce Shanon
 * Pokladna (/stanice?d=…) v úložišti prohlížeče.
 */
import { stationPrintAction } from "@/app/actions";
import { toast } from "@/components/toast";

export const STATION_KEY = "shanon.station";

export function stationId(): string | null {
  try {
    return localStorage.getItem(STATION_KEY);
  } catch {
    return null;
  }
}

/** true = odesláno na stanici (nebo chyba ohlášena), false = tisknout z prohlížeče. */
export async function printViaStation(docType: string, ids: string[], templateId?: string | null): Promise<boolean> {
  if (!ids.length) return false;
  const r = await stationPrintAction(docType, ids, stationId(), templateId ?? null).catch(() => null);
  if (!r) return false;
  if (!r.ok) {
    toast(r.message, "warning");
    return true;
  }
  if (!r.data) return false;
  toast(r.data.message, r.data.warn ? "warning" : "success");
  return true;
}

/** Doklad a id z adresy tiskové stránky (/print/<doklad>/<id> nebo /print/<doklad>/batch?ids=a,b). */
export function parsePrintHref(href: string): { docType: string; ids: string[]; templateId: string | null } | null {
  try {
    const u = new URL(href, "http://x");
    const m = /^\/print\/([a-z]+\.[A-Za-z]+)\/([^/]+)$/.exec(u.pathname);
    if (!m) return null;
    const ids = m[2] === "batch" ? (u.searchParams.get("ids") ?? "").split(",").filter(Boolean) : [m[2]];
    return { docType: m[1], ids, templateId: u.searchParams.get("template") };
  } catch {
    return null;
  }
}

/** Tisk tiskové stránky: přes stanici, jinak `fallback` (skrytý rám / tisk náhledu). */
export async function printHref(href: string, fallback: () => void | Promise<void>): Promise<void> {
  const p = parsePrintHref(href);
  if (p && (await printViaStation(p.docType, p.ids, p.templateId))) return;
  await fallback();
}
