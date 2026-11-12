import { describe, expect, it } from "vitest";
import { parseFilter, parseSmartDate } from "@/core/filter";

const today = new Date(2026, 10, 12); // 12. 11. 2026

describe("filtry sloupců", () => {
  it("chytrá data", () => {
    expect(parseSmartDate("5", today)).toBe("2026-11-05");
    expect(parseSmartDate("1512", today)).toBe("2026-12-15");
    expect(parseSmartDate("15.12", today)).toBe("2026-12-15");
    expect(parseSmartDate("1.2.2025", today)).toBe("2025-02-01");
    expect(parseSmartDate("31.2", today)).toBeNull();
  });

  it("text", () => {
    expect(parseFilter("string", "alfa")).toEqual([{ op: "eq", value: "alfa", not: false }]);
    expect(parseFilter("string", "*alf*")).toEqual([{ op: "contains", value: "alf", not: false }]);
    expect(parseFilter("string", "al*")).toEqual([{ op: "starts", value: "al", not: false }]);
    expect(parseFilter("string", "*fa")).toEqual([{ op: "ends", value: "fa", not: false }]);
    expect(parseFilter("string", "a*b")).toEqual([{ op: "like", parts: ["a", "b"], not: false }]);
    expect(parseFilter("string", "!x, \"\"")).toEqual([
      { op: "eq", value: "x", not: true },
      { op: "empty", not: false },
    ]);
  });

  it("čísla a data", () => {
    expect(parseFilter("decimal", "> 100")).toEqual([{ op: "gt", value: "100" }]);
    expect(parseFilter("decimal", "10..20,5")).toEqual([
      { op: "range", from: "10", to: "20" },
      { op: "range", from: "5", to: "5" },
    ]);
    expect(parseFilter("date", "1.11..", today)).toEqual([{ op: "range", from: "2026-11-01", to: undefined }]);
    expect(parseFilter("date", "..15", today)).toEqual([{ op: "range", from: undefined, to: "2026-11-15" }]);
    expect(parseFilter("int", "abc")).toEqual([]);
    expect(parseFilter("bool", "ano")).toEqual([{ op: "bool", value: true }]);
  });
});
