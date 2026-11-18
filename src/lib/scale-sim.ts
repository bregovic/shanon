/**
 * Simulátor váhy Dialog 06 (testovací prostředí, napojení TEST-SCALE): chová se jako váha na úrovni bajtů —
 * přijímá rámce z `dialog06.ts` a odpovídá rámci, takže se v testu projde kodek i ScaleDriver.
 *
 * Jen tady se počítá cena (hmotnost × cena za kg) — simulátor hraje roli VÁHY, která cenu počítá.
 * Pokladna (driver, panel, server) cenu váženého zboží nepočítá nikdy.
 *
 * Scénář: po nastavení ceny chvíli prázdná váha (0,000), pak „položené zboží“ — 2 dotazy neustáleno,
 * pak ustálená hmotnost 0,100–1,500 kg. Po vymazání ceny se zboží za 1,5 s „sundá“ (zpět 0,000).
 */
import { ACK, ENQ, ESC, ETX, NAK, STX, parseDialog06, type Dialog06Message } from "./dialog06";
import type { ScaleTransport } from "./scale-driver";

const frame = (...parts: string[]) => [STX, ...parts.flatMap((p, i) => (i ? [ESC, ...[...p].map((c) => c.charCodeAt(0))] : [...p].map((c) => c.charCodeAt(0)))), ETX];

export class SimScaleTransport implements ScaleTransport {
  private priceCents = 0;
  private grams = 0;
  private unstableLeft = 0;
  private placeAt = 0;
  private removeAt = 0;

  async open() {
    await new Promise((r) => setTimeout(r, 150));
  }
  async close() {}

  /** příchozí rámec pokladny → odpověď váhy (jako bajty), pak rozbor stejným kodekem jako u skutečné váhy */
  async exchange(req: Uint8Array, timeoutMs: number): Promise<Dialog06Message | null> {
    await new Promise((r) => setTimeout(r, Math.min(60, timeoutMs)));
    const b = Array.from(req);
    const now = Date.now();
    if (this.removeAt && now >= this.removeAt) (this.grams = 0), (this.removeAt = 0);
    // dotaz na stav: EOT ENQ
    if (b.length === 2 && b[1] === ENQ) {
      if (!this.priceCents) return parseDialog06(frame("09", "32"))!.msg; // bez ceny
      if (!this.grams && this.placeAt && now >= this.placeAt) {
        this.grams = 100 + Math.floor(Math.random() * 1400);
        this.unstableLeft = 2;
        this.placeAt = 0;
      }
      if (!this.grams) return parseDialog06(frame("02", "3", "00000", String(this.priceCents).padStart(6, "0"), "000000"))!.msg;
      if (this.unstableLeft-- > 0) return parseDialog06(frame("09", "20"))!.msg;
      // VÁHA počítá cenu (simulace stanoveného měřidla)
      const total = Math.round((this.grams * this.priceCents) / 1000);
      return parseDialog06(frame("02", "3", String(this.grams).padStart(5, "0"), String(this.priceCents).padStart(6, "0"), String(total).padStart(6, "0")))!.msg;
    }
    // cena za kg: EOT STX "01"|"04" ESC cena ESC … ETX
    const text = String.fromCharCode(...b.filter((x) => x >= 0x20 && x < 0x7f && x !== ESC));
    const m = /^(01|04)(\d{6})/.exec(text);
    if (!m) return parseDialog06([NAK])!.msg;
    this.priceCents = Number(m[2]);
    if (this.priceCents) {
      // nové zboží se „položí“ chvíli po nastavení ceny (jen když je váha prázdná)
      if (!this.grams || this.removeAt) this.placeAt = Math.max(now, this.removeAt) + 700;
    } else if (this.grams) this.removeAt = now + 1500; // vymazáno → zboží se sundá
    return parseDialog06([ACK])!.msg;
  }
}
