import { describe, expect, it } from "vitest";
import { fitRoll, flowGroups, layoutForPaper, PAPERS } from "@/core/print";
import { printCss } from "@/lib/print-render";
import { receiptLayoutA6, receiptPrintable } from "@/modules/prt/printables";

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

describe("účtenka na A6", () => {
  const data = (doc: Record<string, unknown>) => ({ company: { name: "Firma" }, doc: { number: "1", footer: "", ...doc }, lines: [] });
  const foot = (groups: ReturnType<typeof flowGroups>) => groups.find((g) => g.columns.some((c) => c.items.some((i) => i.el.id === "foot")))!;

  it("tiskárna s A6 dostane vlastní rozvržení místo neupravené výchozí šablony, upravená se přepočte", () => {
    const base = receiptPrintable.defaultLayout();
    expect(layoutForPaper(receiptPrintable, base, "receiptA6")).toEqual(receiptLayoutA6());
    const custom = { ...base, fontSize: 9 };
    const fit = layoutForPaper(receiptPrintable, custom, "receiptA6");
    expect(fit.paper).toBe("receiptA6");
    for (const e of fit.elements) expect(e.x + e.w).toBeLessThanOrEqual(PAPERS.receiptA6.w + 0.01);
    expect(printCss(fit)).toContain("size: 105mm 148mm");
  });

  it("QR platba vlevo, poděkování a poznámka neplátce vedle ní; bez QR přes celou šířku", () => {
    const layout = receiptLayoutA6();
    const withQr = foot(flowGroups(layout, data({ qr: "SPD*1.0", vs: "123", nonPayerNote: "Nejsem plátce DPH" })));
    expect(withQr.columns.map((c) => c.items.map((i) => i.el.id))).toEqual([["qr"], ["qrNote", "qrVs", "np", "foot"]]);
    const noQr = foot(flowGroups(layout, data({})));
    expect(noQr.columns).toHaveLength(1);
    expect(noQr.columns[0].x).toBe(0);
    expect(noQr.columns[0].items.map((i) => i.el.w)).toEqual([PAPERS.receiptA6.w]);
  });

  it("výchozí účtenka na roli se dál skládá pod sebe (jeden sloupec ve skupině)", () => {
    const layouts = [receiptPrintable.defaultLayout(), ...(receiptPrintable.legacyLayouts ?? [])];
    for (const l of [...layouts, ...layouts.map((l) => fitRoll(l, "receipt58"))])
      for (const g of flowGroups(l, data({ qr: "SPD*1.0", vs: "1", cashGiven: 100, rounding: 0.2, fik: "x", vatPayer: true }))) expect(g.columns).toHaveLength(1);
  });
});
