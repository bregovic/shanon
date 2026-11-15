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
  onNext,
  inputRef,
}: {
  dimId: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
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
        setTimeout(onNext, 0);
      }}
      onKeyDown={(e) => {
        // Enter bez otevřené nabídky: ponechat napsané a jít dál
        if (e.key === "Enter" && !open) {
          e.preventDefault();
          onChange(query.trim().toUpperCase());
          onNext();
        }
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
  const hasOffset = !dims.offsetType || !!values[dims.offsetType];
  const order = useMemo(() => [...dims.defs.map((d) => `${dims.main}${d.slot}`), ...(hasOffset ? dims.defs.map((d) => `${dims.offset}${d.slot}`) : [])], [dims, hasOffset]);
  // dialog se připojuje při otevření: hodnoty řádku jako výchozí stav
  const [v, setV] = useState<Values>(() => Object.fromEntries(order.map((k) => [k, values[k] ?? ""])));
  const [req, setReq] = useState<Record<number, string>>({});
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // povinnost dimenzí podle účtu, kurzor na první relevantní
  useEffect(() => {
    if (!open) return;
    const init = v;
    const acc = values[dims.account] as string | undefined;
    (acc ? getRecordAction("gl.account", acc) : Promise.resolve(null)).then((r) => {
      const rq: Record<number, string> = {};
      const rec = r && "ok" in r && r.ok ? r.data : null;
      for (const d of dims.defs) rq[d.slot] = String(rec?.[`dim${d.slot}Req`] ?? "optional");
      setReq(rq);
      const first = dims.defs.findIndex((d) => rq[d.slot] === "mandatory" && !init[`${dims.main}${d.slot}`]);
      setTimeout(() => refs.current[first >= 0 ? first : 0]?.focus(), 80);
    });
    // jen při otevření
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k: string, val: string) =>
    setV((cur) => {
      const n = { ...cur, [k]: val };
      // účet → protiúčet: předvyplnit, dokud protiúčet má prázdno nebo stejnou hodnotu jako dřív účet
      if (k.startsWith(dims.main) && hasOffset) {
        const slot = k.slice(dims.main.length);
        const ok = `${dims.offset}${slot}`;
        if (!cur[ok] || cur[ok] === cur[k]) n[ok] = val;
      }
      return n;
    });
  const next = (i: number) => {
    if (i + 1 < order.length) refs.current[i + 1]?.focus();
    else onOk(v);
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onCancel()}>
      <DialogSurface style={{ maxWidth: 720 }}>
        <DialogBody>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogContent>
            <Text className={s.hint} block style={{ marginBottom: 12 }}>
              {labels.hint}
            </Text>
            <div className={s.cols}>
              <Text className={s.head}>{labels.account}</Text>
              <Text className={s.head}>{hasOffset ? labels.offset : ""}</Text>
              {dims.defs.map((d, i) => (
                <div key={d.slot} style={{ display: "contents" }}>
                  <Field label={<span>{d.name}{req[d.slot] === "mandatory" && <span className={s.req}> *</span>}</span>} size="small">
                    <DimLookup dimId={d.id} value={String(v[`${dims.main}${d.slot}`] ?? "")} onChange={(x) => set(`${dims.main}${d.slot}`, x)} onNext={() => next(i)} inputRef={(el) => (refs.current[i] = el)} />
                  </Field>
                  {hasOffset ? (
                    <Field label={d.name} size="small">
                      <DimLookup
                        dimId={d.id}
                        value={String(v[`${dims.offset}${d.slot}`] ?? "")}
                        onChange={(x) => set(`${dims.offset}${d.slot}`, x)}
                        onNext={() => next(dims.defs.length + i)}
                        inputRef={(el) => (refs.current[dims.defs.length + i] = el)}
                      />
                    </Field>
                  ) : (
                    <div />
                  )}
                </div>
              ))}
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={onCancel}>{labels.cancel}</Button>
            <Button appearance="primary" onClick={() => onOk(v)}>
              {labels.ok}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
