"use client";

/** Obecná stránka reportu: parametry nahoře, výsledek v tabulce, Celkem, export do Excelu. */
import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
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
import { ArrowDownload24Regular, Play24Regular } from "@fluentui/react-icons";
import { runReportAction } from "@/app/actions";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";

type Row = Record<string, unknown>;
interface Col {
  name: string;
  label: string;
  kind: "string" | "amount";
  total?: boolean;
}

const useStyles = makeStyles({
  params: { display: "flex", flexWrap: "wrap", gap: "12px 16px", alignItems: "flex-end", marginBottom: "16px" },
  card: { backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, overflow: "auto" },
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  neg: { color: tokens.colorPaletteRedForeground1 },
  section: { fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground2 },
  total: { fontWeight: tokens.fontWeightBold, borderTop: `2px solid ${tokens.colorNeutralStroke1}` },
  desc: { color: tokens.colorNeutralForeground3, display: "block", marginBottom: "12px" },
});

export function ReportView(p: {
  module: string;
  report: string;
  crumbs: { label: string; href?: string }[];
  description: string;
  params: { name: string; kind: "date" | "bool" | "dimension"; label: string }[];
  initial: { params: Row; columns: Col[]; rows: Row[] };
  lang: string;
  labels: { run: string; export: string; total: string; empty: string };
}) {
  const st = useStyles();
  const [values, setValues] = useState<Row>(p.initial.params);
  const [res, setRes] = useState(p.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const nf = useMemo(() => new Intl.NumberFormat(p.lang === "en" ? "en-GB" : "cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [p.lang]);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    const r = await runReportAction(p.module, p.report, values);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setRes(r.data);
  };
  const query = new URLSearchParams(Object.entries(values).filter(([, v]) => v !== null && v !== "" && v !== undefined).map(([k, v]) => [k, String(v)]));
  // součty v haléřích (bez chyb zaokrouhlení a „−0,00“)
  const totals = Object.fromEntries(
    res.columns.filter((c) => c.total).map((c) => [c.name, res.rows.filter((r) => !r._level).reduce((a, r) => a + Math.round(Number(r[c.name] ?? 0) * 100), 0) / 100 || 0]),
  );
  const cell = (c: Col, v: unknown) => (c.kind === "amount" ? nf.format(Number(v ?? 0)) : String(v ?? ""));

  return (
    <>
      <ActionBar>
        <Crumbs items={p.crumbs} />
        <Spacer />
        <Button icon={<ArrowDownload24Regular />} onClick={() => (window.location.href = `/api/report/${p.module}/${p.report}?${query}`)}>
          {p.labels.export}
        </Button>
      </ActionBar>
      <PageContent>
        {p.description && <Text className={st.desc}>{p.description}</Text>}
        <div className={st.params}>
          {p.params.map((x) =>
            x.kind === "bool" ? (
              <Checkbox key={x.name} label={x.label} checked={!!values[x.name]} onChange={(_, d) => setValues((v) => ({ ...v, [x.name]: !!d.checked }))} />
            ) : (
              <Field key={x.name} label={x.label}>
                <Input
                  type={x.kind === "date" ? "date" : "text"}
                  value={String(values[x.name] ?? "")}
                  style={{ width: x.kind === "date" ? 160 : 130 }}
                  onChange={(_, d) => setValues((v) => ({ ...v, [x.name]: d.value }))}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                />
              </Field>
            ),
          )}
          <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Play24Regular />} disabled={busy} onClick={run}>
            {p.labels.run}
          </Button>
        </div>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <div className={st.card}>
          <Table size="small">
            <TableHeader>
              <TableRow>
                {res.columns.map((c) => (
                  <TableHeaderCell key={c.name} style={c.kind === "amount" ? { textAlign: "right" } : undefined}>
                    <b style={{ width: "100%", textAlign: c.kind === "amount" ? "right" : "left" }}>{c.label}</b>
                  </TableHeaderCell>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!res.rows.length && (
                <TableRow>
                  <TableCell colSpan={res.columns.length}>{p.labels.empty}</TableCell>
                </TableRow>
              )}
              {res.rows.map((r, i) => (
                <TableRow key={i} className={r._level ? st.section : undefined}>
                  {res.columns.map((c) => (
                    <TableCell key={c.name} className={c.kind === "amount" ? `${st.num} ${Number(r[c.name]) < 0 ? st.neg : ""}` : undefined}>
                      {cell(c, r[c.name])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {Object.keys(totals).length > 0 && res.rows.length > 0 && (
                <TableRow className={st.total}>
                  {res.columns.map((c, i) => (
                    <TableCell key={c.name} className={c.kind === "amount" ? st.num : undefined}>
                      {c.total ? nf.format(totals[c.name]) : i === 0 ? p.labels.total : ""}
                    </TableCell>
                  ))}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </PageContent>
    </>
  );
}
