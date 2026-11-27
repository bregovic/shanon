"use client";

/**
 * Seznam záznamů objektu: lišta akcí + SmartGrid + šuplík.
 * Objekty s řádky (deník, doklad) se místo šuplíku otevírají na celé stránce.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  ToolbarDivider,
} from "@fluentui/react-components";
import { actionIcon } from "./action-icon";
import { PrintDialog, type PrintDialogLabels } from "./print-dialog";
import { printInFrame } from "@/lib/print-frame";
import { printHref } from "@/lib/station-print";
import type { ActionIcon as ActionIconName } from "@/core/object";
import { Add24Regular, ArrowClockwise24Regular, ArrowMinimize24Regular, ArrowDownload24Regular, Copy24Regular, Delete24Regular, Dismiss16Regular, Edit24Regular, Filter16Regular, Mail24Regular, Print24Regular, QuestionCircle24Regular, StarAdd16Regular, Stethoscope24Regular } from "@fluentui/react-icons";
import { DateInput } from "./date-input";
import { bulkRecordAction, deleteRecordsAction, duplicateRecordAction, mergeRecordsAction, runRecordAction } from "@/app/actions";
import { toast } from "./toast";
import { objectHref, type FieldMeta } from "@/lib/meta";
import type { UiLabels } from "@/server/ui";
import { DeleteDialog } from "./delete-dialog";
import { DocuRefButton } from "./docuref-panel";
import { FavoriteStar, FolderPicker, useFavorites } from "./favorites";
import { HistoryButton } from "./history-panel";
import { ImportButton } from "./import-dialog";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";
import { RecordDrawer } from "./record-drawer";
import type { FormGroup, Values } from "./record-form";
import { useShortcuts } from "./shortcuts";
import { goBack } from "@/lib/nav-back";
import { SmartGrid } from "./smart-grid";
import { StationDiag } from "./station-diag";

type Row = Record<string, unknown>;

export interface ObjectListProps {
  objectId: string;
  crumbs: { label: string; href?: string }[];
  label: string;
  titleField: string;
  columns: FieldMeta[];
  groups: FormGroup[];
  defaults: Values;
  canCreate: boolean;
  canWrite: boolean;
  canDelete: boolean;
  openInPage: boolean;
  initial: { rows: Row[]; total: number; totals?: Record<string, string> };
  /** záznam vybraný při otevření (proklik z odkazu) */
  focusId?: string;
  /** filtry z odkazu (?filter.pole=výraz) */
  initialFilters?: Record<string, string>;
  /** řazení z odkazu (uložený pohled) */
  initialSort?: { sort?: string; dir?: "asc" | "desc" };
  /** název otevřeného uloženého pohledu (?v=) */
  viewName?: string;
  /** Sloučit vybrané záznamy (ObjectDef.mergeable) */
  mergeable?: boolean;
  /** tlačítko v liště → dialog bez výběru záznamu (ObjectDef.listDialog) */
  listDialog?: { kind: "stationDiag"; label: string };
  /** akce nad víc vybranými záznamy (výpisy → deník HK) */
  bulkActions?: { id: string; label: string; icon?: ActionIconName; input?: { name: string; label: string; kind: "date" } }[];
  /** hromadný tisk vybraných dokladů (tisknutelný objekt): adresa `/print/<objekt>/batch` */
  printHref?: string;
  /** hromadné stažení souborů vybraných (ZIP): `/api/download/<objekt>/bulk/<akce>?ids=` */
  bulkDownloads?: { id: string; label: string }[];
  /** Tisk rovnou do tiskárny, bez náhledu (účtenka — `PrintableDef.directPrint`) */
  printDirect?: boolean;
  /** texty tiskového dialogu */
  printDialog?: PrintDialogLabels;
  /** objekt má akci Odeslat e-mailem (nabídne ji tiskový dialog u jednoho dokladu) */
  emailAction?: boolean;
  printLabel?: string;
  /** „Hotovo {ok} z {n}.“ */
  bulkDoneLabel?: string;
  /** návod k agendě (Nápověda) */
  helpHref?: string;
  helpLabel?: string;
  lang: string;
  labels: UiLabels;
}

