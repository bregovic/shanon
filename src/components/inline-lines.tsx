"use client";

/**
 * Řádky dokladu upravované přímo v mřížce (deník jako v AX): každý řádek
 * je řádek tabulky s poli, ukládá se při opuštění řádku nebo Enterem,
 * poslední prázdný řádek slouží k založení dalšího. Pole se stejným
 * `gridColumn` (účet podle druhu) sdílí jeden sloupec — ukáže se to, které
 * podle `visibleWhen` platí.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Input, makeStyles, Select, Text, Tooltip, tokens } from "@fluentui/react-components";
import { Delete20Regular } from "@fluentui/react-icons";
import { deleteRecordsAction, listAction, saveRecordAction } from "@/app/actions";
import type { FieldMeta } from "@/lib/meta";
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
});

interface Column {
  key: string;
  label: string;
  fields: FieldMeta[];
  width: number;
}

const visible = (f: FieldMeta, v: Values) => !f.visibleWhen || f.visibleWhen.in.includes(String(v[f.visibleWhen.field] ?? ""));
let seq = 0;
const blank = (defaults: Values): EditRow => ({ key: `new${seq++}`, id: null, values: { ...defaults }, titles: {}, dirty: false });
const toEdit = (r: Row): EditRow => ({ key: String(r.id), id: String(r.id), version: r.version as number, values: { ...r, ...((r.ext as Values) ?? {}) }, titles: (r._titles as Record<string, string>) ?? {}, dirty: false });

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
  labels: { open: string; remove: string; total: string; empty: string };
  onChanged?: () => void;
}) {
  const s = useStyles();
  const [rows, setRows] = useState<EditRow[]>(() => [...initial.map(toEdit), ...(readOnly ? [] : [blank(defaults)])]);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const nf = useMemo(() => new Intl.NumberFormat(lang === "en" ? "en-GB" : "cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [lang]);

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
          width: f.kind === "ref" ? 190 : f.kind === "decimal" ? 110 : f.kind === "date" ? 130 : f.kind === "enum" ? 130 : f.kind === "bool" ? 50 : f.name === "text" ? 220 : 120,
        });
    }
    return out;
  }, [metas, parentField]);

  const reload = useCallback(async () => {
    const r = await listAction(objectId, { filter: { [parentField]: parentId }, sort: sortField, dir: "asc", pageSize: 200 });
    if (!r.ok) return;
    // rozpracované (neuložené) řádky zachovat
    setRows((cur) => {
      const pending = cur.filter((x) => x.dirty);
      const saved = r.data.rows.map(toEdit).map((x) => pending.find((p) => p.id === x.id) ?? x);
      const fresh = pending.filter((p) => !p.id);
      return [...saved, ...fresh, ...(readOnly || fresh.length ? [] : [blank(defaults)])];
    });
  }, [objectId, parentField, parentId, sortField, readOnly, defaults]);

  const update = (key: string, patch: Partial<EditRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async (row: EditRow) => {
    if (!row.dirty || readOnly) return true;
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

  // Enter = uložit řádek a přejít na další (stejný sloupec)
  const onKey = async (e: React.KeyboardEvent, row: EditRow, colIdx: number) => {
    if (e.key !== "Enter" || (e.target as HTMLElement).getAttribute("role") === "combobox") return;
    e.preventDefault();
    if (!(await save(row))) return;
    requestAnimationFrame(() => {
      const trs = tbody.current?.querySelectorAll("tr[data-row]");
      const idx = [...(trs ?? [])].findIndex((t) => t.getAttribute("data-row") === row.key);
      const next = trs?.[idx + 1] ?? trs?.[trs.length - 1];
      const cell = next?.querySelectorAll("td")[colIdx];
      cell?.querySelector<HTMLElement>("input, select, button")?.focus();
    });
  };

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of columns) {
      const f = c.fields[0];
      if (f.kind !== "decimal" || f.noTotal) continue;
      t[c.key] = rows.reduce((a, r) => a + (r.id ? Number(String(r.values[f.name] ?? 0).replace(",", ".")) || 0 : 0), 0);
    }
    return t;
  }, [rows, columns]);

  const cell = (row: EditRow, c: Column, colIdx: number) => {
    const f = c.fields.find((x) => visible(x, row.values)) ?? null;
    if (!f) return null;
    const v = row.values[f.name];
    const set = (value: unknown, title?: string) =>
      update(row.key, { values: { ...row.values, [f.name]: value }, titles: title !== undefined ? { ...row.titles, [f.name]: title } : row.titles, dirty: true, error: undefined });
    if (readOnly || f.readOnly) {
      const shown = f.kind === "ref" ? row.titles[f.name] : f.kind === "enum" ? f.options?.find((o) => o.value === v)?.label : f.kind === "decimal" && v !== null && v !== undefined && v !== "" ? nf.format(Number(v)) : v;
      return <div className={`${s.ro} ${f.kind === "decimal" ? s.num : ""}`}>{String(shown ?? "")}</div>;
    }
    const common = { onKeyDown: (e: React.KeyboardEvent) => void onKey(e, row, colIdx) };
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
        return <Input size="small" type="date" value={String(v ?? "")} onChange={(_, d) => set(d.value || null)} {...common} aria-label={f.label} />;
      case "decimal":
      case "int":
        return <Input size="small" inputMode="decimal" value={v === null || v === undefined ? "" : String(v)} input={{ style: { textAlign: "right" } }} onChange={(_, d) => set(d.value)} {...common} aria-label={f.label} />;
      default:
        return <Input size="small" value={String(v ?? "")} onChange={(_, d) => set(d.value)} {...common} aria-label={f.label} />;
    }
  };

  return (
    <div className={s.wrap} style={{ maxHeight: "calc(100vh - 240px)" }}>
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
            <RowView key={r.key} row={r} s={s} onLeave={() => void save(r)}>
              {columns.map((c, i) => (
                <td key={c.key} className={s.td}>
                  {cell(r, c, i)}
                </td>
              ))}
              <td className={s.td}>
                {!readOnly && (r.id || r.dirty) && (
                  <Tooltip content={labels.remove} relationship="label">
                    <Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={() => void remove(r)} />
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
  );
}

/** Řádek: uloží se, když z něj odejde fokus (klik jinam, Tab za poslední pole). */
function RowView({ row, s, onLeave, children }: { row: EditRow; s: ReturnType<typeof useStyles>; onLeave: () => void; children: React.ReactNode }) {
  return (
    <>
      <tr
        data-row={row.key}
        className={row.error ? s.bad : row.dirty ? s.dirty : !row.id ? s.newRow : undefined}
        onBlur={(e) => {
          const to = e.relatedTarget as Node | null;
          // přechod do vyskakovacího výběru (combobox) není opuštění řádku
          if (to && (e.currentTarget.contains(to) || (to as HTMLElement).closest?.("[role=listbox]"))) return;
          if (row.dirty) onLeave();
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
