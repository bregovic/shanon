"use client";

/**
 * Dialog finančních dimenzí řádku (účet a protiúčet) ovládaný klávesnicí: kurzor skočí na první
 * relevantní dimenzi účtu (povinnou podle účtu, jinak první), psaním se hledá v hodnotách dimenze,
 * šipky vybírají, Enter potvrdí a skočí na další dimenzi; za poslední dimenzí Enter dialog potvrdí.
 * Dimenze účtu se předvyplní do protiúčtu (dokud ji tam uživatel nezměnil).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, makeStyles, Option, Text, tokens } from "@fluentui/react-components";
import { getRecordAction, searchRefs } from "@/app/actions";

export interface LineDims {
  main: string;
  offset: string;
  account: string;
  offsetAccount: string;
  offsetType?: string;
  defs: { slot: number; name: string; id: string }[];
}

type Values = Record<string, unknown>;

const useStyles = makeStyles({
  cols: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" },
  head: { fontWeight: tokens.fontWeightSemibold, marginBottom: "4px" },
  req: { color: tokens.colorPaletteRedForeground1 },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

function DimLookup({
  dimId,
  value,
  onChange,
  onMove,
  inputRef,
}: {
  dimId: string;
  value: string;
  onChange: (v: string) => void;
  onMove: (dir: 1 | -1) => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ id: string; title: string; subtitle: string }[]>([]);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setQuery(value);
  }
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      searchRefs("gl.dimensionValue", query === value ? "" : query, { dimensionId: dimId }).then(setOptions);
    }, 120);
    return () => clearTimeout(t);
  }, [query, open, dimId, value]);
  return (
    <Combobox
      size="small"
      freeform
      value={query}
      open={open}
      expandIcon={{ tabIndex: -1 }}
      input={{ ref: inputRef }}
      onOpenChange={(_, d) => setOpen(d.open)}
      onChange={(e) => {
        setQuery(e.target.value.toUpperCase());
        setOpen(true);
        if (!e.target.value) onChange("");
      }}
      onOptionSelect={(_, d) => {
        const o = options.find((x) => x.id === d.optionValue);
        if (!o) return;
        setQuery(o.title);
        onChange(o.title);
        // výběr Enterem → další dimenze
        setTimeout(() => onMove(1), 0);
      }}
      onKeyDown={(e) => {
        // Enter bez nabídky (zavřená, nebo hodnota, kterou číselník nezná): potvrdit napsané a jít dál
        // Shift+Enter = předchozí dimenze (vždy)
        if (e.key === "Enter" && (!open || !options.length || e.shiftKey)) {
          e.preventDefault();
          setOpen(false);
          if (query.trim().toUpperCase() !== value) onChange(query.trim().toUpperCase());
          onMove(e.shiftKey ? -1 : 1);
        }
      }}
      onBlur={() => {
        // odchod z pole: napsané potvrdit
        if (query.trim().toUpperCase() !== value) onChange(query.trim().toUpperCase());
      }}
    >
      {options.map((o) => (
        <Option key={o.id} value={o.id} text={o.title}>
          <span style={{ fontWeight: 600 }}>{o.title}</span>
          {o.subtitle && <span style={{ marginLeft: 8, color: tokens.colorNeutralForeground3 }}>{o.subtitle}</span>}
        </Option>
      ))}
    </Combobox>
  );
}

/**
 * Editor dimenzí účtu a protiúčtu (obsah dialogu i záložky Dimenze): Enter = výběr a další
 * dimenze, Shift+Enter = předchozí, za poslední dimenzí `onDone`. Řízený zvenku (values / onChange).
 */
