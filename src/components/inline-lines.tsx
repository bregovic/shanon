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
import { Button, Checkbox, Input, makeStyles, Select, Tab, TabList, Text, Tooltip, tokens } from "@fluentui/react-components";
import { Add20Regular, Delete20Regular, Tag20Regular } from "@fluentui/react-icons";
import { DimsDialog, DimsEditor, type LineDims } from "./dims-dialog";
import { deleteRecordsAction, listAction, previewRecordAction, saveRecordAction } from "@/app/actions";
import { triggersPreview } from "./use-preview";
import type { FieldMeta } from "@/lib/meta";
import { formatDateInput } from "@/lib/date-input";
import { DateInput } from "./date-input";
import { RecordForm, RefCombobox, type Values } from "./record-form";

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
  selfBalanced?: string | string[];
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
  picked: { backgroundColor: tokens.colorNeutralBackground1Selected },
  current: { outline: `1px solid ${tokens.colorBrandStroke2}`, outlineOffset: "-1px" },
  details: { marginTop: "8px", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground1, padding: "4px 12px 12px" },
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
    const self = b.selfBalanced ? (Array.isArray(b.selfBalanced) ? b.selfBalanced : [b.selfBalanced]).some((f) => r.values[f]) : false;
    const d = self ? 0 : cents(r.values[b.debit]) - cents(r.values[b.credit]);
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
  details,
  dims,
  toolbar,
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
  labels: {
    open: string;
    remove: string;
    total: string;
    empty: string;
    unbalanced?: string;
    balanced?: string;
    keys?: string;
    select?: string;
    selectAll?: string;
    removeSelected?: string;
    clearSelection?: string;
    newLine?: string;
    linesTab?: string;
    lineOf?: string;
    detailKeys?: string;
    dims?: { title: string; account: string; offset: string; ok: string; cancel: string; hint: string; button: string; tab: string; none: string };
  };
  onChanged?: () => void;
  carry?: string[];
  balance?: LineBalance;
  /** podrobnosti vybraného řádku pod mřížkou (záložky) */
  details?: { label: string; fields: FieldMeta[] }[];
  /** dimenze účtu / protiúčtu a jejich dialog (Ctrl+Shift+D) */
  dims?: LineDims;
  /** tlačítka vpravo v liště záložek (import, export) */
  toolbar?: React.ReactNode;
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
    return [...saved, ...(readOnly || saved.length ? [] : [blankFor(saved)])];
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
    // málo sloupců (kontrolní seznam): dlouhý text dostane víc místa
    if (out.length <= 6) for (const c of out) if (c.fields[0].kind === "string" && (c.fields[0].maxLength ?? 0) >= 200) c.width = 420;
    return out;
  }, [metas, parentField]);

  // pole, která se plní sama (číslo dokladu, datum z hlavičky): Tab je přeskočí
  const autoCols = useMemo(() => new Set([balance?.group, ...Object.keys(defaults).filter((k) => k === "date")].filter(Boolean) as string[]), [balance, defaults]);
  // Enter skočí na další řádek do prvního sloupce, který se nepřebírá
  const entryCol = useMemo(() => Math.max(0, columns.findIndex((c) => !autoCols.has(c.key) && !(carry ?? []).includes(c.key) && !c.fields.some((f) => f.readOnly))), [columns, autoCols, carry]);
  // po otevření dokladu: kurzor do posledního řádku na první pole, které se neplní samo (deník: Druh účtu)
  const firstCol = useMemo(() => Math.max(0, columns.findIndex((c) => !autoCols.has(c.key) && !c.fields.some((f) => f.readOnly))), [columns, autoCols]);
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(() => {
      const trs = tbody.current?.querySelectorAll("tr[data-row]");
      const el = trs?.[trs.length - 1]?.querySelectorAll("td")[firstCol + 1]?.querySelector<HTMLElement>("input:not([type=checkbox]), select");
      el?.focus();
    }, 250);
    return () => clearTimeout(t);
    // jen při otevření
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(async () => {
    const r = await listAction(objectId, { filter: { [parentField]: parentId }, sort: sortField, dir: "asc", pageSize: 2000 });
    if (!r.ok) return;
    // rozpracované (neuložené) řádky zachovat
    setRows((cur) => {
      const pending = cur.filter((x) => x.dirty);
      const saved = r.data.rows.map(toEdit).map((x) => pending.find((p) => p.id === x.id) ?? x);
      const fresh = pending.filter((p) => !p.id);
      // rozpracovaný prázdný řádek nechat; nový se přidá až šipkou ↓ / tlačítkem (prázdný doklad má jeden hned)
      const keepBlank = cur.filter((x) => !x.id && !x.dirty);
      return [...saved, ...fresh, ...(readOnly || fresh.length ? [] : keepBlank.length ? keepBlank.slice(0, 1) : saved.length ? [] : [blankFor(saved)])];
    });
  }, [objectId, parentField, parentId, sortField, readOnly, blankFor]);

  const update = (key: string, patch: Partial<EditRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // náhled po řádcích: co uložení doplní (číslo dokladu, datum, protiúčet…) — vidět hned
  const fieldNames = useMemo(() => columns.flatMap((c) => c.fields.map((f) => f.name)), [columns]);
  const pre = useRef(new Map<string, { auto: Set<string>; prov: Set<string>; timer?: ReturnType<typeof setTimeout>; seq: number }>());
  const preOf = (key: string) => {
    let x = pre.current.get(key);
    if (!x) pre.current.set(key, (x = { auto: new Set(), prov: new Set(), seq: 0 }));
    return x;
  };
  const previewRow = useCallback(
    (key: string, delay = 200) => {
      if (readOnly) return;
      const st = preOf(key);
      if (st.timer) clearTimeout(st.timer);
      st.timer = setTimeout(async () => {
        const row = rowsRef.current.find((r) => r.key === key);
        if (!row) return;
        const my = ++st.seq;
        const input: Values = { [parentField]: parentId };
        for (const k of fieldNames) if (!st.auto.has(k)) input[k] = typeof row.values[k] === "string" && /^-?[\d\s]+,\d+$/.test(String(row.values[k])) ? String(row.values[k]).replace(/\s/g, "").replace(",", ".") : (row.values[k] ?? null);
        const r = await previewRecordAction(objectId, row.id, input);
        if (!r.ok || my !== st.seq) return;
        setRows((cur) =>
          cur.map((x) => {
            if (x.key !== key) return x;
            const values = { ...x.values };
            const titles = { ...x.titles };
            for (const k of fieldNames) {
              const v = r.data.values[k];
              const empty = values[k] === null || values[k] === undefined || values[k] === "";
              if (!empty && !st.auto.has(k)) continue;
              if (v === null || v === undefined || v === "") continue;
              values[k] = v;
              st.auto.add(k);
              if (r.data.titles[k]) titles[k] = r.data.titles[k];
            }
            st.prov = new Set(r.data.provisional.filter((k) => st.auto.has(k)));
            return { ...x, values, titles };
          }),
        );
      }, delay);
    },
    [objectId, parentField, parentId, fieldNames, readOnly],
  );
  // nový prázdný řádek: hned ukázat číslo dokladu a doplněné hodnoty
  const blankKey = rows.find((r) => !r.id && !r.dirty)?.key;
  useEffect(() => {
    if (blankKey) previewRow(blankKey, 0);
  }, [blankKey, previewRow]);

  const save = async (key: string) => {
    const row = rowsRef.current.find((r) => r.key === key);
    if (!row || !row.dirty || readOnly) return true;
    const values: Values = {};
    for (const c of columns) for (const f of c.fields) if (!f.readOnly) values[f.name] = typeof row.values[f.name] === "string" && f.kind === "decimal" ? String(row.values[f.name]).replace(/\s/g, "").replace(",", ".") || null : (row.values[f.name] ?? null);
    // pole z podrobností a dimenze (nejsou ve sloupcích mřížky)
    for (const d of details ?? []) for (const f of d.fields) if (!f.readOnly) values[f.name] = row.values[f.name] ?? null;
    for (const d of dims?.defs ?? []) for (const p of [dims!.main, dims!.offset]) values[`${p}${d.slot}`] = row.values[`${p}${d.slot}`] || null;
    // předběžné číslo dokladu z náhledu neposílat — přidělí ho uložení (posune řadu)
    for (const k of pre.current.get(row.key)?.prov ?? []) delete values[k];
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
      // první sloupec je zaškrtnutí řádku
      const el = tr?.querySelectorAll("td")[colIdx + (readOnly ? 0 : 1)]?.querySelector<HTMLElement>("input:not([type=checkbox]), select, button");
      el?.focus();
      if (el instanceof HTMLInputElement) el.select();
    });
  const rowIndex = (key: string) => [...(tbody.current?.querySelectorAll("tr[data-row]") ?? [])].findIndex((t) => t.getAttribute("data-row") === key);

  const onKey = async (e: React.KeyboardEvent, row: EditRow, colIdx: number) => {
    const t = e.target as HTMLElement;
    const combo = t.getAttribute("role") === "combobox";
    const expanded = combo && t.getAttribute("aria-expanded") === "true";
    // Ctrl+Shift+D = dialog dimenzí řádku
    if (dims && e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
      e.preventDefault();
      setDimRow(row.key);
      return;
    }
    // Enter: ve výběru s otevřenou nabídkou vybírá, jinak další pole řádku (na posledním uloží řádek)
    if (e.key === "Enter" && !expanded) {
      e.preventDefault();
      // hodnota pole (datum se převádí při Enteru) se do stavu propíše až po vykreslení
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const tr = (e.target as HTMLElement).closest("tr");
      const inputs = [...(tr?.querySelectorAll<HTMLElement>("input:not([type=checkbox]), select") ?? [])].filter((x) => x.tabIndex !== -1);
      const at = inputs.findIndex((x) => x === e.target || x.contains(e.target as Node));
      // Shift+Enter = předchozí pole (jako Shift+Tab)
      if (e.shiftKey) {
        if (at > 0) {
          inputs[at - 1].focus();
          if (inputs[at - 1] instanceof HTMLInputElement) (inputs[at - 1] as HTMLInputElement).select();
        }
      } else if (at >= 0 && at + 1 < inputs.length) {
        inputs[at + 1].focus();
        if (inputs[at + 1] instanceof HTMLInputElement) (inputs[at + 1] as HTMLInputElement).select();
      } else await save(row.key);
      return;
    }
    // ↓ na posledním řádku: uložit a přidat nový řádek (číslo dokladu podle vyrovnanosti)
    if (e.key === "ArrowDown" && !e.altKey && !expanded && (t.tagName !== "SELECT" || e.ctrlKey) && rowIndex(row.key) === rows.length - 1) {
      e.preventDefault();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (!row.id && !rowsRef.current.find((x) => x.key === row.key)?.dirty) return;
      // nový řádek začíná účtem (první pole, které se nepřebírá)
      await addRow(row.key);
      return;
    }
    // Alt+šipka nechat výběru (rozbalí nabídku), jinak šipky = o řádek výš / níž
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !expanded && (t.tagName !== "SELECT" || e.ctrlKey)) {
      e.preventDefault();
      // opuštěním řádku se uloží (onBlur řádku)
      focusCell(rowIndex(row.key) + (e.key === "ArrowDown" ? 1 : -1), colIdx);
    }
  };

  /** Uložit řádek (pokud je rozpracovaný) a přidat nový pod něj. */
  const addRow = async (fromKey?: string, colIdx?: number) => {
    if (fromKey && !(await save(fromKey))) return;
    await new Promise((r) => setTimeout(r, 0));
    setRows((cur) => (cur.some((x) => !x.id && !x.dirty) ? cur : [...cur, blankFor(cur)]));
    requestAnimationFrame(() => focusCell(rowsRef.current.length, colIdx ?? entryCol));
  };

  // vybraný (aktivní) řádek: podrobnosti pod mřížkou
  const [active, setActive] = useState<string | null>(null);
  const activeRow = rows.find((r) => r.key === active) ?? null;
  const [tab, setTab] = useState("lines");
  const detailRef = useRef<HTMLDivElement>(null);
  const savedRows = rows.filter((r) => r.id);
  // vybraný uložený řádek, jinak poslední uložený (prázdný nový řádek podrobnosti nemá)
  const current = (activeRow?.id ? activeRow : null) ?? savedRows[savedRows.length - 1] ?? null;
  // záložka podrobností: kurzor do prvního pole vybraného řádku
  const openTab = (v: string) => {
    if (v !== "lines" && current && activeRow?.key !== current.key) setActive(current.key);
    setTab(v);
    if (v !== "lines") setTimeout(() => detailRef.current?.querySelector<HTMLElement>("input, select, button")?.focus(), 60);
  };
  // šipky ↑/↓ v podrobnostech = předchozí / další řádek (rozpracovaný se uloží)
  const stepRow = async (dir: 1 | -1) => {
    if (!current) return;
    const i = savedRows.findIndex((r) => r.key === current.key);
    const next = savedRows[i + dir];
    if (!next) return;
    if (current.dirty) await save(current.key);
    setActive(next.key);
    setTimeout(() => detailRef.current?.querySelector<HTMLElement>("input, select, button")?.focus(), 30);
  };
  const [dimRow, setDimRow] = useState<string | null>(null);
  const dimTarget = rows.find((r) => r.key === dimRow) ?? null;
  const patchRow = (key: string, patch: Values) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, values: { ...r.values, ...patch }, dirty: true, error: undefined } : r)));
  const applyDims = async (key: string, patch: Values) => {
    patchRow(key, patch);
    setDimRow(null);
    await new Promise((r) => setTimeout(r, 0));
    await save(key);
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

  // výběr řádků (zaškrtnutí na začátku řádku, Shift = rozsah) a hromadné mazání
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string>();
  const lastPick = useRef<string | null>(null);
  const savedIds = rows.filter((r) => r.id).map((r) => r.id!);
  const pick = (id: string, on: boolean, range: boolean) => {
    const a = lastPick.current ? savedIds.indexOf(lastPick.current) : -1;
    const b = savedIds.indexOf(id);
    const ids = range && a >= 0 ? savedIds.slice(Math.min(a, b), Math.max(a, b) + 1) : [id];
    lastPick.current = id;
    setSelected((cur) => {
      const n = new Set(cur);
      for (const x of ids) {
        if (on) n.add(x);
        else n.delete(x);
      }
      return n;
    });
  };
  const removeSelected = async () => {
    const ids = savedIds.filter((x) => selected.has(x));
    if (!ids.length) return;
    const res = await deleteRecordsAction(objectId, ids);
    if (!res.ok) return setBulkError(res.message);
    setBulkError(undefined);
    setSelected(new Set());
    await reload();
    onChanged?.();
  };

  const diffs = useMemo(() => groupDiffs(rows, balance), [rows, balance]);

  const cell = (row: EditRow, c: Column, colIdx: number) => {
    const f = c.fields.find((x) => visible(x, row.values)) ?? null;
    if (!f) return null;
    const v = row.values[f.name];
    const set = (value: unknown, title?: string) => {
      const st = preOf(row.key);
      st.auto.delete(f.name);
      st.prov.delete(f.name);
      update(row.key, { values: { ...row.values, [f.name]: value }, titles: title !== undefined ? { ...row.titles, [f.name]: title } : row.titles, dirty: true, error: undefined });
      if (triggersPreview(f.kind)) previewRow(row.key);
    };
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
            <RefCombobox compact f={f} value={String(v ?? "")} title={row.titles[f.name] ?? ""} disabled={false} openLabel={labels.open} onBeforeOpen={() => (row.dirty ? save(row.key) : undefined)} onChange={(_, value, title) => set(value, title)} />
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
        return <Input size="small" style={{ width: "100%" }} value={String(v ?? "")} onChange={(_, d) => set(d.value)} {...common} aria-label={f.label} />;
    }
  };

  const groupOpen = (r: EditRow) => !!balance && !!r.id && (diffs.get(String(r.values[balance.group] ?? "")) ?? 0) !== 0;

  const tabsBar = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <TabList selectedValue={tab} onTabSelect={(_, d) => openTab(String(d.value))}>
        <Tab value="lines">{labels.linesTab ?? "Řádky"}</Tab>
        {(details ?? []).map((d, i) => (
          <Tab key={i} value={String(i)} disabled={!current}>
            {d.label}
          </Tab>
        ))}
        {dims && labels.dims && (
          <Tab value="dims" disabled={!current}>
            {labels.dims.tab}
          </Tab>
        )}
      </TabList>
      <span style={{ flex: 1 }} />
      {toolbar}
    </div>
  );

  if (tab !== "lines" && current)
    return (
      <div>
        {tabsBar}
        <div
          ref={detailRef}
          className={s.details}
          onKeyDown={(e) => {
            const t = e.target as HTMLElement;
            const expanded = t.getAttribute("aria-expanded") === "true";
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !expanded && t.tagName !== "SELECT") {
              e.preventDefault();
              void stepRow(e.key === "ArrowDown" ? 1 : -1);
            }
            if (e.key === "Escape") openTab("lines");
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node) && current.dirty) void save(current.key);
          }}
        >
          <Text weight="semibold" block style={{ padding: "8px 0" }}>
            {(labels.lineOf ?? "Řádek {n} z {count}").replace("{n}", String(savedRows.findIndex((r) => r.key === current.key) + 1)).replace("{count}", String(savedRows.length))}
            {" · "}
            {[current.values[balance?.group ?? ""], ...columns.flatMap((c) => c.fields.filter((f) => f.kind === "ref" && visible(f, current.values)).map((f) => current.titles[f.name])).slice(0, 1), current.values.text]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {tab !== "dims" && details?.[Number(tab)] && (
            <RecordForm
              groups={[{ label: "", fields: details[Number(tab)].fields }]}
              columns={4}
              values={current.values}
              titles={current.titles}
              errors={{}}
              readOnly={readOnly}
              openLabel={labels.open}
              onChange={(name, value, title) =>
                update(current.key, { values: { ...current.values, [name]: value }, titles: title !== undefined ? { ...current.titles, [name]: title } : current.titles, dirty: true, error: undefined })
              }
            />
          )}
          {tab === "dims" && dims && labels.dims && (
            <DimsEditor
              key={current.key}
              dims={dims}
              values={current.values}
              labels={labels.dims}
              onChange={(patch) => update(current.key, { values: { ...current.values, ...patch }, dirty: true, error: undefined })}
              onDone={() => void stepRow(1)}
            />
          )}
          <Text block className={s.hint} style={{ paddingTop: 8 }}>
            {labels.detailKeys ?? "↑/↓ = předchozí / další řádek · Esc = zpět na řádky"}
          </Text>
        </div>
        {dims && labels.dims && dimTarget && (
          <DimsDialog open dims={dims} values={dimTarget.values} labels={labels.dims} onOk={(patch) => void applyDims(dimTarget.key, patch)} onCancel={() => setDimRow(null)} />
        )}
      </div>
    );

  return (
    <div>
      {tabsBar}
      <div className={s.wrap} style={{ maxHeight: "calc(100vh - 260px)" }}>
        <table className={s.table} style={{ minWidth: columns.reduce((a, c) => a + c.width, 60) }}>
          <thead>
            <tr>
              {!readOnly && (
                <th className={s.th} style={{ width: 32 }}>
                  <Checkbox
                    aria-label={labels.selectAll ?? "Vybrat vše"}
                    checked={savedIds.length > 0 && savedIds.every((x) => selected.has(x)) ? true : selected.size ? "mixed" : false}
                    onChange={(_, d) => setSelected(d.checked === true ? new Set(savedIds) : new Set())}
                    tabIndex={-1}
                  />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} className={`${s.th} ${c.fields[0].kind === "decimal" ? s.num : ""}`} style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              <th className={s.th} style={{ width: dims ? 72 : 40 }} />
            </tr>
          </thead>
          <tbody ref={tbody}>
            {rows.map((r) => (
              <RowView key={r.key} row={r} s={s} open={groupOpen(r)} picked={!!r.id && selected.has(r.id)} current={r.key === active} onEnter={() => setActive(r.key)} onLeave={() => void save(r.key)}>
                {!readOnly && (
                  <td className={s.td} style={{ textAlign: "center" }}>
                    {r.id && (
                      <Checkbox
                        aria-label={labels.select ?? "Vybrat"}
                        checked={selected.has(r.id)}
                        tabIndex={-1}
                        onClick={(e) => {
                          e.preventDefault();
                          pick(r.id!, !selected.has(r.id!), e.shiftKey);
                        }}
                      />
                    )}
                  </td>
                )}
                {columns.map((c, i) => (
                  <td key={c.key} className={s.td}>
                    {cell(r, c, i)}
                  </td>
                ))}
                <td className={s.td} style={{ whiteSpace: "nowrap" }}>
                  {!readOnly && dims && labels.dims && (
                    <Tooltip content={`${labels.dims.button} (Ctrl+Shift+D)`} relationship="label">
                      <Button size="small" appearance="subtle" tabIndex={-1} icon={<Tag20Regular />} onClick={() => setDimRow(r.key)} />
                    </Tooltip>
                  )}
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
              {!readOnly && <td className={s.td} />}
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
      {!readOnly && selected.size > 0 && (
        <div className={s.hint} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button size="small" icon={<Delete20Regular />} onClick={() => void removeSelected()}>
            {(labels.removeSelected ?? "Smazat vybrané ({n})").replace("{n}", String(selected.size))}
          </Button>
          <Button size="small" appearance="subtle" onClick={() => setSelected(new Set())}>
            {labels.clearSelection ?? "Zrušit výběr"}
          </Button>
          {bulkError && <span className={s.warn}>{bulkError}</span>}
        </div>
      )}
      {balance && rows.some((r) => r.id) && (
        <div className={s.hint}>
          {/* vyrovnanost hlídá Ověřit a Zaúčtovat; dole jen nápověda kláves */}
          {!readOnly && labels.keys ? <span>{labels.keys}</span> : null}
        </div>
      )}
      {!readOnly && rows.some((r) => r.id) && !rows.some((r) => !r.id) && (
        <div className={s.hint}>
          <Button size="small" appearance="subtle" icon={<Add20Regular />} onClick={() => void addRow()}>
            {labels.newLine ?? "Nový řádek"} (↓)
          </Button>
        </div>
      )}
      {dims && labels.dims && dimTarget && (
        <DimsDialog open dims={dims} values={dimTarget.values} labels={labels.dims} onOk={(patch) => void applyDims(dimTarget.key, patch)} onCancel={() => setDimRow(null)} />
      )}
    </div>
  );
}

/** Řádek: uloží se, když z něj odejde fokus (klik jinam, Tab za poslední pole, šipka). */
function RowView({ row, s, open, picked, current, onEnter, onLeave, children }: { row: EditRow; s: ReturnType<typeof useStyles>; open: boolean; picked?: boolean; current?: boolean; onEnter?: () => void; onLeave: () => void; children: React.ReactNode }) {
  return (
    <>
      <tr
        data-row={row.key}
        className={[row.error ? s.bad : row.dirty ? s.dirty : !row.id ? s.newRow : "", open ? s.open : "", picked ? s.picked : "", current ? s.current : ""].join(" ").trim() || undefined}
        onFocus={onEnter}
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
