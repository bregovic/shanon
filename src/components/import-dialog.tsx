"use client";

/**
 * Import do číselníku: výběr souboru → Zkontrolovat (nic se neuloží) →
 * Importovat. Ukáže, jak se sloupce spárovaly, a chyby po řádcích.
 */
import { useRef, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Link,
  MessageBar,
  MessageBarBody,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowUpload24Regular } from "@fluentui/react-icons";
import { importAction } from "@/app/actions";
import type { ImportReport } from "@/server/import";
import type { UiLabels } from "@/server/ui";

const useStyles = makeStyles({
  surface: { maxWidth: "820px", width: "calc(100vw - 32px)" },
  body: { display: "flex", flexDirection: "column", gap: "12px" },
  file: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" },
  cols: { display: "flex", flexWrap: "wrap", gap: "6px" },
  errors: { maxHeight: "260px", overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
});

type L = UiLabels["importer"];
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ""));

export function ImportButton({ objectId, labels, onDone, hasImages = false }: { objectId: string; labels: L; onDone: () => void; hasImages?: boolean }) {
  const st = useStyles();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [imageDir, setImageDir] = useState<string | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    const fd = new FormData();
    fd.set("objectId", objectId);
    fd.set("file", file);
    fd.set("dryRun", dryRun ? "1" : "0");
    // relativní cesta ve složce (antoni/002_spek.jpg) slouží ke spárování se sloupcem Obrázek
    for (const im of images) fd.append("images", im, (im as File & { webkitRelativePath?: string }).webkitRelativePath || im.name);
    const res = await importAction(fd);
    setBusy(false);
    if (!res.ok) {
      setReport(null);
      setError(res.message);
      return;
    }
    setReport(res.data);
    if (res.data.applied) onDone();
  };

  const reset = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setFile(null);
      setImages([]);
      setReport(null);
      setError(undefined);
    }
  };

  const ok = report && !report.errors.length;
  return (
    <>
      <Button appearance="subtle" icon={<ArrowUpload24Regular />} title={labels.title} onClick={() => reset(true)}>
        {labels.import}
      </Button>
      <Dialog open={open} onOpenChange={(_, d) => reset(d.open)}>
        <DialogSurface className={st.surface}>
          <DialogBody>
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogContent className={st.body}>
              <Text>{labels.help}</Text>
              <div className={st.file}>
                <input
                  ref={input}
                  type="file"
                  accept=".csv,.txt,.xml,.xlsx"
                  aria-label={labels.title}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    setReport(null);
                    setError(undefined);
                    setImageDir(null);
                    // cesty k obrázkům v souboru → složka, kterou je třeba vybrat
                    if (f && hasImages) void f.text().then((t) => setImageDir(commonImageDir(t)));
                  }}
                />
                <Link href={`/api/import-template/${objectId}`}>{labels.template}</Link>
              </div>
              {hasImages && (
                <div className={st.file}>
                  <Text>{labels.images}</Text>
                  {imageDir && (
                    <Text weight="semibold" style={{ width: "100%" }}>
                      {labels.imagesFolder.replace("{dir}", imageDir)}
                    </Text>
                  )}
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    aria-label={labels.images}
                    // složka i s podsložkami (Chrome, Edge, Firefox, Safari)
                    {...({ webkitdirectory: "" } as Record<string, string>)}
                    onChange={(e) => {
                      setImages([...(e.target.files ?? [])].filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f.name)));
                      setReport(null);
                    }}
                  />
                  <Button size="small" onClick={() => filesInput.current?.click()}>
                    {labels.imagesFiles}
                  </Button>
                  <input
                    ref={filesInput}
                    type="file"
                    multiple
                    hidden
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    aria-label={labels.imagesFiles}
                    onChange={(e) => {
                      setImages([...(e.target.files ?? [])]);
                      setReport(null);
                    }}
                  />
                  {images.length > 0 && <Text>{labels.imagesCount.replace("{n}", String(images.length))}</Text>}
                </div>
              )}
              {busy && <Spinner size="tiny" />}
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
              {report && (
                <>
                  <MessageBar intent={report.errors.length ? "error" : report.applied ? "success" : "info"}>
                    <MessageBarBody>
                      {report.errors.length
                        ? fill(labels.failed, { n: report.errors.length })
                        : fill(report.applied ? labels.done : labels.checkOk, { created: report.created, updated: report.updated })}
                    </MessageBarBody>
                  </MessageBar>
                  {!!report.warnings.length && (
                    <MessageBar intent="warning">
                      <MessageBarBody>
                        {labels.warnings.replace("{n}", String(report.warnings.length))}
                        <ul style={{ margin: "4px 0 0", paddingLeft: 18, maxHeight: 120, overflowY: "auto" }}>
                          {report.warnings.slice(0, 50).map((w, i) => (
                            <li key={i}>
                              {labels.row} {w.row}: {w.message}
                            </li>
                          ))}
                        </ul>
                      </MessageBarBody>
                    </MessageBar>
                  )}
                  {!!report.missing.length && (
                    <MessageBar intent="warning">
                      <MessageBarBody>{fill(labels.missing, { fields: report.missing.join(", ") })}</MessageBarBody>
                    </MessageBar>
                  )}
                  <Text weight="semibold">{labels.columns}</Text>
                  <div className={st.cols}>
                    {report.columns.map((c) => (
                      <Badge
                        key={c.header}
                        appearance={c.status === "mapped" ? "tint" : "outline"}
                        color={c.status === "mapped" ? "brand" : "informative"}
                        title={c.status === "mapped" ? c.label ?? "" : c.status === "computed" ? labels.computed : labels.ignored}
                      >
                        {c.header}
                        {c.status === "mapped" && c.label && c.label !== c.header ? ` → ${c.label}` : c.status !== "mapped" ? ` (${c.status === "computed" ? labels.computed : labels.ignored})` : ""}
                      </Badge>
                    ))}
                  </div>
                  {!!report.errors.length && (
                    <div className={st.errors}>
                      <Table size="small">
                        <TableHeader>
                          <TableRow>
                            <TableHeaderCell style={{ width: 70 }}>{labels.row}</TableHeaderCell>
                            <TableHeaderCell style={{ width: 180 }}>{labels.column}</TableHeaderCell>
                            <TableHeaderCell>{labels.message}</TableHeaderCell>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.errors.map((e, i) => (
                            <TableRow key={i}>
                              <TableCell>{e.row}</TableCell>
                              <TableCell>{e.column ?? "—"}</TableCell>
                              <TableCell>{e.message}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => reset(false)}>{labels.close}</Button>
              {!report?.applied && (
                <>
                  <Button disabled={!file || busy} onClick={() => run(true)}>
                    {labels.check}
                  </Button>
                  <Button appearance="primary" disabled={!file || busy || (!!report && !ok)} onClick={() => run(false)}>
                    {labels.run}
                  </Button>
                </>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}

/**
 * Společná složka absolutních cest k obrázkům v souboru (C:\\…\\nahledy\\x.jpg
 * → C:\\…\\nahledy). Prohlížeč smí číst jen složku, kterou uživatel vybere.
 */
function commonImageDir(text: string): string | null {
  const paths = [...text.matchAll(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^;,\t\r\n"]+\.(?:jpe?g|png|webp|gif)/gi)].map((m) => m[0].replace(/\//g, "\\"));
  if (!paths.length) return null;
  const parts = paths.map((p) => p.split("\\").slice(0, -1));
  const common: string[] = [];
  for (let i = 0; parts.every((p) => i < p.length && p[i].toLowerCase() === parts[0][i].toLowerCase()); i++) common.push(parts[0][i]);
  return common.length ? common.join("\\") : null;
}
