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
import { Add24Regular, ArrowClockwise24Regular, ArrowDownload24Regular, Copy24Regular, Delete24Regular, Dismiss16Regular, Edit24Regular, Filter16Regular, Play24Regular, QuestionCircle24Regular, StarAdd16Regular } from "@fluentui/react-icons";
import { bulkRecordAction, deleteRecordsAction, duplicateRecordAction } from "@/app/actions";
import { objectHref, type FieldMeta } from "@/lib/meta";
import type { UiLabels } from "@/server/ui";
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
  /** akce nad víc vybranými záznamy (výpisy → deník HK) */
  bulkActions?: { id: string; label: string }[];
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
  const [drawer, setDrawer] = useState<{ open: boolean; id: string | null; title: string; values?: Values; titles?: Record<string, string> }>({ open: false, id: null, title: "" });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<{ filters: Record<string, string>; sort?: string; dir: "asc" | "desc" }>({ filters: {}, dir: "asc" });
  const [clearKey, setClearKey] = useState(0);
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
  const bulk = async (actionId: string) => {
    setBulkBusy(true);
    // po jednom záznamu (vytěžení dokladu trvá desítky sekund) — průběh „3/10“
    const ids = selected.map((r) => String(r.id));
    const label = (ok: number) => (p.bulkDoneLabel ?? "{ok}/{n}").replace("{ok}", String(ok)).replace("{n}", String(ids.length));
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const res = await bulkRecordAction(p.objectId, [id], actionId);
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

  const remove = async () => {
    setConfirm(false);
    const res = await deleteRecordsAction(p.objectId, selected.map((r) => String(r.id)));
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
        {(p.bulkActions ?? []).map((a) => (
          <Button key={a.id} icon={<Play24Regular />} disabled={!selected.length || bulkBusy} onClick={() => void bulk(a.id)}>
            {a.label}
          </Button>
        ))}
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
        {p.helpHref && <Button appearance="subtle" icon={<QuestionCircle24Regular />} title={p.helpLabel} aria-label={p.helpLabel} onClick={() => router.push(p.helpHref!)} />}
      </ActionBar>

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

      <Dialog open={confirm} onOpenChange={(_, d) => setConfirm(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{p.labels.actions.delete}</DialogTitle>
            <DialogContent>{p.labels.actions.confirmDelete.replace("{n}", String(selected.length))}</DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(false)}>{p.labels.actions.cancel}</Button>
              <Button appearance="primary" onClick={remove}>
                {p.labels.actions.delete}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
