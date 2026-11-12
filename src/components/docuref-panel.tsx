"use client";

/**
 * Přílohy záznamu (DocuRef) — šuplík zprava s poznámkami a soubory.
 * Stejný pro všechny objekty; otevírá se tlačítkem Přílohy v liště akcí.
 */
import { useEffect, useRef, useState } from "react";
import {
  Button,
  CounterBadge,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Spinner,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { ArrowUpload24Regular, Attach24Regular, Delete24Regular, Dismiss24Regular, Document24Regular, Note24Regular } from "@fluentui/react-icons";
import { addNoteAction, deleteDocuRefAction, docuRefCountAction, docuRefListAction } from "@/app/actions";
import type { DocuRefItem } from "@/server/docuref";

export interface DocuRefLabels {
  attachments: string;
  addNote: string;
  uploadFile: string;
  noAttachments: string;
  title: string;
  note: string;
  save: string;
  cancel: string;
  close: string;
  delete: string;
}

const useStyles = makeStyles({
  tools: { display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" },
  noteForm: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    marginBottom: "16px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  item: {
    display: "flex",
    gap: "12px",
    padding: "10px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  icon: { color: tokens.colorBrandForeground1, flexShrink: 0, paddingTop: "2px" },
  body: { flex: 1, minWidth: 0 },
  name: { fontWeight: tokens.fontWeightSemibold, wordBreak: "break-word" },
  meta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  note: { whiteSpace: "pre-wrap", marginTop: "4px" },
  empty: { color: tokens.colorNeutralForeground3, padding: "24px 0", textAlign: "center" },
});

const fmtSize = (n: number | null) =>
  n === null ? "" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Tlačítko Přílohy s počtem; samo načte počet pro aktuální záznam. */
export function DocuRefButton({
  objectId,
  recordId,
  canWrite,
  recordTitle,
  labels,
}: {
  objectId: string;
  recordId: string | null;
  canWrite: boolean;
  recordTitle: string;
  labels: DocuRefLabels;
}) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!recordId) return;
    let alive = true;
    docuRefCountAction(objectId, recordId).then((n) => alive && setCount(n));
    return () => {
      alive = false;
    };
  }, [objectId, recordId]);

  return (
    <>
      <Button
        icon={<Attach24Regular />}
        disabled={!recordId}
        onClick={() => setOpen(true)}
        title={labels.attachments}
      >
        {labels.attachments}
        {recordId && count > 0 && <CounterBadge count={count} size="small" style={{ marginLeft: 6 }} />}
      </Button>
      {recordId && (
        <DocuRefPanel
          objectId={objectId}
          recordId={recordId}
          recordTitle={recordTitle}
          open={open}
          canWrite={canWrite}
          labels={labels}
          onClose={() => setOpen(false)}
          onCount={setCount}
        />
      )}
    </>
  );
}

export function DocuRefPanel({
  objectId,
  recordId,
  recordTitle,
  open,
  canWrite,
  labels,
  onClose,
  onCount,
}: {
  objectId: string;
  recordId: string;
  recordTitle: string;
  open: boolean;
  canWrite: boolean;
  labels: DocuRefLabels;
  onClose: () => void;
  onCount?: (n: number) => void;
}) {
  return (
    <Drawer type="overlay" position="end" size="medium" open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      {open && (
        <PanelBody
          key={recordId}
          objectId={objectId}
          recordId={recordId}
          recordTitle={recordTitle}
          canWrite={canWrite}
          labels={labels}
          onClose={onClose}
          onCount={onCount}
        />
      )}
    </Drawer>
  );
}

