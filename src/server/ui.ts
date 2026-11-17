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
    help: f.help ?? e.help ? t((f.help ?? e.help)!) : undefined,
    kind: e.kind,
    mandatory: !!f.mandatory,
    readOnly: !!f.readOnly,
    maxLength: e.maxLength,
    // standard: text vlevo, čísla vpravo, data na střed
    align: e.align ?? (e.kind === "int" || e.kind === "decimal" ? "right" : e.kind === "date" || e.kind === "datetime" || e.kind === "bool" ? "center" : "left"),
    options: e.enumId
      ? registry.enums.get(e.enumId)!.values.map((v) => ({ value: v.value, label: t(v.label), color: v.color }))
      : undefined,
    refObject: e.refObject,
    noTotal: e.noTotal,
    refHref: e.refObject ? objectHref(e.refObject) : undefined,
    refList: e.refObject ? !opensInPage(e.refObject) : undefined,
    ext,
    secret: f.secret,
    image: f.image,
    visibleWhen: f.visibleWhen,
    gridColumn: f.gridColumn,
    lookupFilter: f.lookupFilter,
    share: f.share ? { subject: t(f.share.subject), body: t(f.share.body), copyLabel: t("@SYS:CopyLink"), mailLabel: t("@SYS:SendLink"), openLabel: t("@SYS:OpenLink") } : undefined,
  };
}

/** Pole odkazující do vypnutého modulu se v UI nezobrazují. */
export const hiddenFields = (ctx: Ctx, def: ObjectDef) =>
  Object.entries(def.fields)
    .filter(
      ([, f]) =>
        (f.edt.refObject && !f.dimSlot && !ctx.modules.has(f.edt.refObject.split(".")[0])) ||
        // pole funkce jiného modulu (položka v e-shopu) jen se zapnutým modulem
        (f.module && !ctx.modules.has(f.module)) ||
        // dimenze bez aktivní dimenze na daném pořadí se nezobrazuje
        (f.dimSlot && !ctx.dims?.some((d) => d.slot === f.dimSlot)),
    )
    .map(([n]) => n);

export function fieldsMeta(ctx: Ctx, def: ObjectDef, t: T): Record<string, FieldMeta> {
  const out: Record<string, FieldMeta> = {};
  for (const [n, f] of Object.entries(def.fields)) {
    out[n] = meta(n, f, t);
    // popisek dimenze = její název v tenantovi (Středisko, Zakázka…)
    const dim = f.dimSlot ? ctx.dims?.find((d) => d.slot === f.dimSlot) : undefined;
    if (dim) out[n] = { ...out[n], label: dim.name };
  }
  for (const [n, f] of Object.entries(extFields(ctx, def.id))) out[n] = meta(n, f, t, true);
  return out;
}

/** Skupiny formuláře včetně skupiny polí rozšíření. */
export function formGroups(ctx: Ctx, def: ObjectDef, t: T, meta: Record<string, FieldMeta>, hide0: string[] = []) {
  const hide = [...hide0, ...hiddenFields(ctx, def)];
  const groups = def.form.map((g) => ({
    label: t(g.label),
    fields: g.fields.filter((n) => !hide.includes(n)).map((n) => meta[n]),
    visibleWhen: g.visibleWhen,
  }));
  const ext = Object.keys(extFields(ctx, def.id));
  if (ext.length) groups.push({ label: t("@SYS:ExtensionFields"), fields: ext.map((n) => meta[n]), visibleWhen: undefined });
  return groups;
}