export function DimsEditor({
  dims,
  values,
  onChange,
  onDone,
  labels,
  autoFocus = true,
}: {
  dims: LineDims;
  values: Values;
  onChange: (patch: Values) => void;
  onDone?: () => void;
  labels: { account: string; offset: string };
  autoFocus?: boolean;
}) {
  const s = useStyles();
  const hasOffset = !dims.offsetType || !!values[dims.offsetType];
  const order = useMemo(() => [...dims.defs.map((d) => `${dims.main}${d.slot}`), ...(hasOffset ? dims.defs.map((d) => `${dims.offset}${d.slot}`) : [])], [dims, hasOffset]);
  const [req, setReq] = useState<Record<number, string>>({});
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const account = values[dims.account] as string | undefined;

  // povinnost dimenzí podle účtu; kurzor na první povinnou nevyplněnou (jinak první)
  useEffect(() => {
    let alive = true;
    (account ? getRecordAction("gl.account", account) : Promise.resolve(null)).then((r) => {
      if (!alive) return;
      const rq: Record<number, string> = {};
      const rec = r && "ok" in r && r.ok ? r.data : null;
      for (const d of dims.defs) rq[d.slot] = String(rec?.[`dim${d.slot}Req`] ?? "optional");
      setReq(rq);
      if (autoFocus) {
        const first = dims.defs.findIndex((d) => rq[d.slot] === "mandatory" && !values[`${dims.main}${d.slot}`]);
        setTimeout(() => refs.current[first >= 0 ? first : 0]?.focus(), 80);
      }
    });
    return () => {
      alive = false;
    };
    // účet řádku (nová povinnost); hodnoty ne — kurzor jen při otevření / změně účtu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, dims]);

  const set = (k: string, val: string) => {
    const patch: Values = { [k]: val };
    // účet → protiúčet: předvyplnit, dokud protiúčet má prázdno nebo stejnou hodnotu jako dřív účet
    if (k.startsWith(dims.main) && hasOffset) {
      const ok = `${dims.offset}${k.slice(dims.main.length)}`;
      if (!values[ok] || values[ok] === values[k]) patch[ok] = val;
    }
    onChange(patch);
  };
  const move = (i: number, dir: 1 | -1) => {
    const j = i + dir;
    if (j >= 0 && j < order.length) refs.current[j]?.focus();
    else if (dir === 1) onDone?.();
  };

  return (
    <div className={s.cols}>
      <Text className={s.head}>{labels.account}</Text>
      <Text className={s.head}>{hasOffset ? labels.offset : ""}</Text>
      {dims.defs.map((d, i) => (
        <div key={d.slot} style={{ display: "contents" }}>
          <Field label={<span>{d.name}{req[d.slot] === "mandatory" && <span className={s.req}> *</span>}</span>} size="small">
            <DimLookup dimId={d.id} value={String(values[`${dims.main}${d.slot}`] ?? "")} onChange={(x) => set(`${dims.main}${d.slot}`, x)} onMove={(dir) => move(i, dir)} inputRef={(el) => (refs.current[i] = el)} />
          </Field>
          {hasOffset ? (
            <Field label={d.name} size="small">
              <DimLookup
                dimId={d.id}
                value={String(values[`${dims.offset}${d.slot}`] ?? "")}
                onChange={(x) => set(`${dims.offset}${d.slot}`, x)}
                onMove={(dir) => move(dims.defs.length + i, dir)}
                inputRef={(el) => (refs.current[dims.defs.length + i] = el)}
              />
            </Field>
          ) : (
            <div />
          )}
        </div>
      ))}
    </div>
  );
}

export function DimsDialog({
  open,
  dims,
  values,
  labels,
  onOk,
  onCancel,
}: {
  open: boolean;
  dims: LineDims;
  values: Values;
  labels: { title: string; account: string; offset: string; ok: string; cancel: string; hint: string };
  onOk: (patch: Values) => void;
  onCancel: () => void;
}) {
  const s = useStyles();
  // dialog se připojuje při otevření: hodnoty řádku jako výchozí stav
  const [v, setV] = useState<Values>(() => ({ ...values }));
  // poslední hodnoty pro Enter za poslední dimenzí (stav se propíše až po vykreslení)
  const vRef = useRef(v);
  useEffect(() => {
    vRef.current = v;
  }, [v]);
  const pick = (all: Values) => Object.fromEntries(dims.defs.flatMap((d) => [`${dims.main}${d.slot}`, `${dims.offset}${d.slot}`]).map((k) => [k, all[k] ?? ""]));
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onCancel()}>
      <DialogSurface style={{ maxWidth: 720 }}>
        <DialogBody>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogContent>
            <Text className={s.hint} block style={{ marginBottom: 12 }}>
              {labels.hint}
            </Text>
            <DimsEditor dims={dims} values={v} labels={labels} onChange={(p) => setV((cur) => ({ ...cur, ...p }))} onDone={() => setTimeout(() => onOk(pick(vRef.current)), 0)} />
          </DialogContent>
          <DialogActions>
            <Button onClick={onCancel}>{labels.cancel}</Button>
            <Button appearance="primary" onClick={() => onOk(pick(v))}>
              {labels.ok}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
