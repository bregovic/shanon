"use client";

/** Organizace → Migrace firmy: šablona, export konfigurace, kontrola a spuštění migrace ze souboru JSON. */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Text,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownload24Regular, CheckmarkCircle24Regular, Play24Regular } from "@fluentui/react-icons";
import { migrationAction } from "@/app/actions";
import type { MigrationReport } from "@/server/migration";
import { ActionBar, Crumbs, PageContent } from "./page";

const useStyles = makeStyles({
  card: {
    maxWidth: "820px",
    padding: "20px 24px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginBottom: "16px",
  },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  step: { display: "flex", flexDirection: "column", gap: "2px", padding: "8px 0", borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  msgs: { margin: 0, paddingLeft: "20px", color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
});

type Labels = Record<"Migration" | "MigDesc" | "MigTemplate" | "MigExport" | "MigFile" | "MigImages" | "MigImagesCount" | "MigCheck" | "MigRun" | "MigRunConfirm" | "MigCreated" | "MigUpdated", string>;

const COLOR = { ok: "success", warning: "warning", error: "danger" } as const;

export function MigrationView({ crumbs, labels: L, cancel }: { crumbs: { label: string; href?: string }[]; labels: Labels; cancel: string }) {
  const s = useStyles();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [ico, setIco] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [err, setErr] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [busy, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const pick = async (f: File | null) => {
    setFile(f);
    setReport(null);
    setErr(undefined);
    try {
      setIco(f ? String(JSON.parse(await f.text())?.firma?.ico ?? "") : "");
    } catch {
      setIco("");
    }
  };
  const run = (dryRun: boolean) =>
    start(async () => {
      if (!file) return;
      setErr(undefined);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("dryRun", dryRun ? "1" : "0");
      for (const im of images) fd.append("images", im, (im as File & { webkitRelativePath?: string }).webkitRelativePath || im.name);
      const r = await migrationAction(fd);
      if (r.ok) {
        setReport(r.data);
        if (r.data.applied) router.refresh();
      } else setErr(r.message);
    });

  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
      </ActionBar>
      <PageContent>
        <div className={s.card}>
          <Text className={s.muted}>{L.MigDesc}</Text>
          <div className={s.row}>
            <Button as="a" href="/api/migration?kind=template" icon={<ArrowDownload24Regular />}>
              {L.MigTemplate}
            </Button>
            <Button as="a" href="/api/migration?kind=export" icon={<ArrowDownload24Regular />}>
              {L.MigExport}
            </Button>
          </div>
        </div>
        <div className={s.card}>
          <Field label={L.MigFile}>
            <input ref={fileInput} type="file" accept=".json,application/json" aria-label={L.MigFile} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label={L.MigImages}>
            <input
              type="file"
              multiple
              accept="image/*"
              aria-label={L.MigImages}
              // složka i s podsložkami
              {...({ webkitdirectory: "" } as Record<string, string>)}
              onChange={(e) => {
                setImages([...(e.target.files ?? [])].filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f.name)));
                setReport(null);
              }}
            />
          </Field>
          {images.length > 0 && <Text className={s.muted}>{L.MigImagesCount.replace("{n}", String(images.length))}</Text>}
          <div className={s.row}>
            <Button icon={<CheckmarkCircle24Regular />} disabled={busy || !file} onClick={() => run(true)}>
              {L.MigCheck}
            </Button>
            <Button appearance="primary" icon={<Play24Regular />} disabled={busy || !file} onClick={() => setConfirm(true)}>
              {L.MigRun}
            </Button>
          </div>
          {err && (
            <MessageBar intent="error">
              <MessageBarBody>{err}</MessageBarBody>
            </MessageBar>
          )}
          {report &&
            report.steps.map((st) => (
              <div key={st.key} className={s.step}>
                <div className={s.row}>
                  <Badge appearance="tint" color={COLOR[st.status]}>
                    {st.status === "ok" ? "OK" : st.status === "warning" ? "!" : "×"}
                  </Badge>
                  <Text weight="semibold">{st.label}</Text>
                  {(st.created !== undefined || st.updated !== undefined) && (
                    <Text className={s.muted}>
                      {[L.MigCreated.replace("{n}", String(st.created ?? 0)), L.MigUpdated.replace("{n}", String(st.updated ?? 0))].join(", ")}
                    </Text>
                  )}
                </div>
                {st.messages.length > 0 && (
                  <ul className={s.msgs}>
                    {st.messages.slice(0, 50).map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
        </div>
        <Dialog open={confirm} onOpenChange={(_, d) => setConfirm(d.open)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{L.MigRun}</DialogTitle>
              <DialogContent>{L.MigRunConfirm.replace("{ico}", ico || "?")}</DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirm(false)}>{cancel}</Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    setConfirm(false);
                    run(false);
                  }}
                >
                  {L.MigRun}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </PageContent>
    </>
  );
}
