/** Kód nové firmy ze zkratky názvu (4 znaky, jedinečný). */
import { describe, expect, it } from "vitest";
import { companyCodeFromName } from "@/modules/org/company-code";

describe("kód firmy z názvu", () => {
  it("zkratka bez právní formy a diakritiky, doplněná z prvního slova", () => {
    expect(companyCodeFromName("Uzeniny Hynek Cibulka s.r.o.")).toBe("UHCZ");
    expect(companyCodeFromName("Shanon a.s.")).toBe("SHAN");
    expect(companyCodeFromName("Uzenářství s.r.o.")).toBe("UZEN");
    expect(companyCodeFromName("Restaurace U Lípy, spol. s r.o.")).toBe("RULE");
    expect(companyCodeFromName("ABC Plus Servis Česko Morava")).toBe("APSC");
    expect(companyCodeFromName("Jan Novák")).toBe("JNAN");
    expect(companyCodeFromName("---")).toBe("FIRM");
  });
  it("obsazený kód dostane číslo", () => {
    expect(companyCodeFromName("Shanon a.s.", ["SHAN"])).toBe("SHA2");
    expect(companyCodeFromName("Shanon a.s.", ["shan", "SHA2", "SHA3"])).toBe("SHA4");
    expect(companyCodeFromName("Shanon a.s.", ["SHAN", ...Array.from({ length: 8 }, (_, i) => `SHA${i + 2}`)])).toBe("SH10");
  });
});