function PanelBody({
  objectId,
  recordId,
  recordTitle,
  canWrite,
  labels,
  onClose,
  onCount,
}: {
  objectId: string;
  recordId: string;
  recordTitle: string;
  canWrite: boolean;
  labels: DocuRefLabels;
  onClose: () => void;
  onCount?: (n: number) => void;
}) {
  const s = useStyles();
  const [items, setItems] = useState<DocuRefItem[] | null>(null);
  const [error, setError] = useState<string>();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState({ name: "", text: "" });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const r = await docuRefListAction(objectId, recordId);
    if (r.ok) {
      setItems(r.data);
      onCount?.(r.data.length);
    } else setError(r.message);
  };
  useEffect(() => {
    let alive = true;
    docuRefListAction(objectId, recordId).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setItems(r.data);
        onCount?.(r.data.length);
      } else setError(r.message);
    });
    return () => {
      alive = false;
    };
    // onCount je callback rodiče; načítat jen při otevření záznamu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId, recordId]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(undefined);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.set("objectId", objectId);
      fd.set("recordId", recordId);
      fd.set("file", f);
      const res = await fetch("/api/files", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!json.ok) setError(`${f.name}: ${json.message ?? res.statusText}`);
    }
    if (fileRef.current) fileRef.current.value = "";
    await load();
    setBusy(false);
  };

  const saveNote = async () => {
    setBusy(true);
    const r = await addNoteAction(objectId, recordId, note.name, note.text);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setNote({ name: "", text: "" });
    setNoteOpen(false);
    setError(undefined);
    await load();
  };

  const remove = async (id: string) => {
    const r = await deleteDocuRefAction(id);
    if (!r.ok) return setError(r.message);
    await load();
  };

  return (
    <>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={labels.close} icon={<Dismiss24Regular />} onClick={onClose} />}>
          {labels.attachments} · {recordTitle}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {canWrite && (
          <div className={s.tools}>
            <Button icon={<ArrowUpload24Regular />} disabled={busy} onClick={() => fileRef.current?.click()}>
              {labels.uploadFile}
            </Button>
            <Button icon={<Note24Regular />} disabled={busy} onClick={() => setNoteOpen((v) => !v)}>
              {labels.addNote}
            </Button>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
          </div>
        )}
        {error && (
          <MessageBar intent="error" style={{ marginBottom: 12 }}>
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {noteOpen && (
          <div className={s.noteForm}>
            <Field label={labels.title}>
              <Input value={note.name} onChange={(_, d) => setNote({ ...note, name: d.value })} />
            </Field>
            <Field label={labels.note} required>
              <Textarea rows={4} value={note.text} onChange={(_, d) => setNote({ ...note, text: d.value })} />
            </Field>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button onClick={() => setNoteOpen(false)}>{labels.cancel}</Button>
              <Button appearance="primary" disabled={busy || !note.text.trim()} onClick={saveNote}>
                {labels.save}
              </Button>
            </div>
          </div>
        )}
        {busy && <Spinner size="tiny" />}
        {items === null ? (
          <Spinner />
        ) : items.length === 0 ? (
          <div className={s.empty}>{labels.noAttachments}</div>
        ) : (
          items.map((it) => (
            <div key={it.id} className={s.item}>
              <span className={s.icon}>{it.kind === "file" ? <Document24Regular /> : <Note24Regular />}</span>
              <div className={s.body}>
                {it.kind === "file" ? (
                  <a className={s.name} href={`/api/files/${it.id}`} target="_blank" rel="noopener" style={{ color: tokens.colorBrandForegroundLink }}>
                    {it.name}
                  </a>
                ) : (
                  <div className={s.name}>{it.name}</div>
                )}
                <div className={s.meta}>
                  {new Date(it.createdAt).toLocaleString("cs-CZ")}
                  {it.kind === "file" && ` · ${fmtSize(it.size)}`}
                </div>
                {it.note && <div className={s.note}>{it.note}</div>}
              </div>
              {canWrite && (
                <Button appearance="subtle" size="small" icon={<Delete24Regular />} aria-label={labels.delete} onClick={() => remove(it.id)} />
              )}
            </div>
          ))
        )}
      </DrawerBody>
    </>
  );
}
