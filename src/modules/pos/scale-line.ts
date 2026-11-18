/**
 * Vážení na ověřené váze (Dialog 06): hodnoty přesně z váhy. Cena řádku = `total` z váhy — pokladna ji
 * nepřepočítává (WELMEC 2.2: pokladna, která nepočítá cenu). Ověří se jen, že cena za kg = ceník.
 */
export interface ScaleLine {
  weight: string;
  unitPrice: string;
  total: string;
  raw: string;
  weighedAt: string;
}
