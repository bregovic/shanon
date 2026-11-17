/** Pokladní váha: dotazy a rozbor odpovědí protokolů (bez hardwaru). */
import { describe, expect, it } from "vitest";
import { parseScale, scaleRequest } from "@/lib/scale";

const b = (s: string) => [...s].map((c) => c.charCodeAt(0));
const STX = "\x02";
const ETX = "\x03";

describe("pokladní váha", () => {
  it("dotazy podle protokolu", () => {
    expect([...scaleRequest("toledo8217")]).toEqual([0x57]);
    expect([...scaleRequest("casEcr")]).toEqual([0x05, 0x11]);
    expect([...scaleRequest("continuous")]).toEqual([]);
  });

  it("Toledo 8217: hmotnost, pohyb, neúplná odpověď", () => {
    expect(parseScale("toledo8217", b(`${STX}01.234\r`))).toEqual({ kg: 1.234, stable: true, status: "ok" });
    expect(parseScale("toledo8217", b(`${STX}000.452N\r`))).toEqual({ kg: 0.452, stable: true, status: "ok" });
    expect(parseScale("toledo8217", b(`${STX}?\x01\r`))).toEqual({ kg: null, stable: false, status: "motion" });
    expect(parseScale("toledo8217", b(`${STX}?\x04\r`))).toEqual({ kg: null, stable: false, status: "overload" });
    expect(parseScale("toledo8217", b(`${STX}01.2`))).toBe(null);
  });

  it("CAS ECR: ACK ustálená, NAK neustálená, gramy", () => {
    expect(parseScale("casEcr", b(`\x06${STX} 0.452kg${ETX}`))).toEqual({ kg: 0.452, stable: true, status: "ok" });
    expect(parseScale("casEcr", b(`\x15${STX} 0.450kg${ETX}`))).toEqual({ kg: 0.45, stable: false, status: "motion" });
    expect(parseScale("casEcr", b(`\x06${STX}S 1250 g${ETX}`))).toEqual({ kg: 1.25, stable: true, status: "ok" });
    expect(parseScale("casEcr", b("\x07"))).toEqual({ kg: null, stable: false, status: "motion" });
    expect(parseScale("casEcr", b(`\x06${STX} 0.4`))).toBe(null);
  });

  it("plynulé posílání: poslední celý řádek, ST/US/OL", () => {
    expect(parseScale("continuous", b("ST,GS,+  0.452kg\r\nST,GS,+  0.4"))).toEqual({ kg: 0.452, stable: true, status: "ok" });
    expect(parseScale("continuous", b("US,GS,+  0.460kg\r\n"))).toEqual({ kg: 0.46, stable: false, status: "motion" });
    expect(parseScale("continuous", b("OL,GS,+ 99.999kg\r\n"))).toEqual({ kg: null, stable: false, status: "overload" });
    expect(parseScale("continuous", b("ST,NT,+  1,050 kg\n"))).toEqual({ kg: 1.05, stable: true, status: "ok" });
    expect(parseScale("continuous", b("ST,GS,+  0.4"))).toBe(null);
  });
});