export function ObjectListView(p: ObjectListProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Row[]>([]);
  const [reload, setReload] = useState(0);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; id: string | null; title: string; values?: Values; titles?: Record<string, string> }>({ open: false, id: null, title: "" });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<{ filters: Record<string, string>; sort?: string; dir: "asc" | "desc" }>({ filters: {}, dir: "asc" });
  const [clearKey, setClearKey] = useState(0);
  const [merge, setMerge] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  // ponechá se záznam s nejnižším kódem (stejně jako server)
  const mergeTarget = [...selected].sort((a, b) => String(a[p.titleField] ?? "").localeCompare(String(b[p.titleField] ?? ""), "cs", { numeric: true }))[0];
  const doMerge = async () => {
    setMergeBusy(true);
    const r = await mergeRecordsAction(p.objectId, selected.map((x) => String(x.id)));
    setMergeBusy(false);
    setMerge(false);
    if (!r.ok) setError(r.message);
    else {
      setError(undefined);
      setInfo(p.labels.views.merged.replace("{target}", r.data.title));
      setReload((n) => n + 1);
    }
  };
  const [saveView, setSaveView] = useState<{ name: string; folder: string } | null>(null);
  const fav = useFavorites();
  // filtry z menu (bez uloženého pohledu) patří ke stránce — „Filtrováno“ ukazuje jen ty navíc
  const baseFilters = useMemo(() => (p.viewName ? {} : (p.initialFilters ?? {})), [p.viewName, p.initialFilters]);
  // filtry navíc proti stránce (Zrušit filtry) a proti otevřenému pohledu (co uživatel změnil)
  const extra = Object.entries(view.filters).filter(([k, v]) => v && baseFilters[k] !== v);
  const changed = p.viewName ? Object.entries(view.filters).filter(([k, v]) => v && p.initialFilters?.[k] !== v) : extra;
  const colLabel = (k: string) => p.columns.find((c) => c.name === k)?.label ?? k;
  /** adresa pohledu: seznam + filtry + řazení */
  const viewHref = (name: string) => {
    const q = new URLSearchParams({ v: name });
    for (const [k, v] of Object.entries(view.filters)) if (v) q.set(`filter.${k}`, v);
    if (view.sort) {
      q.set("sort", view.sort);
      q.set("dir", view.dir);
    }
    return `${objectHref(p.objectId)}?${q}`;
  };
  const viewQuery = () => {
    const q = new URLSearchParams({ filters: JSON.stringify(view.filters), dir: view.dir });
    if (view.sort) q.set("sort", view.sort);
    return q.toString();
  };
  const exportHref = () => `/api/export/${p.objectId}?${viewQuery()}`;

  // nový záznam ze seznamu s filtrem z menu (např. deníky banky) dostane hodnoty filtru
  const preset = useMemo((): Record<string, string> => Object.fromEntries(Object.entries(p.initialFilters ?? {}).filter(([, v]) => /^[\p{L}\d_.-]+$/u.test(v))), [p.initialFilters]);
  const open = useCallback(
    (row: Row | null) => {
      if (p.openInPage) {
        const q = new URLSearchParams(Object.entries(preset).map(([k, v]) => [`set.${k}`, v]));
        router.push(objectHref(p.objectId, row ? String(row.id) : "new") + (!row && q.size ? `?${q}` : ""));
        return;
      }
      setDrawer({ open: true, id: row ? String(row.id) : null, title: row ? String(row[p.titleField] ?? p.label) : "", values: row ? undefined : { ...p.defaults, ...preset } });
    },
    [p.openInPage, p.objectId, p.titleField, p.label, p.defaults, preset, router],
  );

  // Duplikovat vybraný záznam: nový formulář s jeho hodnotami (klíč prázdný, číslo z řady při uložení);
  // doklad s řadou a řádky se zkopíruje rovnou a otevře
  const duplicate = async (row: Row) => {
    const r = await duplicateRecordAction(p.objectId, String(row.id));
    if (!r.ok || !r.data) return setError(r.ok ? undefined : r.message);
    setError(undefined);
    if ("id" in r.data) {
      if (p.openInPage) router.push(objectHref(p.objectId, r.data.id));
      else setDrawer({ open: true, id: r.data.id, title: p.label });
      setReload((n) => n + 1);
      return;
    }
    if (p.openInPage) router.push(`${objectHref(p.objectId, "new")}?copy=${row.id}`);
    else setDrawer({ open: true, id: null, title: "", values: { ...p.defaults, ...r.data.values }, titles: r.data.titles });
  };

  // standard: Shift+N nový, Shift+R obnovit, Shift+D smazat, Esc zpět na modul
  useShortcuts(
    {
      new: p.canCreate ? () => open(null) : undefined,
      refresh: () => setReload((n) => n + 1),
      delete: p.canDelete ? () => selected.length && setConfirm(true) : undefined,
      escape: () => goBack(router, p.crumbs[0]?.href),
    },
    !drawer.open && !confirm,
  );

  const [info, setInfo] = useState<string>();
  const [bulkBusy, setBulkBusy] = useState(false);
  // tiskový dialog: vybrané záznamy (null = zavřený)
  const [printing, setPrinting] = useState<string[] | null>(null);
  // akce se zadáním hodnoty: nejdřív dialog
  const [ask, setAsk] = useState<{ id: string; label: string; input: { name: string; label: string; kind: "date" }; value: string | null } | null>(null);
  const bulk = async (actionId: string, input?: Record<string, string>) => {
    setBulkBusy(true);
    // po jednom záznamu (vytěžení dokladu trvá desítky sekund) — průběh „3/10“
    const ids = selected.map((r) => String(r.id));
    const label = (ok: number) => (p.bulkDoneLabel ?? "{ok}/{n}").replace("{ok}", String(ok)).replace("{n}", String(ids.length));
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const res = await bulkRecordAction(p.objectId, [id], actionId, input);
      if (!res.ok) errors.push(res.message ?? "");
      else {
        ok += res.data.ok;
        errors.push(...res.data.errors);
      }
      setInfo(label(ok));
    }
    setBulkBusy(false);
    setError(errors.length ? [...new Set(errors)].join(" · ") : undefined);
    setInfo(label(ok));
    setReload((n) => n + 1);
  };

  const remove = async (ids: string[]) => {
    setConfirm(false);
    const res = await deleteRecordsAction(p.objectId, ids);
    if (!res.ok) setError(res.message);
    else {
      setError(undefined);
      setReload((n) => n + 1);
    }
  };

  return (
    <>
      <ActionBar>
        <Crumbs items={p.crumbs} />
        <FavoriteStar href={objectHref(p.objectId)} label={p.crumbs[p.crumbs.length - 1].label} />
        <Spacer />
        {p.canCreate && (
          <Button appearance="primary" icon={<Add24Regular />} title={`${p.labels.actions.new} (Shift+N)`} onClick={() => open(null)}>
            {p.labels.actions.new}
          </Button>
        )}
        {p.canCreate && (
          <Button icon={<Copy24Regular />} disabled={selected.length !== 1} onClick={() => void duplicate(selected[0])}>
            {p.labels.actions.duplicate}
          </Button>
        )}
        <Button icon={<Edit24Regular />} disabled={selected.length !== 1} onClick={() => open(selected[0])}>
          {p.labels.actions.edit}
        </Button>
        {p.canDelete && (
          <Button icon={<Delete24Regular />} title={`${p.labels.actions.delete} (Shift+D)`} disabled={selected.length === 0} onClick={() => setConfirm(true)}>
            {p.labels.actions.delete}
          </Button>
        )}
        {p.mergeable && p.canDelete && (
          <Button icon={<ArrowMinimize24Regular />} disabled={selected.length < 2} onClick={() => setMerge(true)}>
            {p.labels.views.merge}
          </Button>
        )}
        {(p.bulkActions ?? []).map((a) => (
          <Button key={a.id} icon={actionIcon(a)} disabled={!selected.length || bulkBusy} onClick={() => (a.input ? setAsk({ id: a.id, label: a.label, input: a.input, value: null }) : void bulk(a.id))}>
            {a.label}
          </Button>
        ))}
        {(p.bulkDownloads ?? []).map((a) => (
          <Button
            key={a.id}
            icon={<ArrowDownload24Regular />}
            disabled={!selected.length || selected.length > 100}
            onClick={() => (window.location.href = `/api/download/${p.objectId}/bulk/${a.id}?ids=${selected.map((x) => String(x.id)).join(",")}`)}
          >
            {a.label}
          </Button>
        ))}
        {p.printHref && (
          <Button
            icon={<Print24Regular />}
            disabled={!selected.length || selected.length > 100}
            onClick={() => {
              const ids = selected.map((x) => String(x.id));
              if (p.printDirect) {
                const href = `${p.printHref}?ids=${ids.join(",")}`;
                void printHref(href, () => printInFrame(href));
              }
              else setPrinting(ids);
            }}
          >
            {p.printLabel}
          </Button>
        )}
        {/* Odeslat e-mailem jeden vybraný doklad (i účtenka, která se tiskne rovnou bez tiskového dialogu) */}
        {p.emailAction && p.printDialog && (
          <Button
            icon={<Mail24Regular />}
            disabled={selected.length !== 1 || bulkBusy}
            onClick={async () => {
              const r = await runRecordAction(p.objectId, String(selected[0].id), "email");
              if (!r.ok) return toast(r.message, "warning");
              if (r.data?.message) toast(r.data.message, r.data.warn ? "warning" : "success");
              if (r.data?.open) router.push(r.data.open);
            }}
          >
            {p.printDialog.email}
          </Button>
        )}
        <ToolbarDivider />
        <DocuRefButton
          objectId={p.objectId}
          recordId={selected.length === 1 ? String(selected[0].id) : null}
          recordTitle={selected.length === 1 ? String(selected[0][p.titleField] ?? p.label) : ""}
          canWrite={p.canWrite}
          labels={p.labels.docuref}
        />
        <HistoryButton
          objectId={p.objectId}
          recordId={selected.length === 1 ? String(selected[0].id) : null}
          recordTitle={selected.length === 1 ? String(selected[0][p.titleField] ?? p.label) : ""}
          labels={p.labels.history}
        />
        {p.canCreate && <ImportButton objectId={p.objectId} labels={p.labels.importer} hasImages={p.columns.some((c) => c.image) || p.groups.some((g) => g.fields.some((f) => f.image))} onDone={() => setReload((n) => n + 1)} dataQuery={viewQuery} />}
        <Button appearance="subtle" icon={<ArrowDownload24Regular />} title={p.labels.export} aria-label={p.labels.export} onClick={() => (window.location.href = exportHref())} />
        <Button appearance="subtle" icon={<ArrowClockwise24Regular />} title={`${p.labels.actions.refresh} (Shift+R)`} onClick={() => setReload((n) => n + 1)}>
          {p.labels.actions.refresh}
        </Button>
        {p.listDialog && (
          <Button appearance="subtle" icon={<Stethoscope24Regular />} onClick={() => setListDialogOpen(true)}>
            {p.listDialog.label}
          </Button>
        )}
        {p.helpHref && <Button appearance="subtle" icon={<QuestionCircle24Regular />} title={p.helpLabel} aria-label={p.helpLabel} onClick={() => router.push(p.helpHref!)} />}
      </ActionBar>
      {p.listDialog && listDialogOpen && (
        <Dialog
          open
          onOpenChange={(_, d) => {
            if (d.open) return;
            setListDialogOpen(false);
            // diagnostika mohla založit zařízení / změnit tiskárny
            setReload((n) => n + 1);
          }}
        >
          <DialogSurface style={{ maxWidth: "min(760px, 96vw)" }}>
            <DialogBody>
              <DialogTitle>{p.listDialog.label}</DialogTitle>
              <DialogContent>
                <StationDiag />
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setListDialogOpen(false)}>{p.labels.actions.cancel}</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}

      <PageContent>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {info && !error && (
          <MessageBar intent="success">
            <MessageBarBody>{info}</MessageBarBody>
          </MessageBar>
        )}
        {(extra.length > 0 || p.viewName) && (
          <MessageBar intent="info" icon={<Filter16Regular />} style={{ marginBottom: 8 }}>
            <MessageBarBody>
              {p.viewName ? p.labels.views.opened.replace("{name}", p.viewName) : ""}
              {p.viewName && changed.length > 0 ? " · " : ""}
              {changed.length > 0 ? p.labels.views.filtered.replace("{fields}", changed.map(([k, v]) => `${colLabel(k)} ${v}`).join(", ")) : ""}
            </MessageBarBody>
            <MessageBarActions>
              {fav && (
                <Button size="small" icon={<StarAdd16Regular />} onClick={() => setSaveView({ name: p.viewName ?? p.crumbs[p.crumbs.length - 1].label, folder: "" })}>
                  {p.labels.views.save}
                </Button>
              )}
              {extra.length > 0 && (
                <Button size="small" icon={<Dismiss16Regular />} onClick={() => setClearKey((n) => n + 1)}>
                  {p.labels.views.clear}
                </Button>
              )}
            </MessageBarActions>
          </MessageBar>
        )}
        <SmartGrid
          objectId={p.objectId}
          columns={p.columns}
          lang={p.lang}
          labels={p.labels.grid}
          initial={p.initial}
          reloadKey={reload}
          storageKey={p.objectId}
          onOpen={open}
          titleField={p.titleField}
          focusId={p.focusId}
          initialFilters={p.initialFilters}
          initialSort={p.initialSort}
          clearKey={clearKey}
          baseFilters={baseFilters}
          onSelectionChange={setSelected}
          onViewChange={setView}
        />
      </PageContent>

      {p.printHref && p.printDialog && printing && (
        <PrintDialog
          open
          onClose={() => setPrinting(null)}
          src={`${p.printHref}?ids=${printing.join(",")}`}
          pdfHref={`${p.printHref.replace(/^\/print\//, "/api/pdf/")}?ids=${printing.join(",")}`}
          email={p.emailAction && printing.length === 1 ? { objectId: p.objectId, id: printing[0] } : null}
          labels={p.printDialog}
        />
      )}

      {merge && mergeTarget && (
        <Dialog open onOpenChange={(_, d) => !d.open && setMerge(false)}>
          <DialogSurface style={{ maxWidth: 520 }}>
            <DialogBody>
              <DialogTitle>{p.labels.views.mergeTitle}</DialogTitle>
              <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {selected.map((r) => (
                    <li key={String(r.id)} style={{ fontWeight: r === mergeTarget ? 600 : undefined }}>
                      {String(r[p.titleField] ?? "")} · {String(r.name ?? "")}
                    </li>
                  ))}
                </ul>
                <span>
                  {p.labels.views.mergeConfirm.replace("{target}", `${String(mergeTarget[p.titleField] ?? "")} · ${String(mergeTarget.name ?? "")}`).replace("{count}", String(selected.length - 1))}
                </span>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setMerge(false)}>{p.labels.views.cancel}</Button>
                <Button appearance="primary" disabled={mergeBusy} onClick={() => void doMerge()}>
                  {p.labels.views.merge}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {saveView && fav && (
        <Dialog open onOpenChange={(_, d) => !d.open && setSaveView(null)}>
          <DialogSurface style={{ maxWidth: 460 }}>
            <DialogBody>
              <DialogTitle>{p.labels.views.saveTitle}</DialogTitle>
              <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span>{p.labels.views.saveHint}</span>
                <Field label={p.labels.views.name} required>
                  <Input autoFocus value={saveView.name} onChange={(_, d) => setSaveView({ ...saveView, name: d.value })} />
                </Field>
                <FolderPicker label={p.labels.views.folder} hint={p.labels.views.folderHint} value={saveView.folder} onChange={(folder) => setSaveView({ ...saveView, folder })} />
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setSaveView(null)}>{p.labels.views.cancel}</Button>
                <Button
                  appearance="primary"
                  disabled={!saveView.name.trim()}
                  onClick={async () => {
                    const href = viewHref(saveView.name.trim());
                    await fav.save(href, saveView.name.trim(), saveView.folder);
                    setSaveView(null);
                    router.replace(href);
                    router.refresh();
                  }}
                >
                  {p.labels.views.saveButton}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {!p.openInPage && (
        <RecordDrawer
          objectId={p.objectId}
          id={drawer.id}
          open={drawer.open}
          title={drawer.title}
          groups={p.groups}
          defaults={drawer.values ?? p.defaults}
          defaultTitles={drawer.titles}
          readOnly={!p.canWrite}
          labels={p.labels.drawer}
          onClose={() => setDrawer((d) => ({ ...d, open: false }))}
          onSaved={() => {
            setDrawer((d) => ({ ...d, open: false }));
            setReload((n) => n + 1);
          }}
        />
      )}

      <Dialog open={!!ask} onOpenChange={(_, d) => !d.open && setAsk(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{ask?.label}</DialogTitle>
            <DialogContent>
              <Field label={ask?.input.label} required>
                <DateInput value={ask?.value} onChange={(v) => setAsk((x) => (x ? { ...x, value: v } : x))} autoFocus />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setAsk(null)}>{p.labels.views.cancel}</Button>
              <Button
                appearance="primary"
                disabled={!ask?.value}
                onClick={() => {
                  const a = ask!;
                  setAsk(null);
                  void bulk(a.id, { [a.input.name]: a.value! });
                }}
              >
                {ask?.label}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <DeleteDialog open={confirm} objectId={p.objectId} ids={selected.map((r) => String(r.id))} labels={p.labels.actions} onClose={() => setConfirm(false)} onConfirm={(ids) => void remove(ids)} />
    </>
  );
}
