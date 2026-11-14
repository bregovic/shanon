"use client";

/**
 * Detail záznamu na celé stránce — pro doklady s řádky a akcemi (deník,
 * účetní doklad). Hlavička je formulář, řádky jsou grid + šuplík.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  MessageBar,
  MessageBarBody,
  tokens,
  ToolbarDivider,
  Text,
} from "@fluentui/react-components";
import { Add24Regular, ArrowDownload24Regular, ArrowUpload24Regular, Copy24Regular, Delete24Regular, DocumentPdf24Regular, Edit24Regular, Open24Regular, Play24Regular, Print24Regular, Save24Regular } from "@fluentui/react-icons";
import { useRef } from "react";
import { deleteRecordsAction, runRecordAction, runUploadAction, saveRecordAction, duplicateRecordAction } from "@/app/actions";
import { objectHref, type FieldMeta } from "@/lib/meta";
import type { UiLabels } from "@/server/ui";
import { DocuRefButton } from "./docuref-panel";
import { HistoryButton } from "./history-panel";
import { ImportButton } from "./import-dialog";
import { InlineLines } from "./inline-lines";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";
import { RecordDrawer } from "./record-drawer";
import { RecordForm, type FormGroup, type Values } from "./record-form";
import { useShortcuts } from "./shortcuts";
import { goBack } from "@/lib/nav-back";
import { SmartGrid } from "./smart-grid";

type Row = Record<string, unknown>;

export interface LineSpec {
  objectId: string;
  field: string;
  label: string;
  titleField: string;
  columns: FieldMeta[];
  groups: FormGroup[];
  defaults: Values;
  editable: boolean;
  /** řádky jsou samostatné doklady — dvojklik otevře jejich stránku */
  overview: boolean;
  /** úprava přímo v mřížce (deník) */
  inline?: boolean;
  /** řádek má akce — dvojklik otevře jeho stránku */
  openInPage?: boolean;
  sortField?: string;
  initial: { rows: Row[]; total: number; totals?: Record<string, string> };
}

export interface ObjectDetailProps {
  objectId: string;
  id: string | null;
  crumbs: { label: string; href?: string }[];
  groups: FormGroup[];
  values: Values;
  titles: Record<string, string>;
  version?: number;
  recordTitle: string;
  readOnly: boolean;
  /** přílohy jdou přidávat i k zamčenému dokladu */
  canAttach: boolean;
  canDelete: boolean;
  /** Duplikovat (i zamčený doklad — kopie je nový koncept) */
  canDuplicate?: boolean;
  /** tisk podle šablony (Tiskové sestavy) */
  printHref?: string;
  /** hlavička jako kompaktní pruh (deník), řádky přes celou stránku */
  compactHeader?: boolean;
  /**
   * nový doklad s číselnou řadou a řádky: uloží se sám po vyplnění povinných
   * polí (výběr odběratele) — dostane číslo a hned jdou zadávat řádky
   */
  autoCreate?: boolean;
  /** text místo řádků u nového dokladu */
  newLinesHint?: string;
  actions: { id: string; label: string; upload?: string; download?: boolean; disabled?: boolean }[];
  /** Smazat se ukáže i u zamčeného dokladu (neaktivní) — rozložení lišty se nemění */
  showDelete?: boolean;
  lines: LineSpec[];
  /** související doklady (tlačítka v liště, neaktivní bez záznamů) */
  related?: { label: string; href: string; count: number }[];
  lang: string;
  labels: UiLabels;
}

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "20px 24px",
  },
  linesHead: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" },
  linesTitle: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, marginRight: "auto" },
});

