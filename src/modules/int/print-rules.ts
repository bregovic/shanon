/**
 * Správa tisku: výběr tiskárny stanice pro doklad podle pravidel `int.printRule`. Bez importů registru
 * (volá ho i tisková sestava účtenky). Platí nejpřesnější pravidlo: uživatel > počítač, ze kterého se
 * tiskne > pokladna účtenky; mezi stejně přesnými rozhoduje název tiskárny.
 */
import type { DataApi, RecordData } from "@/core/module";
import type { PaperKind } from "@/core/print";

export interface PrintTarget {
  rule: RecordData;
  printer: RecordData;
  device: RecordData;
}

export interface PrintWho {
  /** počítač, ze kterého se tiskne (zástupce Shanon Pokladna) */
  stationId?: string | null;
  userId?: string | null;
  /** pokladna (účtenka); jinak se zjistí z účtenky */
  registerId?: string | null;
  recordId?: string | null;
}

export async function resolvePrintTarget(api: DataApi, docType: string, who: PrintWho = {}): Promise<PrintTarget | null> {
  const rules = await api.find("int.printRule", { docType, active: true }, { take: 200 });
  if (!rules.length) return null;
  let registerId = who.registerId ?? null;
  if (!registerId && docType === "pos.receipt" && who.recordId) {
    const rec = await api.get("pos.receipt", who.recordId).catch(() => null);
    registerId = rec?.registerId ? String(rec.registerId) : null;
  }
  const fits = rules.filter(
    (r) =>
      (!r.userId || (who.userId && r.userId === who.userId)) &&
      (!r.fromDeviceId || (who.stationId && r.fromDeviceId === who.stationId)) &&
      (!r.registerId || (registerId && r.registerId === registerId)),
  );
  if (!fits.length) return null;
  const printers = await api.find("int.devicePrinter", { id: { in: [...new Set(fits.map((r) => String(r.printerId)))] } }, { take: 200 });
  const devices = await api.find("int.device", { id: { in: [...new Set(printers.map((p) => String(p.deviceId)))] }, active: true }, { take: 200 });
  const score = (r: RecordData) => (r.userId ? 4 : 0) + (r.fromDeviceId ? 2 : 0) + (r.registerId ? 1 : 0);
  const cands = fits
    .map((rule) => {
      const printer = printers.find((p) => p.id === rule.printerId);
      const device = printer && devices.find((d) => d.id === printer.deviceId);
      return printer && device ? { rule, printer, device } : null;
    })
    .filter((x): x is PrintTarget => !!x)
    .sort((a, b) => score(b.rule) - score(a.rule) || String(a.printer.label).localeCompare(String(b.printer.label)));
  return cands[0] ?? null;
}

/** papír tiskárny stanice → role účtenky (A4 = bez role, výchozí rozvržení) */
export function devicePaperRoll(paper: unknown): PaperKind | null {
  return paper === "58" ? "receipt58" : paper === "80" ? "receipt80" : paper === "a6" ? "receiptA6" : null;
}

/** odhad papíru podle názvu tiskárny (XP-58, POS-80, TM-T20 …) */
export function guessPaper(name: string): "a4" | "80" | "58" {
  const n = name.toLowerCase();
  if (/58/.test(n)) return "58";
  if (/(^|[^0-9])80([^0-9]|$)|pos|receipt|thermal|tm-t|xp-|rp-|epson tm|star tsp|bixolon|účtenk/.test(n)) return "80";
  return "a4";
}
