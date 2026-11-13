/** Jednotkové testy jádra — bez databáze. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Edts } from "@/core/edt";
import { missingLabels, resolveLabel } from "@/core/labels";
import { fromCents, toCents } from "@/core/money";
import { UserError } from "@/core/module";
import { coerce } from "@/core/validate";
import { checkBalanced, journalLinesToPosting } from "@/modules/gl/posting";
import { labelFiles, labelTable, registry } from "@/registry";

describe("registr", () => {
  it("všechny labely existují ve všech jazycích", () => {
    expect(missingLabels(labelFiles)).toEqual([]);
  });

  it("každý label použitý v definicích je přeložený", () => {
    const used = new Set<string>();
    const add = (l?: string) => {
      if (l?.startsWith("@")) used.add(l);
    };
    for (const m of registry.modules.values()) {
      add(m.label);
      add(m.description);
      for (const g of m.menu) {
        add(g.label);
        g.items.forEach((i) => add(i.label));
      }
    }
    for (const e of registry.enums.values()) {
      add(e.label);
      e.values.forEach((v) => add(v.label));
    }
    for (const o of registry.objects.values()) {
      add(o.label);
      add(o.labelPlural);
      o.form.forEach((g) => add(g.label));
      o.lines?.forEach((l) => add(l.label));
      o.actions?.forEach((a) => add(a.label));
      for (const f of Object.values(o.fields)) {
        add(f.label);
        add(f.edt.label);
        add(f.edt.patternMessage);
      }
    }
    const missing = [...used].filter((l) => resolveLabel(labelTable, l, "cs") === l);
    expect(missing).toEqual([]);
  });

  it("každý label napsaný v kódu existuje", () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f));
    const found = new Set<string>();
    for (const f of files) {
      // bez komentářů (příklady v dokumentaci)
      const code = readFileSync(join("src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of code.matchAll(/"(@[A-Z0-9]+:[A-Za-z0-9]+)"/g)) found.add(m[1]);
    }
    const missing = [...found].filter((l) => resolveLabel(labelTable, l, "cs") === l);
    expect(missing).toEqual([]);
  });
});

describe("typy polí", () => {
  it("převádí a hlídá hodnoty", () => {
    expect(coerce(Edts.Code, " ab-1 ")).toEqual(["AB-1", null]);
    expect(coerce(Edts.Amount, "1 234,5")).toEqual(["1234.5", null]);
    expect(coerce(Edts.Amount, "1.234")[1]).toBe("@SYS:TooManyDecimals");
    expect(coerce(Edts.VatId, "cz12345678")).toEqual(["CZ12345678", null]);
    expect(coerce(Edts.RegNo, "12a")[1]).toBe("@SYS:InvalidRegNo");
    expect(coerce(Edts.TransDate, "2026-13-01")[1]).toBe("@SYS:InvalidDate");
    expect(coerce(Edts.NoYes, "on")).toEqual([true, null]);
  });

  it("peníze počítá v haléřích", () => {
    expect(toCents("10.5")).toBe(BigInt(1050));
    expect(toCents("-0.01")).toBe(BigInt(-1));
    expect(fromCents(BigInt(-1050))).toBe("-10.50");
    expect(() => toCents("1.234")).toThrow();
  });
});

describe("účtování", () => {
  it("nevyrovnaný doklad odmítne a řekne rozdíl", () => {
    try {
      checkBalanced([
        { accountId: "a", amount: "100.00" },
        { accountId: "b", amount: "-99.50" },
      ]);
      throw new Error("mělo selhat");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).params.diff).toBe("0.50");
    }
  });

  it("řádek deníku nesmí mít MD i D", () => {
    expect(() => journalLinesToPosting([{ accountId: "a", debit: "1", credit: "1" }])).toThrow(UserError);
    expect(journalLinesToPosting([{ accountId: "a", debit: "", credit: "5" }])[0].amount).toBe("-5.00");
  });
});

describe("evidence testování (docs/qa)", () => {
  it("scénáře a požadavky odkazují jen na existující funkce", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseCsv } = await import("@/server/import");
    const read = (f: string) => {
      const t = parseCsv(readFileSync(`docs/qa/${f}`, "utf8").replace(/^﻿/, ""));
      return t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i]])));
    };
    const codes = new Set(read("1-funkce.csv").map((r) => r["Kód"]));
    for (const f of ["2-scenare.csv", "3-pozadavky.csv"]) expect(read(f).map((r) => r["Funkce"]).filter((c) => c && !codes.has(c))).toEqual([]);
  });
});
