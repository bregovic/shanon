"use client";

/** Banka → Hromadný import výpisů: víc souborů GPC, přiřazení firmě a účtu, stav každého výpisu. */
import { useRef, useState } from "react";
import { Badge, Button, makeStyles, Spinner, Text, tokens } from "@fluentui/react-components";
import { DocumentArrowUp24Regular } from "@fluentui/react-icons";
import { bankBulkImportAction } from "@/app/actions";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";

const useStyles = makeStyles({
  card: {
    maxWidth: "1000px",
    padding: "20px 24px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  drop: { border: `2px dashed ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", cursor: "pointer" },
  muted: { color: tokens.colorNeutralForeground3 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: tokens.fontSizeBase200 },
  td: { padding: "4px 8px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, verticalAlign: "top" },
});

type Row = { file: string; company: string; account: string; statementNum: string; status: string; message: string | null; statementId: string | null };
const COLORS: Record<string, "success" | "warning" | "danger" | "subtle"> = { imported: "success", warning: "warning", duplicate: "subtle", error: "danger" };

export function BankImportView(p: {
  crumbs: { label: string; href?: string }[];
  logHref: string;
  statementHref: string;
  statusLabels: Record<string, string>;
  labels: Record<"intro" | "files" | "upload" | "log" | "file" | "company" | "account" | "statement" | "status" | "message", string>;
}) {
  const s = useStyles();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    const out: Row[] = [];
    for (const f of files) {
      const form = new FormData();
      form.set("file", f);
      const r = await bankBulkImportAction(form);
      if (r.ok) out.push(...r.data.map((x) => ({ file: f.name, ...x })));
      else out.push({ file: f.name, company: "", account: "", statementNum: "", status: "error", message: r.message, statementId: null });
      setRows([...out]);
    }
    setFiles([]);
    setBusy(false);
  }

  return (
    <>
      <ActionBar>
        <Crumbs items={p.crumbs} />
        <Spacer />
        <Button appearance="subtle" as="a" href={p.logHref}>
          {p.labels.log}
        </Button>
      </ActionBar>
      <PageContent>
        <div className={s.card}>
          <Text className={s.muted}>{p.labels.intro}</Text>
          <div
            className={s.drop}
            onClick={() => !busy && input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) setFiles((x) => [...x, ...Array.from(e.dataTransfer.files)]);
            }}
          >
            <DocumentArrowUp24Regular />
            <Button appearance="secondary" disabled={busy}>
              {p.labels.files}
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              accept=".gpc,.txt,.abo"
              hidden
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((x) => [...x, ...picked]);
                e.target.value = "";
              }}
            />
          </div>
          {files.length > 0 && <Text>{files.map((f) => f.name).join(", ")}</Text>}
          <div>
            <Button appearance="primary" disabled={busy || !files.length} onClick={start} icon={busy ? <Spinner size="tiny" /> : undefined}>
              {p.labels.upload}
            </Button>
          </div>
          {rows.length > 0 && (
            <table className={s.table}>
              <thead>
                <tr>
                  {[p.labels.file, p.labels.company, p.labels.account, p.labels.statement, p.labels.status, p.labels.message].map((h) => (
                    <th key={h} className={s.td} style={{ textAlign: "left" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className={s.td}>{r.file}</td>
                    <td className={s.td}>{r.company}</td>
                    <td className={s.td}>{r.account}</td>
                    <td className={s.td}>{r.statementId ? <a href={p.statementHref.replace("__ID__", r.statementId)}>{r.statementNum}</a> : r.statementNum}</td>
                    <td className={s.td}>
                      <Badge color={COLORS[r.status] ?? "subtle"}>{p.statusLabels[r.status] ?? r.status}</Badge>
                    </td>
                    <td className={s.td}>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </PageContent>
    </>
  );
}