/** Texty pro klientské komponenty (grid, šuplík, lišta akcí). */
export function uiLabels(t: T) {
  return {
    header: { show: t("@SYS:HeaderShow"), hide: t("@SYS:HeaderHide"), saveOpen: t("@SYS:HeaderSaveOpen") },
    dims: {
      title: t("@SYS:DimsTitle"),
      account: t("@SYS:DimsAccount"),
      offset: t("@SYS:DimsOffset"),
      ok: t("@SYS:Ok"),
      cancel: t("@SYS:Cancel"),
      hint: t("@SYS:DimsHint"),
      button: t("@SYS:DimsButton"),
      tab: t("@SYS:DimsTab"),
      none: t("@SYS:DimsNone"),
    },
    groups: { print: t("@SYS:GroupPrint"), inquiry: t("@SYS:GroupInquiry"), more: t("@SYS:GroupMore") },
    posting: {
      preview: t("@SYS:PostingPreview"),
      title: t("@SYS:PostingPreviewTitle"),
      hint: t("@SYS:PostingPreviewHint"),
      empty: t("@SYS:PostingPreviewEmpty"),
      tax: t("@SYS:PostingPreviewTax"),
      account: t("@SYS:PostingAccount"),
      debit: t("@SYS:PostingDebit"),
      credit: t("@SYS:PostingCredit"),
      text: t("@SYS:PostingText"),
      taxCode: t("@SYS:PostingTaxCode"),
      base: t("@SYS:PostingBase"),
      taxAmount: t("@SYS:PostingTaxAmount"),
      close: t("@SYS:Close"),
    },
    views: {
      filtered: t("@SYS:Filtered"),
      clear: t("@SYS:ClearFilters"),
      save: t("@SYS:SaveView"),
      saveButton: t("@SYS:Save"),
      saveTitle: t("@SYS:SaveViewTitle"),
      saveHint: t("@SYS:SaveViewHint"),
      name: t("@SYS:Name"),
      folder: t("@SYS:FavoriteFolder"),
      folderHint: t("@SYS:FavoriteFolderHint"),
      cancel: t("@SYS:Cancel"),
      opened: t("@SYS:ViewOpened"),
    },
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
      total: t("@SYS:Total"),
      linesUnbalanced: t("@SYS:LinesUnbalanced"),
      linesBalanced: t("@SYS:LinesBalanced"),
      linesKeys: t("@SYS:LinesKeys"),
      select: t("@SYS:Select"),
      selectAll: t("@SYS:SelectAll"),
      removeSelected: t("@SYS:RemoveSelected"),
      clearSelection: t("@SYS:ClearSelection"),
      newLine: t("@SYS:NewLine"),
      linesTab: t("@SYS:LinesTab"),
      lineOf: t("@SYS:LineOf"),
      detailKeys: t("@SYS:DetailKeys"),
      help: FILTER_HELP.map(([code, label]) => [code, t(label)] as [string, string]),
    },
    drawer: {
      save: t("@SYS:Save"),
      cancel: t("@SYS:Cancel"),
      close: t("@SYS:Close"),
      newTitle: t("@SYS:New"),
      open: t("@SYS:Open"),
      duplicate: t("@SYS:DuplicateRecord"),
      unsaved: { title: t("@SYS:UnsavedTitle"), text: t("@SYS:UnsavedText"), save: t("@SYS:Save"), discard: t("@SYS:UnsavedDiscard"), back: t("@SYS:Cancel") },
      image: { upload: t("@SYS:ImageUpload"), remove: t("@SYS:ImageRemove"), drop: t("@SYS:ImageDrop"), afterSave: t("@SYS:ImageAfterSave") },
    },
    history: {
      history: t("@SYS:History"),
      noHistory: t("@SYS:NoHistory"),
      close: t("@SYS:Close"),
      actions: { create: t("@SYS:Created"), update: t("@SYS:Updated"), delete: t("@SYS:Deleted"), docuref: t("@SYS:AttachmentChange") },
    },
    favorites: { add: t("@SYS:AddFavorite"), remove: t("@SYS:RemoveFavorite") },
    export: t("@SYS:Export"),
    importer: {
      import: t("@SYS:Import"),
      title: t("@SYS:ImportTitle"),
      help: t("@SYS:ImportHelp"),
      template: t("@SYS:ImportTemplate"),
      templateData: t("@SYS:ImportTemplateData"),
      check: t("@SYS:ImportCheck"),
      run: t("@SYS:ImportRun"),
      columns: t("@SYS:ImportColumns"),
      ignored: t("@SYS:ImportIgnored"),
      computed: t("@SYS:ImportComputed"),
      missing: t("@SYS:ImportMissing"),
      row: t("@SYS:ImportRow"),
      column: t("@SYS:ImportColumn"),
      message: t("@SYS:ImportMessage"),
      checkOk: t("@SYS:ImportCheckOk"),
      done: t("@SYS:ImportDone"),
      failed: t("@SYS:ImportFailed"),
      close: t("@SYS:Close"),
      images: t("@SYS:ImportImages"),
      imagesCount: t("@SYS:ImportImagesCount"),
      imagesFolder: t("@SYS:ImportImagesFolder"),
      imagesFiles: t("@SYS:ImportImagesFiles"),
      warnings: t("@SYS:ImportWarnings"),
    },
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
      print: t("@PRT:Print"),
      duplicate: t("@SYS:DuplicateRecord"),
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

/** Otevírá se záznam objektu na celé stránce (doklad s řádky nebo akcemi), nebo v šuplíku nad seznamem? */
export function opensInPage(objectId: string): boolean {
  const d = registry.objects.get(objectId);
  return !d || !!d.lines?.length || !!d.actions?.length || !!d.systemOnly;
}
