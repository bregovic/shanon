/** Pole kopie číselníku ze Společných dat (DAT) — `ObjectDef.datLayer`. */
import { defineEdt, Edts } from "./edt";
import type { FieldDef } from "./object";

export const DAT_FIELDS: Record<string, FieldDef> = {
  /** záznam DAT, ze kterého kopie vznikla */
  datSourceId: { edt: defineEdt({ id: "DatSource", kind: "string", label: "@SYS:DatSource", maxLength: 36 }), readOnly: true },
  /** firma kopii upravila = vlastní záznam, změny z DAT ho nepřepíší */
  datLocal: { edt: Edts.NoYes, label: "@SYS:DatLocal", readOnly: true },
};
