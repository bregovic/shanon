"use client";

/** Integrace → Načíst doklady: výběr / přetažení souborů, nahrání po jednom, průběh. */
import { useRef, useState } from "react";
import { Badge, Button, Checkbox, Dropdown, Field, Link, makeStyles, Option, Spinner, Text, tokens } from "@fluentui/react-components";
import { DocumentArrowUp24Regular } from "@fluentui/react-icons";
import { docImportAction } from "@/app/actions";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";

const useStyles = makeStyles({
  card: {
    maxWidth: "900px",
    padding: "20px 24px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  drop: {
    border: `2px dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "28px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
  },
  dropActive: { border: `2px dashed ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  muted: { color: tokens.colorNeutralForeground3 },
  row: { display: "flex", gap: "12px", alignItems: "end", flexWrap: "wrap" },
  list: { display: "flex", flexDirection: "column", gap: "6px" },
  item: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
});

type Row = { name: string; state: "wait" | "busy" | "done" | "error"; id?: string; docNum?: string; status?: string; message?: string | null };
const COLORS: Record<string, "success" | "warning" | "danger" | "brand" | "informative"> = { ready: "success", attention: "warning", error: "danger", new: "informative", processing: "brand" };

export function DocImportView(p: {
  crumbs: { label: string; href?: string }[];
  targets: { value: string; label: string }[];
  initialTarget: string;
  listHref: string;
  docHref: string;
  statusLabels: Record<string, string>;
  labels: Record<"intro" | "files" | "drop" | "extract" | "start" | "openList" | "uploading" | "target", string>;
}) {
  const s = useStyles();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [target, setTarget] = useState(p.initialTarget);
  const [extract, setExtract] = useState(true);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const add = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    setFiles((f) => [...f, ...picked]);
  };

  async function start() {
    setBusy(true);
    const next: Row[] = files.map((f) => ({ name: f.name, state: "wait" }));
    setRows([...next]);
    for (let i = 0; i < files.length; i++) {
      next[i] = { ...next[i], state: "busy" };
      setRows([...next]);
      const form = new FormData();
      form.set("file", files[i]);
      form.set("target", target);
      form.set("extract", extract ? "1" : "0");
      const r = await docImportAction(form);
      next[i] = r.ok ? { ...next[i], state: "done", ...r.data } : { ...next[i], state: "error", message: r.message };
      setRows([...next]);
    }
    setFiles([]);
    setBusy(false);
  }

  const targetLabel = p.targets.find((x) => x.value === target)?.label ?? "";
  return (
    <>
      <ActionBar>
        <Crumbs items={p.crumbs} />
        <Spacer />
        <Button appearance="subtle" as="a" href={p.listHref}>
          {p.labels.openList}
        </Button>
      </ActionBar>
      <PageContent>
        <div className={s.card}>
          <Text className={s.muted}>{p.labels.intro}</Text>
          <div className={s.row}>
            <Field label={p.labels.target}>
              <Dropdown value={targetLabel} selectedOptions={[target]} onOptionSelect={(_, d) => setTarget(String(d.optionValue))} disabled={busy}>
                {p.targets.map((x) => (
                  <Option key={x.value} value={x.value}>
                    {x.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Checkbox label={p.labels.extract} checked={extract} onChange={(_, d) => setExtract(!!d.checked)} disabled={busy} />
          </div>
          <div
            className={`${s.drop} ${over ? s.dropActive : ""}`}
            onClick={() => !busy && input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (!busy) add(e.dataTransfer.files);
            }}
          >
            <DocumentArrowUp24Regular />
            <Button appearance="secondary" disabled={busy}>
              {p.labels.files}
            </Button>
            <Text className={s.muted}>{p.labels.drop}</Text>
            <input
              ref={input}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              hidden
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {files.length > 0 && (
            <div className={s.list}>
              {files.map((f, i) => (
                <Text key={i}>{f.name}</Text>
              ))}
            </div>
          )}
          <div>
            <Button appearance="primary" disabled={busy || !files.length} onClick={start} icon={busy ? <Spinner size="tiny" /> : undefined}>
              {busy ? p.labels.uploading : p.labels.start}
            </Button>
          </div>
          {rows.length > 0 && (
            <div className={s.list}>
              {rows.map((r, i) => (
                <div key={i} className={s.item}>
                  {r.state === "busy" ? <Spinner size="tiny" /> : null}
                  {r.id ? <Link href={p.docHref.replace("__ID__", r.id)}>{r.docNum}</Link> : null}
                  <Text>{r.name}</Text>
                  {r.status && <Badge color={COLORS[r.status] ?? "informative"}>{p.statusLabels[r.status] ?? r.status}</Badge>}
                  {r.state === "error" && <Badge color="danger">!</Badge>}
                  {r.message && <Text className={s.muted}>{r.message}</Text>}
                </div>
              ))}
            </div>
          )}
        </div>
      </PageContent>
    </>
  );
}
