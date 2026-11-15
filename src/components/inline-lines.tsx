"use client";

/**
 * Řádky dokladu upravované přímo v mřížce (deník jako v AX): každý řádek
 * je řádek tabulky s poli, ukládá se při opuštění řádku nebo Enterem,
 * poslední prázdný řádek slouží k založení dalšího. Pole se stejným
 * `gridColumn` (účet podle druhu) sdílí jeden sloupec — ukáže se to, které
 * podle `visibleWhen` platí.
 *
 * Rychlé pořizování: nový řádek převezme pole z předchozího (`carry`) a u
 * nevyrovnaného dokladu (`balance`) jeho číslo a dorovnávací částku. Enter =
 * uložit a na další řádek (první pole, které se nepřebírá), šipky ↑/↓ = o řádek
 * výš/níž ve stejném sloupci, Tab přeskakuje pole, která se plní sama.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Input, makeStyles, Select, Text, Tooltip, tokens } from "@fluentui/react-components";
import { Delete20Regular } from "@fluentui/react-icons";
import { deleteRecordsAction, listAction, saveRecordAction } from "@/app/actions";
import type { FieldMeta } from "@/lib/meta";
import { formatDateInput } from "@/lib/date-input";
import { DateInput } from "./date-input";
import { RefCombobox, type Values } from "./record-form";

type Row = Record<string, unknown>;

interface EditRow {
  key: string;
  id: string | null;
  version?: number;
  values: Values;
  titles: Record<string, string>;
  dirty: boolean;
  error?: string;
}

export interface LineBalance {
  group: string;
  debit: string;
  credit: string;
  selfBalanced?: string;
}

const useStyles = makeStyles({
  wrap: { overflow: "auto", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground1 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: tokens.fontSizeBase200 },
  th: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: "left",
    padding: "6px 6px",
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  td: { padding: "2px 4px", borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, verticalAlign: "top" },
  dirty: { backgroundColor: tokens.colorPaletteYellowBackground1 },
  bad: { backgroundColor: tokens.colorPaletteRedBackground1 },
  newRow: { opacity: 0.85 },
  num: { textAlign: "right" },
  err: { color: tokens.colorPaletteRedForeground1, fontSize: tokens.fontSizeBase200, padding: "0 8px 4px" },
  total: { fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground2 },
  ro: { padding: "6px 4px", whiteSpace: "nowrap" },
  open: { boxShadow: `inset 3px 0 0 ${tokens.colorPaletteDarkOrangeBorder2}` },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1, fontWeight: tokens.fontWeightRegular },
  ok: { color: tokens.colorPaletteGreenForeground1, fontWeight: tokens.fontWeightRegular },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase100, padding: "4px 8px" },
});

interface Column {
  key: string;
  label: string;
  fields: FieldMeta[];
  width: number;
}

const visible = (f: FieldMeta, v: Values) => !f.visibleWhen || f.visibleWhen.in.includes(String(v[f.visibleWhen.field] ?? ""));
let seq = 0;
const toEdit = (r: Row): EditRow => ({ key: String(r.id), id: String(r.id), version: r.version as number, values: { ...r, ...((r.ext as Values) ?? {}) }, titles: (r._titles as Record<string, string>) ?? {}, dirty: false });
const num = (v: unknown) => Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
const cents = (v: unknown) => Math.round(num(v) * 100);

/** Rozdíl MD − D po skupinách (doklad deníku) v haléřích, v pořadí řádků. */
function groupDiffs(rows: EditRow[], b?: LineBalance): Map<string, number> {
  const out = new Map<string, number>();
  if (!b) return out;
  for (const r of rows) {
    if (!r.id) continue;
    const g = String(r.values[b.group] ?? "");
    if (!g) continue;
    const d = b.selfBalanced && r.values[b.selfBalanced] ? 0 : cents(r.values[b.debit]) - cents(r.values[b.credit]);
    out.set(g, (out.get(g) ?? 0) + d);
  }
  return out;
}

