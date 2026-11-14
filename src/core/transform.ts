/**
 * Transformace = technické formáty, do kterých / ze kterých systém převádí
 * data (platební příkazy, výpisy, QR platba, čárové kódy). Registr v kódu
 * jako moduly; Správa systému → Transformace je jejich evidence (popis,
 * zapnutí) a platební metoda si z ní vybírá formát příkazu.
 */
export type TransformDirection = "export" | "import" | "print";
export type TransformPurpose = "paymentOrder" | "bankStatement" | "paymentQr" | "barcode";

export interface TransformDef {
  code: string;
  name: string;
  direction: TransformDirection;
  purpose: TransformPurpose;
  /** přípona a typ souboru (export / import) */
  ext?: string;
  mime?: string;
  description: string;
}

export const TRANSFORMS: TransformDef[] = [
  { code: "ABO", name: "ABO / KPC – tuzemský platební příkaz", direction: "export", purpose: "paymentOrder", ext: "kpc", mime: "text/plain; charset=windows-1250", description: "Hromadný příkaz k úhradě ve formátu ABO (KPC) pro české banky (KB, ČSOB, Fio, Raiffeisen…)." },
  { code: "SEPA", name: "SEPA – pain.001.001.03", direction: "export", purpose: "paymentOrder", ext: "xml", mime: "application/xml", description: "Platební příkaz SEPA (ISO 20022 pain.001.001.03) — EUR platby v SEPA i tuzemské platby bank, které XML podporují." },
  { code: "GPC", name: "GPC – bankovní výpis", direction: "import", purpose: "bankStatement", ext: "gpc", description: "Výpis z účtu ve formátu GPC/ABO (záznamy 074/075)." },
  { code: "SPAYD", name: "QR platba (SPAYD)", direction: "print", purpose: "paymentQr", description: "Short Payment Descriptor pro QR kód na faktuře — bankovní aplikace načte účet, částku a VS." },
  { code: "EAN13", name: "EAN-13", direction: "print", purpose: "barcode", description: "Čárový kód zboží (13 číslic s kontrolní číslicí)." },
];

export const transformByCode = (code: unknown) => TRANSFORMS.find((t) => t.code === code) ?? null;

/** Kontrolní číslice EAN-13 (z prvních 12 číslic). */
export function ean13Check(digits12: string): number {
  const d = digits12.replace(/\D/g, "").slice(0, 12).padStart(12, "0");
  const sum = [...d].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}
