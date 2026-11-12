"use client";

/**
 * SmartGrid — převzatý SmartDataGrid staré verze (menu sloupce s filtrem
 * a řazením, výběr řádků, dvojklik otevře záznam). Filtrování, řazení
 * a stránkování ale běží na serveru (listAction), takže zvládne i velké tabulky.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  makeStyles,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  TableSelectionCell,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowSortDown24Regular,
  ArrowSortUp24Regular,
  ChevronDown24Regular,
  Filter24Regular,
  FilterDismiss24Regular,
  QuestionCircle24Regular,
} from "@fluentui/react-icons";
import { listAction } from "@/app/actions";
import { displayValue, type FieldMeta } from "@/lib/meta";

type Row = Record<string, unknown>;

export interface GridLabels {
  sortAsc: string;
  sortDesc: string;
  filterPlaceholder: string;
  filterOperators: string;
  apply: string;
  clear: string;
  clearAll: string;
  loadMore: string;
  empty: string;
  records: string;
  selected: string;
  help: [string, string][];
}

interface Props {
  objectId: string;
  columns: FieldMeta[];
  lang: string;
  labels: GridLabels;
  initial?: { rows: Row[]; total: number };
  /** pevný filtr (řádky dokladu: { journalId }) */
  fixed?: Record<string, string>;
  pageSize?: number;
  selectable?: boolean;
  onOpen?: (row: Row) => void;
  onSelectionChange?: (rows: Row[]) => void;
  /** změna čísla vynutí nové načtení (po uložení/smazání) */
  reloadKey?: number;
  /** klíč pro zapamatování filtrů v rámci relace prohlížeče */
  storageKey?: string;
  maxHeight?: string;
}

interface View {
  filters: Record<string, string>;
  sort?: string;
  dir: "asc" | "desc";
}

const useStyles = makeStyles({
  wrap: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    minHeight: 0,
  },
  scroll: { overflow: "auto", minHeight: 0 },
  head: { position: "sticky", top: 0, zIndex: 2, backgroundColor: tokens.colorNeutralBackground1 },
  headCell: { padding: 0, "& > div": { width: "100%" } },
  headInner: {
    display: "flex",
    alignItems: "stretch",
    width: "100%",
    height: "100%",
    minHeight: "36px",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  headLabel: {
    flexGrow: 1,
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "0 8px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontWeight: tokens.fontWeightSemibold,
  },
  headSort: {
    display: "flex",
    alignItems: "center",
    padding: "0 6px",
    cursor: "pointer",
    color: tokens.colorNeutralForeground3,
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Pressed },
  },
  active: { color: tokens.colorBrandForeground1 },
  row: { cursor: "default", userSelect: "none" },
  cell: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  neg: { color: tokens.colorPaletteRedForeground1 },
  foot: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "6px 12px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  empty: { padding: "32px", textAlign: "center", color: tokens.colorNeutralForeground3 },
  help: { padding: "12px", maxWidth: "320px", fontSize: tokens.fontSizeBase200 },
});

