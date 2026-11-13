"use client";

/**
 * Návrhář tiskových sestav: plátno v milimetrech, prvky se přetahují myší
 * (posun, změna velikosti v pravém dolním rohu), vlastnosti vpravo, náhled
 * s daty skutečného dokladu. Ukládá rozvržení šablony (JSON).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Checkbox,
  Divider,
  Field,
  Input,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  Textarea,
  ToggleButton,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  Delete20Regular,
  Eye20Regular,
  Image20Regular,
  LineHorizontal120Regular,
  Print20Regular,
  QrCode20Regular,
  RectangleLandscape20Regular,
  Save20Regular,
  Table20Regular,
  TextT20Regular,
} from "@fluentui/react-icons";
import { printPreviewAction, printRecentAction, printSaveLayoutAction } from "@/app/actions";
import { PAPERS, type PaperKind, type PrintColumn, type PrintData, type PrintElement, type PrintLayout, type ValueFormat } from "@/core/print";
import { ElementView, PrintDocument } from "@/lib/print-render";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";

const MM = 3.7795; // px na mm při 100 %

export interface DesignerTemplate {
  id: string;
  name: string;
  docType: string;
  layout: PrintLayout;
}

export interface DesignerCatalog {
  docType: string;
  fields: { path: string; label: string; format?: ValueFormat }[];
  lineFields: { path: string; label: string; format?: ValueFormat }[];
}

const useStyles = makeStyles({
  wrap: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "16px", alignItems: "start", "@media (max-width: 900px)": { gridTemplateColumns: "1fr" } },
  stage: { overflow: "auto", backgroundColor: tokens.colorNeutralBackground3, padding: "16px", borderRadius: tokens.borderRadiusMedium, maxHeight: "calc(100vh - 180px)" },
  page: { position: "relative", backgroundColor: "#fff", boxShadow: tokens.shadow8, margin: "0 auto" },
  sel: { position: "absolute", outline: `2px solid ${tokens.colorBrandStroke1}`, cursor: "move" },
  hover: { position: "absolute", outline: `1px dashed ${tokens.colorNeutralStroke1}`, cursor: "move" },
  handle: { position: "absolute", right: "-5px", bottom: "-5px", width: "10px", height: "10px", backgroundColor: tokens.colorBrandBackground, cursor: "nwse-resize", borderRadius: "2px" },
  panel: { backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px", maxHeight: "calc(100vh - 180px)", overflowY: "auto" },
  row: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
  num: { width: "64px" },
  tools: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px", alignItems: "center" },
  col: { display: "grid", gridTemplateColumns: "1fr 54px 28px", gap: "4px", alignItems: "center" },
  muted: { color: tokens.colorNeutralForeground3 },
});

let seq = 0;
const newId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;
const round = (n: number) => Math.round(n * 2) / 2;

/** Vzorová data z katalogu polí (bez vybraného dokladu). */
function sampleData(cat: DesignerCatalog | undefined): PrintData {
  const out: Record<string, unknown> = {};
  for (const f of cat?.fields ?? []) {
    const [a, b] = f.path.split(".");
    out[a] = { ...(out[a] as object), [b]: `[${f.label}]` };
  }
  out.lines = [1, 2, 3].map((i) => Object.fromEntries((cat?.lineFields ?? []).map((f) => [f.path, f.format === "money" || f.format === "qty" ? i * 10 : `[${f.label}]`])));
  out.vat = [{ rate: "21", base: "100", tax: "21", gross: "121" }];
  out.qr = "SPD*1.0*ACC:CZ0000000000000000000000*AM:0.00*CC:CZK";
  return out;
}