function Lines({ spec, parentId, lang, labels }: { spec: LineSpec; parentId: string; lang: string; labels: UiLabels }) {
  const s = useStyles();
  const [selected, setSelected] = useState<Row[]>([]);
  const [reload, setReload] = useState(0);
  const [drawer, setDrawer] = useState<{ open: boolean; id: string | null; title: string }>({ open: false, id: null, title: "" });
  const [error, setError] = useState<string>();
  const router = useRouter();

  const open = (row: Row | null) =>
    setDrawer({ open: true, id: row ? String(row.id) : null, title: row ? String(row[spec.titleField] ?? spec.label) : "" });

  return (
    <section>
      <div className={s.linesHead}>
        <div className={s.linesTitle}>{spec.label}</div>
        {/* export řádků dokladu; import do vlastních řádků (rodič je pevný) */}
        {spec.editable && <ImportButton objectId={spec.objectId} labels={labels.importer} fixed={{ [spec.field]: parentId }} onDone={() => (setReload((n) => n + 1), router.refresh())} />}
        <Button
          appearance="subtle"
          icon={<ArrowDownload24Regular />}
          title={labels.export}
          aria-label={labels.export}
          onClick={() => (window.location.href = `/api/export/${spec.objectId}?filter=${encodeURIComponent(JSON.stringify({ [spec.field]: parentId }))}`)}
        />
        {spec.editable && !spec.inline && (
          <>
            <Button icon={<Add24Regular />} onClick={() => open(null)}>
              {labels.actions.new}
            </Button>
            <Button icon={<Edit24Regular />} disabled={selected.length !== 1} onClick={() => open(selected[0])}>
              {labels.actions.edit}
            </Button>
            <Button
              icon={<Delete24Regular />}
              disabled={selected.length === 0}
              onClick={async () => {
                const r = await deleteRecordsAction(spec.objectId, selected.map((x) => String(x.id)));
                if (!r.ok) setError(r.message);
                else {
                  setError(undefined);
                  setReload((n) => n + 1);
                  router.refresh();
                }
              }}
            >
              {labels.actions.delete}
            </Button>
          </>
        )}
      </div>
      {error && (
        <MessageBar intent="error" style={{ marginBottom: 8 }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {spec.inline ? (
        <InlineLines
          objectId={spec.objectId}
          parentField={spec.field}
          parentId={parentId}
          columns={spec.columns}
          defaults={spec.defaults}
          initial={spec.initial.rows}
          sortField={spec.sortField}
          readOnly={!spec.editable}
          lang={lang}
          labels={{ open: labels.drawer.open, remove: labels.actions.delete, total: labels.grid.total ?? "Σ", empty: labels.grid.empty ?? "" }}
          onChanged={() => router.refresh()}
        />
      ) : (
      <SmartGrid
        objectId={spec.objectId}
        columns={spec.columns}
        lang={lang}
        labels={labels.grid}
        initial={spec.initial}
        fixed={{ [spec.field]: parentId }}
        selectable={spec.editable}
        reloadKey={reload}
        maxHeight="420px"
        onOpen={spec.overview || spec.openInPage ? (row) => router.push(objectHref(spec.objectId, String(row.id))) : spec.editable ? open : undefined}
        onSelectionChange={setSelected}
      />
      )}
      {spec.editable && !spec.inline && (
        <RecordDrawer
          objectId={spec.objectId}
          id={drawer.id}
          open={drawer.open}
          title={drawer.title}
          groups={spec.groups}
          defaults={spec.defaults}
          fixed={{ [spec.field]: parentId }}
          labels={labels.drawer}
          onClose={() => setDrawer((d) => ({ ...d, open: false }))}
          onSaved={() => {
            setDrawer((d) => ({ ...d, open: false }));
            setReload((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}

/** Akce, která si vyžádá soubor (import výpisu apod.). */
function UploadButton({ label, accept, disabled, onFile }: { label: string; accept: string; disabled: boolean; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button icon={<ArrowUpload24Regular />} disabled={disabled} onClick={() => ref.current?.click()}>
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

export function ObjectDetailView(p: ObjectDetailProps) {
  const s = useStyles();
  const router = useRouter();
  const [values, setValues] = useState<Values>(p.values);
  const [titles, setTitles] = useState(p.titles);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ intent: "error" | "success"; text: string }>();
  const [busy, start] = useTransition();
  const [confirm, setConfirm] = useState(false);

  const save = (current: Values = values) =>
    start(async () => {
      const editable = p.groups.flatMap((g) => g.fields).filter((f) => !f.readOnly);
      const v: Values = {};
      for (const f of editable) v[f.name] = current[f.name] ?? null;
      const res = await saveRecordAction(p.objectId, p.id, v, p.version);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage({ intent: "error", text: res.message });
        return;
      }
      setErrors({});
      setMessage({ intent: "success", text: p.labels.actions.saved });
      if (!p.id) router.replace(objectHref(p.objectId, String(res.data.id)));
      else router.refresh();
    });

  // Duplikovat: doklad s řadou se zkopíruje i s řádky, jinak nový záznam s předvyplněnými hodnotami
  const duplicate = () =>
    start(async () => {
      const r = await duplicateRecordAction(p.objectId, p.id!);
      if (!r.ok || !r.data) return setMessage({ intent: "error", text: r.ok ? "" : r.message });
      router.push("id" in r.data ? objectHref(p.objectId, r.data.id) : `${objectHref(p.objectId, "new")}?copy=${p.id}`);
    });

  const act = (actionId: string) =>
    start(async () => {
      const res = await runRecordAction(p.objectId, p.id!, actionId);
      if (!res.ok) setMessage({ intent: "error", text: res.message });
      else {
        setMessage(undefined);
        router.refresh();
      }
    });

  const upload = (actionId: string, file: File) =>
    start(async () => {
      const fd = new FormData();
      fd.set("objectId", p.objectId);
      fd.set("id", p.id!);
      fd.set("actionId", actionId);
      fd.set("file", file);
      const res = await runUploadAction(fd);
      if (!res.ok) setMessage({ intent: "error", text: res.message });
      else {
        setMessage({ intent: "success", text: p.labels.actions.saved });
        router.refresh();
      }
    });

  const remove = () =>
    start(async () => {
      setConfirm(false);
      const res = await deleteRecordsAction(p.objectId, [p.id!]);
      if (!res.ok) setMessage({ intent: "error", text: res.message });
      else router.replace(objectHref(p.objectId));
    });

  // standard: Shift+S / Ctrl+S uložit, Shift+D smazat, Esc zpět na seznam
  // (když je otevřený šuplík řádku, zkratky patří jemu)
  const drawerOpen = () => !!document.querySelector(".fui-DrawerBody");
  useShortcuts(
    {
      save: !p.readOnly ? () => !drawerOpen() && save() : undefined,
      delete: p.canDelete ? () => !drawerOpen() && setConfirm(true) : undefined,
      // Esc = zpět tam, odkud uživatel přišel (třeba z faktury na dodavatele), jinak na seznam
      escape: () => goBack(router, p.crumbs[p.crumbs.length - 1]?.href),
    },
    !confirm,
  );

  return (
    <>
      <ActionBar>
        <Crumbs items={[...p.crumbs, { label: p.recordTitle }]} />
        <Spacer />
        {(!p.readOnly || p.id) && (
          <Button appearance="primary" icon={<Save24Regular />} title={`${p.labels.actions.save} (Shift+S)`} disabled={busy || p.readOnly} onClick={() => save()}>
            {p.labels.actions.save}
          </Button>
        )}
        {p.actions.map((a) =>
          a.download ? (
            <Button
              key={a.id}
              icon={<ArrowDownload24Regular />}
              disabled={busy || a.disabled}
              onClick={() => (window.location.href = `/api/download/${p.objectId}/${p.id}/${a.id}`)}
            >
              {a.label}
            </Button>
          ) : a.upload ? (
            <UploadButton key={a.id} label={a.label} accept={a.upload} disabled={busy || !!a.disabled} onFile={(f) => upload(a.id, f)} />
          ) : (
            <Button key={a.id} icon={<Play24Regular />} disabled={busy || a.disabled} onClick={() => act(a.id)}>
              {a.label}
            </Button>
          ),
        )}
        {(p.related ?? []).map((r) => (
          <Button key={r.href} icon={<Open24Regular />} disabled={!r.count} onClick={() => router.push(r.href)}>
            {`${r.label} (${r.count})`}
          </Button>
        ))}
        {p.printHref && (
          <Button icon={<Print24Regular />} onClick={() => window.open(p.printHref, "_blank")}>
            {p.labels.actions.print}
          </Button>
        )}
        {p.printHref && (
          <Button icon={<DocumentPdf24Regular />} onClick={() => window.open(p.printHref!.replace(/^\/print\//, "/api/pdf/"), "_blank")}>
            PDF
          </Button>
        )}
        {p.canDuplicate && p.id && (
          <Button icon={<Copy24Regular />} disabled={busy} onClick={duplicate}>
            {p.labels.actions.duplicate}
          </Button>
        )}
        {p.id && (
          <>
            <ToolbarDivider />
            <DocuRefButton objectId={p.objectId} recordId={p.id} recordTitle={p.recordTitle} canWrite={p.canAttach} labels={p.labels.docuref} />
            <HistoryButton objectId={p.objectId} recordId={p.id} recordTitle={p.recordTitle} labels={p.labels.history} />
          </>
        )}
        {(p.canDelete || p.showDelete) && (
          <>
            <ToolbarDivider />
            <Button icon={<Delete24Regular />} disabled={busy || !p.canDelete} onClick={() => setConfirm(true)}>
              {p.labels.actions.delete}
            </Button>
          </>
        )}
      </ActionBar>

      <PageContent>
        {message && (
          <MessageBar intent={message.intent}>
            <MessageBarBody>{message.text}</MessageBarBody>
          </MessageBar>
        )}
        <div className={s.card}>
          <RecordForm
            // kompaktní hlavička: všechna pole v jednom bloku, víc sloupců
            groups={p.compactHeader ? [{ label: "", fields: p.groups.flatMap((g) => g.fields) }] : p.groups}
            columns={p.compactHeader ? 4 : undefined}
            values={values}
            titles={titles}
            errors={errors}
            readOnly={p.readOnly}
            openLabel={p.labels.drawer.open}
            record={{ objectId: p.objectId, id: p.id, labels: p.labels.drawer.image }}
            onChange={(name, value, t) => {
              const next = { ...values, [name]: value };
              setValues(next);
              if (t !== undefined) setTitles((x) => ({ ...x, [name]: t }));
              setErrors((e) => ({ ...e, [name]: "" }));
              // nový doklad: výběrem v odkazu (odběratel) se hlavička uloží, když je vše povinné vyplněné
              if (p.autoCreate && !p.id && !busy && t !== undefined && value) {
                const fields = p.groups.flatMap((g) => g.fields).filter((f) => !f.readOnly);
                if (fields.every((f) => !f.mandatory || (next[f.name] !== null && next[f.name] !== undefined && next[f.name] !== ""))) save(next);
              }
            }}
          />
        </div>
        {!p.id && p.autoCreate && p.newLinesHint && <Text style={{ color: tokens.colorNeutralForeground3 }}>{p.newLinesHint}</Text>}
        {p.id &&
          p.lines.map((l) => (
            <Lines key={l.objectId} spec={l} parentId={p.id!} lang={p.lang} labels={p.labels} />
          ))}
      </PageContent>

      <Dialog open={confirm} onOpenChange={(_, d) => setConfirm(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{p.labels.actions.delete}</DialogTitle>
            <DialogContent>{p.labels.actions.confirmDelete.replace("{n}", "1")}</DialogContent>
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