function ColumnMenu({
  col,
  view,
  labels,
  onSort,
  onFilter,
}: {
  col: FieldMeta;
  view: View;
  labels: GridLabels;
  onSort: (dir: "asc" | "desc") => void;
  onFilter: (v: string) => void;
}) {
  const s = useStyles();
  const current = view.filters[col.name] ?? "";
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState(current);
  const inputRef = useRef<HTMLInputElement>(null);
  const sorted = view.sort === col.name;
  const apply = (v: string) => {
    onFilter(v);
    setOpen(false);
  };

  return (
    <div className={s.headInner}>
      <Menu
        open={open}
        onOpenChange={(_, d) => {
          setOpen(d.open);
          if (d.open) {
            setTemp(current);
            // menu si po otevření bere fokus samo — vrátit ho do pole filtru
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <div className={s.headLabel} data-col={col.name} style={{ justifyContent: col.align === "right" ? "flex-end" : "flex-start" }}>
            {col.label}
            {current && <Filter24Regular className={s.active} fontSize={16} />}
          </div>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<ArrowSortUp24Regular />} onClick={() => onSort("asc")}>
              {labels.sortAsc}
            </MenuItem>
            <MenuItem icon={<ArrowSortDown24Regular />} onClick={() => onSort("desc")}>
              {labels.sortDesc}
            </MenuItem>
            {!col.ext && (
              <>
                <MenuDivider />
                <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <Input
                      ref={inputRef}
                      value={temp}
                      placeholder={labels.filterPlaceholder}
                      onChange={(_, d) => setTemp(d.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") apply(temp);
                      }}
                      style={{ flexGrow: 1 }}
                    />
                    <Popover withArrow>
                      <PopoverTrigger disableButtonEnhancement>
                        <Button size="small" appearance="transparent" icon={<QuestionCircle24Regular />} aria-label={labels.filterOperators} />
                      </PopoverTrigger>
                      <PopoverSurface className={s.help}>
                        <strong>{labels.filterOperators}</strong>
                        <table style={{ marginTop: 8, borderSpacing: "8px 2px" }}>
                          <tbody>
                            {labels.help.map(([code, text]) => (
                              <tr key={code}>
                                <td>
                                  <code>{code}</code>
                                </td>
                                <td>{text}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </PopoverSurface>
                    </Popover>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="small" appearance="primary" style={{ flex: 1 }} onClick={() => apply(temp)}>
                      {labels.apply}
                    </Button>
                    <Button size="small" disabled={!current && !temp} onClick={() => apply("")}>
                      {labels.clear}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
      {!col.ext && (
        <div className={s.headSort} onClick={() => onSort(sorted && view.dir === "asc" ? "desc" : "asc")}>
          {sorted ? (
            view.dir === "asc" ? (
              <ArrowSortUp24Regular fontSize={16} className={s.active} />
            ) : (
              <ArrowSortDown24Regular fontSize={16} className={s.active} />
            )
          ) : (
            <ChevronDown24Regular fontSize={16} />
          )}
        </div>
      )}
    </div>
  );
}

function loadView(key?: string): View {
  if (key) {
    try {
      const v = sessionStorage.getItem(`grid:${key}`);
      if (v) return JSON.parse(v);
    } catch {
      /* úložiště nedostupné */
    }
  }
  return { filters: {}, dir: "asc" };
}

export function SmartGrid({
  objectId,
  columns,
  lang,
  labels,
  initial,
  fixed,
  pageSize = 100,
  selectable = true,
  onOpen,
  onSelectionChange,
  reloadKey = 0,
  storageKey,
  maxHeight = "calc(100vh - 190px)",
}: Props) {
  const s = useStyles();
  const [view, setView] = useState<View>({ filters: {}, dir: "asc" });
  const [rows, setRows] = useState<Row[]>(initial?.rows ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const restored = useRef(false);
  const reqId = useRef(0);
  const fixedKey = JSON.stringify(fixed ?? {});

  const fetchPage = useCallback(
    async (p: number, append: boolean) => {
      const my = ++reqId.current;
      setLoading(true);
      const res = await listAction(objectId, {
        filters: view.filters,
        sort: view.sort,
        dir: view.dir,
        page: p,
        pageSize,
        filter: JSON.parse(fixedKey),
      });
      if (my !== reqId.current) return; // mezitím přišel novější požadavek
      setLoading(false);
      if (!res.ok) return;
      setRows((prev) => (append ? [...prev, ...res.data.rows] : res.data.rows));
      setTotal(res.data.total);
      setPage(p);
    },
    [objectId, view, pageSize, fixedKey],
  );

  useEffect(() => {
    if (!restored.current) {
      // první běh: obnovit filtry z relace prohlížeče, jinak použít data ze serveru
      restored.current = true;
      const v = loadView(storageKey);
      if (Object.keys(v.filters).length || v.sort) {
        // synchronizace s úložištěm prohlížeče až po hydrataci (server ho nezná)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView(v);
        return;
      }
      if (initial) return;
    }
    if (storageKey) {
      try {
        sessionStorage.setItem(`grid:${storageKey}`, JSON.stringify(view));
      } catch {
        /* úložiště nedostupné */
      }
    }
    setSelected(new Set());
    fetchPage(1, false);
    // initial záměrně jen při prvním běhu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, reloadKey, fetchPage, storageKey]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(String(r.id))), [rows, selected]);
  useEffect(() => onSelectionChange?.(selectedRows), [selectedRows, onSelectionChange]);

  const toggle = (id: string, only: boolean) =>
    setSelected((prev) => {
      if (only) return prev.has(id) && prev.size === 1 ? new Set() : new Set([id]);
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // minimální šířky sloupců — na úzkém displeji se grid posouvá do strany, nemačká
  const colWidth = (c: FieldMeta) => (c.kind === "string" || c.kind === "text" || c.kind === "ref" ? 160 : c.kind === "bool" ? 90 : 120);
  const minTableWidth = columns.reduce((a, c) => a + colWidth(c), selectable ? 44 : 0);
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const filterCount = Object.keys(view.filters).length;

  return (
    <div className={s.wrap}>
      <div className={s.scroll} style={{ maxHeight }}>
        <Table size="small" aria-label={objectId} style={{ minWidth: `max(100%, ${minTableWidth}px)` }}>
          <TableHeader className={s.head}>
            <TableRow>
              {selectable && (
                <TableSelectionCell
                  type="checkbox"
                  checked={allSelected ? true : selected.size > 0 ? "mixed" : false}
                  onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => String(r.id))))}
                />
              )}
              {columns.map((c) => (
                <TableHeaderCell key={c.name} className={s.headCell}>
                  <ColumnMenu
                    col={c}
                    view={view}
                    labels={labels}
                    onSort={(dir) => setView((v) => ({ ...v, sort: c.name, dir }))}
                    onFilter={(val) =>
                      setView((v) => {
                        const filters = { ...v.filters };
                        if (val.trim()) filters[c.name] = val;
                        else delete filters[c.name];
                        return { ...v, filters };
                      })
                    }
                  />
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const id = String(r.id);
              const isSel = selected.has(id);
              return (
                <TableRow
                  key={id}
                  className={s.row}
                  aria-selected={isSel}
                  appearance={isSel ? "brand" : "none"}
                  onClick={(e) => selectable && toggle(id, !(e.ctrlKey || e.metaKey))}
                  onDoubleClick={() => onOpen?.(r)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen?.(r)}
                  tabIndex={0}
                >
                  {selectable && (
                    <TableSelectionCell
                      type="checkbox"
                      checked={isSel}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(id, false);
                      }}
                    />
                  )}
                  {columns.map((c) => {
                    const text = displayValue(c, r, lang);
                    const neg = c.kind === "decimal" && String(r[c.name] ?? "").startsWith("-");
                    return (
                      <TableCell key={c.name} className={`${s.cell} ${neg ? s.neg : ""}`} style={{ textAlign: c.align }}>
                        {text}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!loading && rows.length === 0 && <div className={s.empty}>{labels.empty}</div>}
      </div>
      <div className={s.foot}>
        <span>
          {labels.records}: {total}
          {selected.size > 0 && ` · ${labels.selected}: ${selected.size}`}
        </span>
        {filterCount > 0 && (
          <Button size="small" appearance="subtle" icon={<FilterDismiss24Regular />} onClick={() => setView((v) => ({ ...v, filters: {} }))}>
            {labels.clearAll}
          </Button>
        )}
        <span style={{ flex: 1 }} />
        {loading && <Spinner size="extra-tiny" />}
        {rows.length < total && !loading && (
          <Button size="small" appearance="subtle" onClick={() => fetchPage(page + 1, true)}>
            {labels.loadMore}
          </Button>
        )}
      </div>
    </div>
  );
}
