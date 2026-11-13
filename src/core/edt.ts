/**
 * Datové typy polí (obdoba Extended Data Types v AX).
 *
 * Pole objektu nikdy nedefinuje typ, délku, label ani validaci samo —
 * odkazuje na typ. Změna typu (např. délka názvu) se tak projeví všude.
 */
import type { LabelRef } from "./labels";

export type FieldKind =
  | "string"
  | "text"
  | "int"
  | "decimal"
  | "bool"
  | "date"
  | "datetime"
  | "enum"
  | "ref";

export interface Edt {
  id: string;
  kind: FieldKind;
  label: LabelRef;
  help?: LabelRef;
  /** string: max. délka */
  maxLength?: number;
  /** decimal: celkem číslic / desetinných míst */
  precision?: number;
  scale?: number;
  /** string: regulární výraz pro validaci */
  pattern?: RegExp;
  patternMessage?: LabelRef;
  /** enum: id výčtu */
  enumId?: string;
  /** ref: id cílového objektu */
  refObject?: string;
  /** zobrazení v gridu */
  align?: "left" | "right" | "center";
  /** decimal: nesčítat v řádku Celkem (ceny, množství, částky v různých měnách) */
  noTotal?: boolean;
  /** převod vstupu (např. velká písmena u kódů) */
  transform?: "upper" | "trim";
}

export function defineEdt(edt: Edt): Edt {
  return edt;
}

/** Odvozený typ — převezme vše z rodiče a přepíše jen uvedené. */
export function extendEdt(base: Edt, patch: Partial<Edt> & { id: string }): Edt {
  return { ...base, ...patch };
}

export interface EnumDef {
  id: string;
  label: LabelRef;
  values: { value: string; label: LabelRef }[];
}

export function defineEnum(def: EnumDef): EnumDef {
  return def;
}

/** Typ pole odkazujícího na jiný objekt. */
export function refEdt(refObject: string, label: LabelRef, id = `Ref:${refObject}`): Edt {
  return { id, kind: "ref", label, refObject };
}

export function enumEdt(e: EnumDef, label: LabelRef = e.label): Edt {
  return { id: `Enum:${e.id}`, kind: "enum", label, enumId: e.id };
}

// ---------------------------------------------------------------------------
// Základní typy jádra
// ---------------------------------------------------------------------------

export const Edts = {
  Code: defineEdt({ id: "Code", kind: "string", label: "@SYS:Code", maxLength: 20, transform: "upper" }),
  Name: defineEdt({ id: "Name", kind: "string", label: "@SYS:Name", maxLength: 120, transform: "trim" }),
  Description: defineEdt({ id: "Description", kind: "string", label: "@SYS:Description", maxLength: 255 }),
  Notes: defineEdt({ id: "Notes", kind: "text", label: "@SYS:Notes" }),
  NoYes: defineEdt({ id: "NoYes", kind: "bool", label: "@SYS:Active" }),
  TransDate: defineEdt({ id: "TransDate", kind: "date", label: "@SYS:Date" }),
  Amount: defineEdt({ id: "Amount", kind: "decimal", label: "@SYS:Amount", precision: 18, scale: 2, align: "right" }),
  Qty: defineEdt({ id: "Qty", kind: "decimal", label: "@SYS:Qty", precision: 18, scale: 4, align: "right", noTotal: true }),
  /** cena za jednotku — nesčítá se */
  Price: defineEdt({ id: "Price", kind: "decimal", label: "@SYS:Price", precision: 18, scale: 2, align: "right", noTotal: true }),
  /** zůstatek (stav k okamžiku) — součet zůstatků nedává smysl */
  Balance: defineEdt({ id: "Balance", kind: "decimal", label: "@SYS:Balance", precision: 18, scale: 2, align: "right", noTotal: true }),
  /** částka v měně dokladu — v seznamu může být víc měn, nesčítá se */
  AmountCur: defineEdt({ id: "AmountCur", kind: "decimal", label: "@SYS:AmountCur", precision: 18, scale: 2, align: "right", noTotal: true }),
  Percent: defineEdt({ id: "Percent", kind: "decimal", label: "@SYS:Percent", precision: 7, scale: 4, align: "right" }),
  Int: defineEdt({ id: "Int", kind: "int", label: "@SYS:Number", align: "right" }),
  Email: defineEdt({
    id: "Email",
    kind: "string",
    label: "@SYS:Email",
    maxLength: 254,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    patternMessage: "@SYS:InvalidEmail",
    transform: "trim",
  }),
  Phone: defineEdt({ id: "Phone", kind: "string", label: "@SYS:Phone", maxLength: 30 }),
  CountryCode: defineEdt({
    id: "CountryCode",
    kind: "string",
    label: "@SYS:Country",
    maxLength: 2,
    pattern: /^[A-Z]{2}$/,
    transform: "upper",
  }),
  CurrencyCode: defineEdt({
    id: "CurrencyCode",
    kind: "string",
    label: "@SYS:Currency",
    maxLength: 3,
    pattern: /^[A-Z]{3}$/,
    transform: "upper",
  }),
  /** IČO */
  RegNo: defineEdt({
    id: "RegNo",
    kind: "string",
    label: "@SYS:RegNo",
    maxLength: 12,
    pattern: /^\d{6,12}$/,
    patternMessage: "@SYS:InvalidRegNo",
    transform: "trim",
  }),
  /** DIČ */
  VatId: defineEdt({
    id: "VatId",
    kind: "string",
    label: "@SYS:VatId",
    maxLength: 16,
    pattern: /^[A-Z]{2}[0-9A-Z]{2,14}$/,
    patternMessage: "@SYS:InvalidVatId",
    transform: "upper",
  }),
} as const;
