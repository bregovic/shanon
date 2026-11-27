/**
 * Tisk přes tiskovou stanici (klient): zkusí poslat doklady na tiskárnu stanice; když pro doklad žádná
 * není, vrátí false a volající tiskne z prohlížeče. Počítač se stanicí si pamatuje zástupce Shanon
 * Pokladna (/stanice?d=…) v úložišti prohlížeče.
 */
import { posNetPrintAction, stationPrintAction } from "@/app/actions";
import { toast } from "@/components/toast";
import { eposPrint } from "@/lib/epos";

export const STATION_KEY = "shanon.station";

export function stationId(): string | null {
  try {
    return localStorage.getItem(STATION_KEY);
  } catch {
    return null;
  }
}

/**
 * Účtenky pokladny se síťovou tiskárnou Epson (napojení Epson v síti): rovnou na tiskárnu přes ePOS.
 * true = vytištěno; false = pokladna síťovou tiskárnu nemá nebo tiskárna neodpověděla (tiskne se jinak).
 */
async function printViaNetwork(ids: string[]): Promise<boolean> {
  const r = await posNetPrintAction(ids).catch(() => null);
  if (!r?.ok || !r.data.jobs.length) return false;
  let done = 0;
  for (const j of r.data.jobs) {
    const bytes = Uint8Array.from(atob(j.data), (c) => c.charCodeAt(0));
    const res = await eposPrint(j.host, bytes);
    if (!res.ok) {
      toast(res.code === "network" ? r.data.down.replace(/\{host\}/g, j.host) : `${j.host}: ${res.code}`, "warning");
      return false;
    }
    done += j.count;
  }
  toast(r.data.ok.replace("{n}", String(done)), "success");
  return true;
}

/** true = odesláno na stanici (nebo chyba ohlášena), false = tisknout z prohlížeče. */
export async function printViaStation(docType: string, ids: string[], templateId?: string | null): Promise<boolean> {
  if (!ids.length) return false;
  // účtenky: síťová tiskárna pokladny (bez vlastní šablony – ta se tiskne jako stránka)
  if (docType === "pos.receipt" && !templateId && (await printViaNetwork(ids))) return true;
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
