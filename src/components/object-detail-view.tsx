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
} from "@fluentui/react-components";
import { Add24Regular, ArrowDownload24Regular, ArrowUpload24Regular, Delete24Regular, Edit24Regular, Play24Regular, Save24Regular } from "@fluentui/react-icons";
import { useRef } from "react";
import { deleteRecordsAction, runRecordAction, runUploadAction, saveRecordAction } from "@/app/actions";
import { objectHref, type FieldMeta } from "@/lib/meta";
import type { UiLabels } from "@/server/ui";
import { DocuRefButton } from "./docuref-panel";
import { HistoryButton } from "./history-panel";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";
import { RecordDrawer } from "./record-drawer";
import { RecordForm, type FormGroup, type Values } from "./record-form";
import { useShortcuts } from "./shortcuts";
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
  actions: { id: string; label: string; upload?: string; download?: boolean }[];
  lines: LineSpec[];
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
        {spec.editable && (
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
        onOpen={spec.overview ? (row) => router.push(objectHref(spec.objectId, String(row.id))) : spec.editable ? open : undefined}
        onSelectionChange={setSelected}
      />
      {spec.editable && (
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

  const save = () =>
    start(async () => {
      const editable = p.groups.flatMap((g) => g.fields).filter((f) => !f.readOnly);
      const v: Values = {};
      for (const f of editable) v[f.name] = values[f.name] ?? null;
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
      escape: () => p.crumbs[p.crumbs.length - 1]?.href && router.push(p.crumbs[p.crumbs.length - 1].href!),
    },
    !confirm,
  );

  return (
    <>
      <ActionBar>
        <Crumbs items={[...p.crumbs, { label: p.recordTitle }]} />
        <Spacer />
        {!p.readOnly && (
          <Button appearance="primary" icon={<Save24Regular />} title={`${p.labels.actions.save} (Shift+S)`} disabled={busy} onClick={save}>
            {p.labels.actions.save}
          </Button>
        )}
        {p.actions.map((a) =>
          a.download ? (
            <Button
              key={a.id}
              icon={<ArrowDownload24Regular />}
              disabled={busy}
              onClick={() => (window.location.href = `/api/download/${p.objectId}/${p.id}/${a.id}`)}
            >
              {a.label}
            </Button>
          ) : a.upload ? (
            <UploadButton key={a.id} label={a.label} accept={a.upload} disabled={busy} onFile={(f) => upload(a.id, f)} />
          ) : (
            <Button key={a.id} icon={<Play24Regular />} disabled={busy} onClick={() => act(a.id)}>
              {a.label}
            </Button>
          ),
        )}
        {p.id && (
          <>
            <ToolbarDivider />
            <DocuRefButton objectId={p.objectId} recordId={p.id} recordTitle={p.recordTitle} canWrite={p.canAttach} labels={p.labels.docuref} />
            <HistoryButton objectId={p.objectId} recordId={p.id} recordTitle={p.recordTitle} labels={p.labels.history} />
          </>
        )}
        {p.canDelete && (
          <>
            <ToolbarDivider />
            <Button icon={<Delete24Regular />} disabled={busy} onClick={() => setConfirm(true)}>
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
            groups={p.groups}
            values={values}
            titles={titles}
            errors={errors}
            readOnly={p.readOnly}
            openLabel={p.labels.drawer.open}
            onChange={(name, value, t) => {
              setValues((v) => ({ ...v, [name]: value }));
              if (t !== undefined) setTitles((x) => ({ ...x, [name]: t }));
              setErrors((e) => ({ ...e, [name]: "" }));
            }}
          />
        </div>
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
