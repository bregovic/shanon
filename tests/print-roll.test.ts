import { describe, expect, it } from "vitest";
import { fitRoll, PAPERS } from "@/core/print";
import { receiptPrintable } from "@/modules/prt/printables";

describe("účtenka na roli tiskárny", () => {
  it("šablona 80 mm se na 58mm roli vejde do 48 mm a písmo zůstane čitelné", () => {
    const base = receiptPrintable.defaultLayout();
    expect(base.paper).toBe("receipt80");
    const fit = fitRoll(base, "receipt58");
    expect(fit.paper).toBe("receipt58");
    for (const e of fit.elements) {
      expect(e.x + e.w).toBeLessThanOrEqual(PAPERS.receipt58.w + 0.01);
      for (const c of e.columns ?? []) expect(c.width).toBeGreaterThan(0);
      if (e.style?.size) expect(e.style.size).toBeGreaterThanOrEqual(6);
    }
    const cols = (e: (typeof fit.elements)[number]) => (e.columns ?? []).reduce((a, c) => a + c.width, 0);
    const table = fit.elements.find((e) => e.type === "table")!;
    expect(cols(table)).toBeLessThanOrEqual(table.w + 0.05);
    expect(fit.fontSize).toBeLessThan(base.fontSize);
  });
  it("stejná role, A4 nebo bez tiskárny = beze změny", () => {
    const base = receiptPrintable.defaultLayout();
    expect(fitRoll(base, "receipt80")).toBe(base);
    expect(fitRoll(base, null)).toBe(base);
    expect(fitRoll({ ...base, paper: "a4" }, "receipt58").paper).toBe("a4");
  });
});
