/**
 * Převod a validace hodnot podle typů polí. Sdílí ho server (uložení)
 * i testy; formulář posílá hodnoty jako text.
 */
import type { Edt } from "./edt";
import type { LabelRef } from "./labels";
import type { RecordData, Registry, ValidationErrors } from "./module";
import type { FieldDef, ObjectDef } from "./object";

export interface Normalized {
  data: RecordData;
  errors: ValidationErrors;
}

const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Převede jednu hodnotu na typ pole. Vrací [hodnota, chyba]. */
export function coerce(
  edt: Edt,
  raw: unknown,
  reg?: Registry,
): [unknown, LabelRef | null] {
  if (empty(raw)) return [edt.kind === "bool" ? false : null, null];
  switch (edt.kind) {
    case "string":
    case "text": {
      let s = String(raw);
      if (edt.transform === "upper") s = s.trim().toUpperCase();
      else if (edt.transform === "trim") s = s.trim();
      if (edt.maxLength && s.length > edt.maxLength) return [s, "@SYS:TooLong"];
      if (edt.pattern && !edt.pattern.test(s)) return [s, edt.patternMessage ?? "@SYS:InvalidFormat"];
      return [s, null];
    }
    case "int": {
      const n = Number(String(raw).replace(/\s/g, ""));
      return Number.isInteger(n) ? [n, null] : [raw, "@SYS:InvalidNumber"];
    }
    case "decimal": {
      const s = String(raw).replace(/\s/g, "").replace(",", ".");
      if (!/^-?\d+(\.\d+)?$/.test(s)) return [raw, "@SYS:InvalidNumber"];
      const [, frac = ""] = s.split(".");
      if (edt.scale !== undefined && frac.replace(/0+$/, "").length > edt.scale)
        return [raw, "@SYS:TooManyDecimals"];
      return [s, null]; // decimal držíme jako text, ať se neztratí přesnost
    }
    case "bool":
      return [raw === true || raw === "true" || raw === "on" || raw === "1", null];
    case "date": {
      const s = String(raw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return [raw, "@SYS:InvalidDate"];
      return [s, null];
    }
    case "datetime": {
      const d = new Date(String(raw));
      return Number.isNaN(d.getTime()) ? [raw, "@SYS:InvalidDate"] : [d.toISOString(), null];
    }
    case "enum": {
      const s = String(raw);
      const e = reg?.enums.get(edt.enumId!);
      if (e && !e.values.some((v) => v.value === s)) return [raw, "@SYS:InvalidValue"];
      return [s, null];
    }
    case "ref":
      return [String(raw), null];
  }
}

/** Normalizuje vstup podle polí objektu (+ pole rozšíření). Neznámá pole zahodí. */
export function normalizeRecord(
  def: ObjectDef,
  input: RecordData,
  reg?: Registry,
  extFields: Record<string, FieldDef> = {},
): Normalized & { ext: RecordData } {
  const data: RecordData = {};
  const ext: RecordData = {};
  const errors: ValidationErrors = {};
  const run = (fields: Record<string, FieldDef>, target: RecordData) => {
    for (const [name, f] of Object.entries(fields)) {
      if (f.readOnly) continue;
      if (!(name in input)) continue;
      const [v, err] = coerce(f.edt, input[name], reg);
      if (err) errors[name] = err;
      // pole s číselnou řadou doplní číslování, prázdné tedy nevadí
      else if (f.mandatory && (v === null || v === "") && def.numberSeq?.field !== name) errors[name] = "@SYS:Required";
      target[name] = v;
    }
  };
  run(def.fields, data);
  run(extFields, ext);
  return { data, ext, errors };
}

/** Povinná pole chybějící při založení nového záznamu. */
export function missingMandatory(def: ObjectDef, data: RecordData): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const [name, f] of Object.entries(def.fields)) {
    if (!f.mandatory || f.readOnly) continue;
    if (def.numberSeq?.field === name) continue;
    if (empty(data[name])) errors[name] = "@SYS:Required";
  }
  return errors;
}