export function InlineLines({
  objectId,
  parentField,
  parentId,
  columns: metas,
  defaults,
  initial,
  sortField,
  readOnly,
  lang,
  labels,
  onChanged,
  carry,
  balance,
}: {
  objectId: string;
  parentField: string;
  parentId: string;
  columns: FieldMeta[];
  defaults: Values;
  initial: Row[];
  sortField?: string;
  readOnly: boolean;
  lang: string;
  labels: { open: string; remove: string; total: string; empty: string; unbalanced?: string; balanced?: string; keys?: string };
  onChanged?: () => void;
  carry?: string[];
  balance?: LineBalance;
}) {
  const s = useStyles();
  const nf = useMemo(() => new Intl.NumberFormat(lang === "en" ? "en-GB" : "cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [lang]);

  /** nový řádek: výchozí hodnoty + pole předchozího řádku + dorovnání otevřeného dokladu */
  const blankFor = useCallback(
    (saved: EditRow[]): EditRow => {
      const values: Values = { ...defaults };
      const titles: Record<string, string> = {};
      const prev = saved.filter((r) => r.id).at(-1);
      if (prev)
        for (const f of carry ?? []) {
          values[f] = prev.values[f] ?? values[f] ?? null;
          if (prev.titles[f]) titles[f] = prev.titles[f];
        }
      if (balance && prev) {
        const g = String(prev.values[balance.group] ?? "");
        const diff = g ? (groupDiffs(saved, balance).get(g) ?? 0) : 0;
        if (diff !== 0) {
          values[balance.group] = g;
          values[diff > 0 ? balance.credit : balance.debit] = (Math.abs(diff) / 100).toFixed(2);
          values[diff > 0 ? balance.debit : balance.credit] = null;
        }
      }
      return { key: `new${seq++}`, id: null, values, titles, dirty: false };
    },
    [defaults, carry, balance],
  );

  const [rows, setRows] = useState<EditRow[]>(() => {
    const saved = initial.map(toEdit);
    return [...saved, ...(readOnly ? [] : [blankFor(saved)])];
  });
  // poslední stav pro obsluhu kláves (hodnota z pole data se zapíše až těsně před uložením)
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const tbody = useRef<HTMLTableSectionElement>(null);

  // sloupce: pole se stejným gridColumn v jednom sloupci
  const columns = useMemo(() => {
    const out: Column[] = [];
    for (const f of metas) {
      if (f.name === parentField) continue;
      const last = out[out.length - 1];
      if (f.gridColumn && last?.key === f.gridColumn) last.fields.push(f);
      else
        out.push({
          key: f.gridColumn ?? f.name,
          label: f.label,
          fields: [f],
          width: f.kind === "ref" ? 190 : f.kind === "decimal" ? 110 : f.kind === "date" ? 110 : f.kind === "enum" ? 130 : f.kind === "bool" ? 50 : f.name === "text" ? 220 : 120,
        });
    }
    return out;
  }, [metas, parentField]);

  // pole, která se plní sama (číslo dokladu, datum z hlavičky): Tab je přeskočí
  const autoCols = useMemo(() => new Set([balance?.group, ...Object.keys(defaults).filter((k) => k === "date")].filter(Boolean) as string[]), [balance, defaults]);
  // Enter skočí na další řádek do prvního sloupce, který se nepřebírá
  const entryCol = useMemo(() => Math.max(0, columns.findIndex((c) => !autoCols.has(c.key) && !(carry ?? []).includes(c.key) && !c.fields.some((f) => f.readOnly))), [columns, autoCols, carry]);

  const reload = useCallback(async () => {
    const r = await listAction(objectId, { filter: { [parentField]: parentId }, sort: sortField, dir: "asc", pageSize: 2000 });
    if (!r.ok) return;
    // rozpracované (neuložené) řádky zachovat
    setRows((cur) => {
      const pending = cur.filter((x) => x.dirty);
      const saved = r.data.rows.map(toEdit).map((x) => pending.find((p) => p.id === x.id) ?? x);
      const fresh = pending.filter((p) => !p.id);
      return [...saved, ...fresh, ...(readOnly || fresh.length ? [] : [blankFor(saved)])];
    });
  }, [objectId, parentField, parentId, sortField, readOnly, blankFor]);

  const update = (key: string, patch: Partial<EditRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async (key: string) => {
    const row = rowsRef.current.find((r) => r.key === key);
    if (!row || !row.dirty || readOnly) return true;
    const values: Values = {};
    for (const c of columns) for (const f of c.fields) if (!f.readOnly) values[f.name] = typeof row.values[f.name] === "string" && f.kind === "decimal" ? String(row.values[f.name]).replace(/\s/g, "").replace(",", ".") || null : (row.values[f.name] ?? null);
    values[parentField] = parentId;
    const res = await saveRecordAction(objectId, row.id, values, row.version);
    if (!res.ok) {
      update(row.key, { error: [res.message, ...Object.values(res.errors ?? {})].filter(Boolean).join(" · ") });
      return false;
    }
    update(row.key, { dirty: false, error: undefined, id: String(res.data.id) });
    await reload();
    onChanged?.();
    return true;
  };

  const remove = async (row: EditRow) => {
    if (!row.id) return setRows((cur) => cur.filter((r) => r.key !== row.key));
    const res = await deleteRecordsAction(objectId, [row.id]);
    if (!res.ok) return update(row.key, { error: res.message });
    await reload();
    onChanged?.();
  };

  const focusCell = (rowIdx: number, colIdx: number) =>
    requestAnimationFrame(() => {
      const trs = [...(tbody.current?.querySelectorAll("tr[data-row]") ?? [])];
      const tr = trs[Math.max(0, Math.min(rowIdx, trs.length - 1))];
      const el = tr?.querySelectorAll("td")[colIdx]?.querySelector<HTMLElement>("input, select, button");
      el?.focus();
      if (el instanceof HTMLInputElement) el.select();
    });
  const rowIndex = (key: string) => [...(tbody.current?.querySelectorAll("tr[data-row]") ?? [])].findIndex((t) => t.getAttribute("data-row") === key);

  const onKey = async (e: React.KeyboardEvent, row: EditRow, colIdx: number) => {
    const t = e.target as HTMLElement;
    const combo = t.getAttribute("role") === "combobox";
    const expanded = combo && t.getAttribute("aria-expanded") === "true";
    // Enter: ve výběru s otevřenou nabídkou vybírá, jinak uloží řádek a jde na další
    if (e.key === "Enter" && !expanded) {
      e.preventDefault();
      // hodnota pole (datum se převádí při Enteru) se do stavu propíše až po vykreslení
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const idx = rowIndex(row.key);
      if (!(await save(row.key))) return;
      focusCell(idx + 1, entryCol);
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !expanded && (t.tagName !== "SELECT" || e.ctrlKey)) {
      e.preventDefault();
      // opuštěním řádku se uloží (onBlur řádku)
      focusCell(rowIndex(row.key) + (e.key === "ArrowDown" ? 1 : -1), colIdx);
    }
  };

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of columns) {
      const f = c.fields[0];
      if (f.kind !== "decimal" || f.noTotal) continue;
      t[c.key] = rows.reduce((a, r) => a + (r.id ? num(r.values[f.name]) : 0), 0);
    }
    return t;
  }, [rows, columns]);

  const diffs = useMemo(() => groupDiffs(rows, balance), [rows, balance]);
  const openGroups = [...diffs].filter(([, d]) => d !== 0);

  const cell = (row: EditRow, c: Column, colIdx: number) => {
    const f = c.fields.find((x) => visible(x, row.values)) ?? null;
    if (!f) return null;
    const v = row.values[f.name];
    const set = (value: unknown, title?: string) =>
      update(row.key, { values: { ...row.values, [f.name]: value }, titles: title !== undefined ? { ...row.titles, [f.name]: title } : row.titles, dirty: true, error: undefined });
    if (readOnly || f.readOnly) {
      const shown = f.kind === "ref" ? row.titles[f.name] : f.kind === "date" ? formatDateInput(v, lang) : f.kind === "enum" ? f.options?.find((o) => o.value === v)?.label : f.kind === "decimal" && v !== null && v !== undefined && v !== "" ? nf.format(Number(v)) : v;
      return <div className={`${s.ro} ${f.kind === "decimal" ? s.num : ""}`}>{String(shown ?? "")}</div>;
    }
    const skip = autoCols.has(c.key) ? { tabIndex: -1 } : {};
    const common = { onKeyDown: (e: React.KeyboardEvent) => void onKey(e, row, colIdx), ...skip };
    switch (f.kind) {
      case "enum":
        return (
          <Select size="small" value={String(v ?? "")} onChange={(_, d) => set(d.value || null)} {...common} aria-label={f.label}>
            {!f.mandatory && <option value="">—</option>}
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );
      case "ref":
        return (
          <div onKeyDown={common.onKeyDown}>
            <RefCombobox compact f={f} value={String(v ?? "")} title={row.titles[f.name] ?? ""} disabled={false} openLabel={labels.open} onChange={(_, value, title) => set(value, title)} />
          </div>
        );
      case "bool":
        return <Checkbox checked={!!v} onChange={(_, d) => set(!!d.checked)} aria-label={f.label} />;
      case "date":
        return <DateInput size="small" lang={lang} value={(v as string) ?? null} onChange={(iso) => set(iso)} {...common} aria-label={f.label} />;
      case "decimal":
      case "int":
        return <Input size="small" inputMode="decimal" value={v === null || v === undefined ? "" : String(v)} input={{ style: { textAlign: "right" } }} onChange={(_, d) => set(d.value)} {...common} aria-label={f.label} />;
      default:
        return <Input size="small" value={String(v ?? "")} onChange={(_, d) => set(d.value)} {...common} aria-label={f.label} />;
    }
  };

  const groupOpen = (r: EditRow) => !!balance && !!r.id && (diffs.get(String(r.values[balance.group] ?? "")) ?? 0) !== 0;

  return (
    <div>
      <div className={s.wrap} style={{ maxHeight: "calc(100vh - 260px)" }}>
        <table className={s.table} style={{ minWidth: columns.reduce((a, c) => a + c.width, 60) }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`${s.th} ${c.fields[0].kind === "decimal" ? s.num : ""}`} style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              <th className={s.th} style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody ref={tbody}>
            {rows.map((r) => (
              <RowView key={r.key} row={r} s={s} open={groupOpen(r)} onLeave={() => void save(r.key)}>
                {columns.map((c, i) => (
                  <td key={c.key} className={s.td}>
                    {cell(r, c, i)}
                  </td>
                ))}
                <td className={s.td}>
                  {!readOnly && (r.id || r.dirty) && (
                    <Tooltip content={labels.remove} relationship="label">
                      <Button size="small" appearance="subtle" tabIndex={-1} icon={<Delete20Regular />} onClick={() => void remove(r)} />
                    </Tooltip>
                  )}
                </td>
              </RowView>
            ))}
            {!rows.some((r) => r.id) && readOnly && (
              <tr>
                <td className={s.td} colSpan={columns.length + 1}>
                  <Text>{labels.empty}</Text>
                </td>
              </tr>
            )}
            <tr className={s.total}>
              {columns.map((c, i) => (
                <td key={c.key} className={`${s.td} ${s.num}`}>
                  {i === 0 ? <span style={{ float: "left" }}>{labels.total}</span> : c.key in totals ? nf.format(totals[c.key]) : ""}
                </td>
              ))}
              <td className={s.td} />
            </tr>
          </tbody>
        </table>
      </div>
      {balance && rows.some((r) => r.id) && (
        <div className={s.hint}>
          {openGroups.length ? (
            <span className={s.warn}>
              {(labels.unbalanced ?? "{list}").replace("{list}", openGroups.map(([g, d]) => `${g} (${nf.format(d / 100)})`).join(", "))}
            </span>
          ) : (
            <span className={s.ok}>{labels.balanced}</span>
          )}
          {!readOnly && labels.keys ? <span> · {labels.keys}</span> : null}
        </div>
      )}
    </div>
  );
}

/** Řádek: uloží se, když z něj odejde fokus (klik jinam, Tab za poslední pole, šipka). */
function RowView({ row, s, open, onLeave, children }: { row: EditRow; s: ReturnType<typeof useStyles>; open: boolean; onLeave: () => void; children: React.ReactNode }) {
  return (
    <>
      <tr
        data-row={row.key}
        className={[row.error ? s.bad : row.dirty ? s.dirty : !row.id ? s.newRow : "", open ? s.open : ""].join(" ").trim() || undefined}
        onBlur={(e) => {
          const to = e.relatedTarget as Node | null;
          // přechod do vyskakovacího výběru (combobox) není opuštění řádku
          if (to && (e.currentTarget.contains(to) || (to as HTMLElement).closest?.("[role=listbox]"))) return;
          // hodnota pole (datum) se propíše až po vykreslení
          requestAnimationFrame(() => onLeave());
        }}
      >
        {children}
      </tr>
      {row.error && (
        <tr>
          <td colSpan={99} className={s.err}>
            {row.error}
          </td>
        </tr>
      )}
    </>
  );
}
