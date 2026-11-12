/**
 * Převod definic objektů na popis pro UI (serializovatelný pro klientské komponenty).
 */
import "server-only";
import { objectHref, type FieldMeta } from "@/lib/meta";
import type { FieldDef, ObjectDef } from "@/core/object";
import { registry } from "@/registry";
import type { Ctx } from "./data";
import { extFields } from "./data";
import type { T } from "./i18n";
import { FILTER_HELP } from "@/core/filter";

export { objectHref, displayValue, type FieldMeta } from "@/lib/meta";

function meta(name: string, f: FieldDef, t: T, ext = false): FieldMeta {
  const e = f.edt;
  return {
    name,
    label: t(f.label ?? e.label),
    kind: e.kind,
    mandatory: !!f.mandatory,
    readOnly: !!f.readOnly,
    maxLength: e.maxLength,
    // standard: text vlevo, čísla vpravo, data na střed
    align: e.align ?? (e.kind === "int" || e.kind === "decimal" ? "right" : e.kind === "date" || e.kind === "datetime" || e.kind === "bool" ? "center" : "left"),
    options: e.enumId
      ? registry.enums.get(e.enumId)!.values.map((v) => ({ value: v.value, label: t(v.label) }))
      : undefined,
    refObject: e.refObject,
    refHref: e.refObject ? objectHref(e.refObject) : undefined,
    ext,
  };
}

export function fieldsMeta(ctx: Ctx, def: ObjectDef, t: T): Record<string, FieldMeta> {
  const out: Record<string, FieldMeta> = {};
  for (const [n, f] of Object.entries(def.fields)) out[n] = meta(n, f, t);
  for (const [n, f] of Object.entries(extFields(ctx, def.id))) out[n] = meta(n, f, t, true);
  return out;
}

/** Skupiny formuláře včetně skupiny polí rozšíření. */
export function formGroups(ctx: Ctx, def: ObjectDef, t: T, meta: Record<string, FieldMeta>, hide: string[] = []) {
  const groups = def.form.map((g) => ({ label: t(g.label), fields: g.fields.filter((n) => !hide.includes(n)).map((n) => meta[n]) }));
  const ext = Object.keys(extFields(ctx, def.id));
  if (ext.length) groups.push({ label: t("@SYS:ExtensionFields"), fields: ext.map((n) => meta[n]) });
  return groups;
}

/** Texty pro klientské komponenty (grid, šuplík, lišta akcí). */
export function uiLabels(t: T) {
  return {
    grid: {
      sortAsc: t("@SYS:SortAsc"),
      sortDesc: t("@SYS:SortDesc"),
      filterPlaceholder: t("@SYS:FilterPlaceholder"),
      filterOperators: t("@SYS:FilterOperators"),
      apply: t("@SYS:Apply"),
      clear: t("@SYS:Clear"),
      clearAll: t("@SYS:ClearAll"),
      loadMore: t("@SYS:LoadMore"),
      empty: t("@SYS:Empty"),
      records: t("@SYS:Records"),
      selected: t("@SYS:Selected"),
      help: FILTER_HELP.map(([code, label]) => [code, t(label)] as [string, string]),
    },
    drawer: { save: t("@SYS:Save"), cancel: t("@SYS:Cancel"), close: t("@SYS:Close"), newTitle: t("@SYS:New") },
    history: {
      history: t("@SYS:History"),
      noHistory: t("@SYS:NoHistory"),
      close: t("@SYS:Close"),
      actions: { create: t("@SYS:Created"), update: t("@SYS:Updated"), delete: t("@SYS:Deleted"), docuref: t("@SYS:AttachmentChange") },
    },
    favorites: { add: t("@SYS:AddFavorite"), remove: t("@SYS:RemoveFavorite") },
    export: t("@SYS:Export"),
    docuref: {
      attachments: t("@SYS:Attachments"),
      addNote: t("@SYS:AddNote"),
      uploadFile: t("@SYS:UploadFile"),
      noAttachments: t("@SYS:NoAttachments"),
      title: t("@SYS:Title"),
      note: t("@SYS:Notes"),
      save: t("@SYS:Save"),
      cancel: t("@SYS:Cancel"),
      close: t("@SYS:Close"),
      delete: t("@SYS:Delete"),
    },
    actions: {
      new: t("@SYS:New"),
      edit: t("@SYS:Edit"),
      delete: t("@SYS:Delete"),
      refresh: t("@SYS:Refresh"),
      save: t("@SYS:Save"),
      cancel: t("@SYS:Cancel"),
      saved: t("@SYS:Saved"),
      confirmDelete: t("@SYS:ConfirmDelete"),
    },
  };
}

export type UiLabels = ReturnType<typeof uiLabels>;