export function PrintDesigner({
  crumbs,
  templates,
  catalogs,
  initialId,
  labels: L,
}: {
  crumbs: { label: string; href?: string }[];
  templates: DesignerTemplate[];
  catalogs: DesignerCatalog[];
  initialId: string | null;
  labels: Record<string, string>;
}) {
  const s = useStyles();
  const router = useRouter();
  const [tplId, setTplId] = useState(initialId ?? templates[0]?.id ?? "");
  const tpl = templates.find((t) => t.id === tplId);
  const [layout, setLayout] = useState<PrintLayout | null>(tpl?.layout ?? null);
  const [selId, setSelId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [zoom, setZoom] = useState(1.3);
  const [docs, setDocs] = useState<{ id: string; number: string }[]>([]);
  const [docId, setDocId] = useState("");
  const [data, setData] = useState<PrintData | null>(null);
  const [msg, setMsg] = useState<{ intent: "success" | "error"; text: string }>();
  const [dirty, setDirty] = useState(false);
  const cat = catalogs.find((c) => c.docType === tpl?.docType);
  const shown = data ?? sampleData(cat);
  const drag = useRef<{ id: string; mode: "move" | "size"; x0: number; y0: number; el: PrintElement } | null>(null);

  // jiná šablona → její rozvržení a doklady pro náhled
  useEffect(() => {
    const t = templates.find((x) => x.id === tplId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(t?.layout ?? null);
    setSelId(null);
    setData(null);
    setDocId("");
    setDirty(false);
    if (t) void printRecentAction(t.docType, "").then((r) => r.ok && setDocs(r.data));
  }, [tplId, templates]);

  const update = useCallback((fn: (l: PrintLayout) => PrintLayout) => {
    setLayout((l) => (l ? fn(l) : l));
    setDirty(true);
  }, []);
  const setEl = (id: string, patch: Partial<PrintElement>) => update((l) => ({ ...l, elements: l.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const sel = layout?.elements.find((e) => e.id === selId) ?? null;

  const paper = PAPERS[layout?.paper ?? "a4"] ?? PAPERS.a4;
  const pageH = paper.h || Math.max(120, ...(layout?.elements ?? []).map((e) => e.y + e.h)) + 20;
  const k = MM * zoom;

  // tažení myší: posun / změna velikosti (mm, krok 0,5)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.x0) / k;
      const dy = (e.clientY - d.y0) / k;
      if (d.mode === "move") setEl(d.id, { x: Math.max(0, round(d.el.x + dx)), y: Math.max(0, round(d.el.y + dy)) });
      else setEl(d.id, { w: Math.max(2, round(d.el.w + dx)), h: Math.max(1, round(d.el.h + dy)) });
    };
    const onUp = () => (drag.current = null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // setEl je stabilní přes update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);

  // klávesnice: Delete smaže, šipky posunou (Shift = 5 mm)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!sel || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const step = e.shiftKey ? 5 : 0.5;
      if (e.key === "Delete") update((l) => ({ ...l, elements: l.elements.filter((x) => x.id !== sel.id) }));
      else if (e.key === "ArrowLeft") setEl(sel.id, { x: Math.max(0, sel.x - step) });
      else if (e.key === "ArrowRight") setEl(sel.id, { x: sel.x + step });
      else if (e.key === "ArrowUp") setEl(sel.id, { y: Math.max(0, sel.y - step) });
      else if (e.key === "ArrowDown") setEl(sel.id, { y: sel.y + step });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const add = (type: PrintElement["type"]) => {
    const w = Math.min(60, paper.w - 10);
    const base: PrintElement = { id: newId(), type, x: 5, y: 5, w, h: type === "line" ? 1 : type === "qr" ? 30 : type === "table" || type === "vat" ? 30 : 10 };
    if (type === "text") base.text = L.Text;
    if (type === "qr") Object.assign(base, { w: 30, field: "qr" });
    if (type === "table") base.columns = (cat?.lineFields ?? []).slice(0, 3).map((f) => ({ field: f.path, label: f.label, width: Math.round(w / 3), format: f.format }));
    if (type === "vat")
      base.columns = [
        { field: "rate", label: "%", width: 15, align: "right" },
        { field: "base", label: L.Net ?? "Základ", width: 22, align: "right", format: "money" },
        { field: "tax", label: L.Tax ?? "DPH", width: 22, align: "right", format: "money" },
      ];
    update((l) => ({ ...l, elements: [...l.elements, base] }));
    setSelId(base.id);
    setPreview(false);
  };

  const save = async () => {
    if (!layout || !tpl) return;
    const r = await printSaveLayoutAction(tpl.id, JSON.stringify(layout));
    setMsg(r.ok ? { intent: "success", text: L.Saved } : { intent: "error", text: r.message });
    if (r.ok) {
      setDirty(false);
      router.refresh();
    }
  };

  const loadDoc = async (id: string) => {
    setDocId(id);
    if (!id || !tpl) return setData(null);
    const r = await printPreviewAction(tpl.docType, id);
    if (r.ok) setData(r.data);
    else setMsg({ intent: "error", text: r.message });
  };

  const fieldOptions = useMemo(() => cat?.fields ?? [], [cat]);
  const colFields = sel?.type === "vat" ? [
    { path: "rate", label: "%" },
    { path: "base", label: L.Net },
    { path: "tax", label: L.Tax },
    { path: "gross", label: L.Gross },
  ] : (cat?.lineFields ?? []);

  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
        <Select value={tplId} onChange={(_, d) => setTplId(d.value)} aria-label={L.Template1}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Spacer />
        <Button appearance="primary" icon={<Save20Regular />} disabled={!dirty} onClick={save}>
          {L.Save}
        </Button>
        {docId && tpl && (
          <Button icon={<Print20Regular />} onClick={() => window.open(`/print/${tpl.docType}/${docId}?template=${tpl.id}`, "_blank")}>
            {L.Print}
          </Button>
        )}
      </ActionBar>
      <PageContent>
        {msg && (
          <MessageBar intent={msg.intent}>
            <MessageBarBody>{msg.text}</MessageBarBody>
          </MessageBar>
        )}
        {!layout ? (
          <Text>{L.DefaultTemplateMissing}</Text>
        ) : (
          <div className={s.wrap}>
            <div>
              <div className={s.tools}>
                <Button size="small" icon={<TextT20Regular />} onClick={() => add("text")}>{L.AddText}</Button>
                <Button size="small" icon={<Table20Regular />} disabled={layout.elements.some((e) => e.type === "table")} onClick={() => add("table")}>{L.AddTable}</Button>
                <Button size="small" icon={<Table20Regular />} onClick={() => add("vat")}>{L.AddVat}</Button>
                <Button size="small" icon={<QrCode20Regular />} onClick={() => add("qr")}>{L.AddQr}</Button>
                <Button size="small" icon={<Image20Regular />} onClick={() => add("image")}>{L.AddImage}</Button>
                <Button size="small" icon={<LineHorizontal120Regular />} onClick={() => add("line")}>{L.AddLine}</Button>
                <Button size="small" icon={<RectangleLandscape20Regular />} onClick={() => add("rect")}>{L.AddRect}</Button>
                <Divider vertical style={{ height: 24 }} />
                <ToggleButton size="small" icon={<Eye20Regular />} checked={preview} onClick={() => setPreview((v) => !v)}>{L.Preview}</ToggleButton>
                <Select size="small" value={String(zoom)} onChange={(_, d) => setZoom(Number(d.value))} aria-label="Zoom">
                  {[0.8, 1, 1.3, 1.6, 2].map((z) => (
                    <option key={z} value={z}>{Math.round(z * 100)} %</option>
                  ))}
                </Select>
                <Select size="small" value={docId} onChange={(_, d) => void loadDoc(d.value)} aria-label={L.Record}>
                  <option value="">{L.NoRecord}</option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>{d.number}</option>
                  ))}
                </Select>
              </div>
              <div className={s.stage} onPointerDown={(e) => e.target === e.currentTarget && setSelId(null)}>
                {preview ? (
                  <div style={{ width: "fit-content", margin: "0 auto", zoom }}>
                    <div style={{ background: "#fff", boxShadow: tokens.shadow8 }}>
                      <PrintDocument layout={layout} data={shown} />
                    </div>
                  </div>
                ) : (
                  <div className={s.page} style={{ width: paper.w * k, height: pageH * k }} onPointerDown={(e) => e.target === e.currentTarget && setSelId(null)}>
                    <div style={{ position: "absolute", left: 0, top: 0, width: `${paper.w}mm`, height: `${pageH}mm`, transform: `scale(${zoom})`, transformOrigin: "0 0", pointerEvents: "none", fontFamily: "Arial, Helvetica, sans-serif" }}>
                      {layout.elements.map((el) => (
                        <ElementView key={el.id} el={el} data={shown} locale="cs-CZ" fontSize={layout.fontSize || 9} designMode />
                      ))}
                    </div>
                    {layout.elements.map((el) => (
                      <div
                        key={el.id}
                        className={el.id === selId ? s.sel : s.hover}
                        style={{ left: el.x * k, top: el.y * k, width: el.w * k, height: Math.max(el.h * k, 6) }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelId(el.id);
                          drag.current = { id: el.id, mode: "move", x0: e.clientX, y0: e.clientY, el };
                        }}
                      >
                        {el.id === selId && (
                          <div
                            className={s.handle}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              drag.current = { id: el.id, mode: "size", x0: e.clientX, y0: e.clientY, el };
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={s.panel}>
              {!sel ? (
                <>
                  <Text weight="semibold">{tpl?.name}</Text>
                  <Field label={L.Paper}>
                    <Select value={layout.paper} onChange={(_, d) => update((l) => ({ ...l, paper: d.value as PaperKind }))}>
                      {(["a4", "a5", "receipt80", "receipt58", "label"] as PaperKind[]).map((p) => (
                        <option key={p} value={p}>{L[`Paper${p === "a4" ? "A4" : p === "a5" ? "A5" : p === "receipt80" ? "Receipt80" : p === "receipt58" ? "Receipt58" : "Label"}`]}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={L.FontSize}>
                    <Input type="number" value={String(layout.fontSize)} onChange={(_, d) => update((l) => ({ ...l, fontSize: Number(d.value) || 9 }))} />
                  </Field>
                  <Text className={s.muted}>{L.SelectElement}</Text>
                </>
              ) : (
                <>
                  <div className={s.row}>
                    {(["x", "y", "w", "h"] as const).map((k2) => (
                      <Field key={k2} label={k2.toUpperCase()}>
                        <Input className={s.num} type="number" value={String(sel[k2])} onChange={(_, d) => setEl(sel.id, { [k2]: Number(d.value) || 0 })} />
                      </Field>
                    ))}
                  </div>
                  {sel.type === "text" && (
                    <>
                      <Field label={L.Text}>
                        <Textarea rows={4} value={sel.text ?? ""} onChange={(_, d) => setEl(sel.id, { text: d.value })} />
                      </Field>
                      <Field label={L.InsertField}>
                        <Select
                          value=""
                          onChange={(_, d) => {
                            if (!d.value) return;
                            const f = fieldOptions.find((x) => x.path === d.value);
                            setEl(sel.id, { text: `${sel.text ?? ""}{${d.value}${f?.format && f.format !== "text" ? `:${f.format}` : ""}}` });
                          }}
                        >
                          <option value="">—</option>
                          {fieldOptions.map((f) => (
                            <option key={f.path} value={f.path}>{f.label}</option>
                          ))}
                        </Select>
                      </Field>
                    </>
                  )}
                  {(sel.type === "text" || sel.type === "table" || sel.type === "vat") && (
                    <div className={s.row}>
                      <Field label={L.FontSize}>
                        <Input className={s.num} type="number" value={String(sel.style?.size ?? "")} onChange={(_, d) => setEl(sel.id, { style: { ...sel.style, size: Number(d.value) || undefined } })} />
                      </Field>
                      <Field label={L.Align}>
                        <Select value={sel.style?.align ?? "left"} onChange={(_, d) => setEl(sel.id, { style: { ...sel.style, align: d.value as "left" } })}>
                          <option value="left">{L.Left}</option>
                          <option value="center">{L.Center}</option>
                          <option value="right">{L.Right}</option>
                        </Select>
                      </Field>
                      <Checkbox label={L.Bold} checked={!!sel.style?.bold} onChange={(_, d) => setEl(sel.id, { style: { ...sel.style, bold: !!d.checked } })} />
                      <Checkbox label={L.Border} checked={!!sel.style?.border} onChange={(_, d) => setEl(sel.id, { style: { ...sel.style, border: !!d.checked } })} />
                    </div>
                  )}
                  {(sel.type === "table" || sel.type === "vat") && (
                    <>
                      <Text weight="semibold">{L.Columns}</Text>
                      {(sel.columns ?? []).map((c, i) => {
                        const setCol = (patch: Partial<PrintColumn>) => setEl(sel.id, { columns: (sel.columns ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                        return (
                          <div key={i} className={s.col}>
                            <Select
                              size="small"
                              value={c.field}
                              onChange={(_, d) => {
                                const f = colFields.find((x) => x.path === d.value);
                                setCol({ field: d.value, label: f?.label ?? d.value, format: (f as { format?: ValueFormat })?.format, align: (f as { format?: ValueFormat })?.format === "money" || (f as { format?: ValueFormat })?.format === "qty" ? "right" : c.align });
                              }}
                            >
                              {colFields.map((f) => (
                                <option key={f.path} value={f.path}>{f.label}</option>
                              ))}
                            </Select>
                            <Input size="small" type="number" value={String(c.width)} onChange={(_, d) => setCol({ width: Number(d.value) || 10 })} aria-label={L.Width} />
                            <Button size="small" appearance="subtle" icon={<Delete20Regular />} aria-label={L.Remove} onClick={() => setEl(sel.id, { columns: (sel.columns ?? []).filter((_, j) => j !== i) })} />
                            <Input size="small" value={c.label} onChange={(_, d) => setCol({ label: d.value })} aria-label={L.Header} style={{ gridColumn: "1 / 4" }} />
                          </div>
                        );
                      })}
                      <Button size="small" icon={<Add20Regular />} onClick={() => setEl(sel.id, { columns: [...(sel.columns ?? []), { field: colFields[0]?.path ?? "", label: colFields[0]?.label ?? "", width: 20 }] })}>
                        {L.AddColumn}
                      </Button>
                    </>
                  )}
                  {sel.type === "image" && (
                    <Field label={L.UploadImage}>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          if (f.size > 300_000) return setMsg({ intent: "error", text: L.ImageTooBig });
                          const r = new FileReader();
                          r.onload = () => setEl(sel.id, { src: String(r.result) });
                          r.readAsDataURL(f);
                        }}
                      />
                    </Field>
                  )}
                  <Button icon={<Delete20Regular />} onClick={() => (update((l) => ({ ...l, elements: l.elements.filter((x) => x.id !== sel.id) })), setSelId(null))}>
                    {L.Remove}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </PageContent>
    </>
  );
}
