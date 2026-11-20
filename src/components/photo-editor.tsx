"use client";
/**
 * Úprava fotky dokladu v prohlížeči (bez odesílání originálu): čtyři rohy dokladu → oříznutí a narovnání
 * perspektivy (projektivní transformace), otočení po 90°, zlepšení čitelnosti (odstíny šedi + roztažení
 * kontrastu). Výsledek JPEG max. 2000 px — menší soubor a čitelnější pro vytěžení.
 */
import { useEffect, useRef, useState } from "react";
import { Button, makeStyles, Switch, Text, tokens } from "@fluentui/react-components";
import { ArrowRotateClockwise24Regular, Checkmark24Regular, Dismiss24Regular } from "@fluentui/react-icons";

type Pt = { x: number; y: number };
const MAX_SRC = 2400;
const MAX_OUT = 2000;

const useStyles = makeStyles({
  wrap: { position: "relative", width: "100%", touchAction: "none", userSelect: "none", backgroundColor: tokens.colorNeutralBackground3, borderRadius: tokens.borderRadiusMedium, overflow: "hidden" },
  canvas: { display: "block", width: "100%", height: "auto" },
  svg: { position: "absolute", inset: 0, width: "100%", height: "100%" },
  bar: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS, alignItems: "center", marginTop: tokens.spacingVerticalS },
});

/** Čtverec [0,1]² → čtyřúhelník p0 (0,0), p1 (1,0), p2 (1,1), p3 (0,1) (Heckbert). */
function squareToQuad(p: Pt[]) {
  const [a0, a1, a2, a3] = p;
  const dx1 = a1.x - a2.x, dx2 = a3.x - a2.x, dx3 = a0.x - a1.x + a2.x - a3.x;
  const dy1 = a1.y - a2.y, dy2 = a3.y - a2.y, dy3 = a0.y - a1.y + a2.y - a3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = a1.x - a0.x + g * a1.x, b = a3.x - a0.x + h * a3.x, c = a0.x;
  const d = a1.y - a0.y + g * a1.y, e = a3.y - a0.y + h * a3.y, f = a0.y;
  return (u: number, v: number): Pt => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Narovnat čtyřúhelník ze zdroje do obdélníku (bilineární vzorkování). */
function warp(src: HTMLCanvasElement, quad: Pt[]): HTMLCanvasElement {
  let w = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  let h = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  const k = Math.min(1, MAX_OUT / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  const sctx = src.getContext("2d")!;
  const S = sctx.getImageData(0, 0, src.width, src.height);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d")!;
  const O = octx.createImageData(w, h);
  const map = squareToQuad(quad);
  const sw = src.width, sh = src.height, sd = S.data, od = O.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = map((x + 0.5) / w, (y + 0.5) / h);
      const fx = Math.min(Math.max(p.x - 0.5, 0), sw - 1.001), fy = Math.min(Math.max(p.y - 0.5, 0), sh - 1.001);
      const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * tx;
        const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * tx;
        od[o + c] = top + (bot - top) * ty;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(O, 0, 0);
  return out;
}

/** Čitelnost: odstíny šedi a roztažení kontrastu (2. a 98. percentil jasu). */
function enhance(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = l;
    hist[l | 0]++;
  }
  const n = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) if ((acc += hist[i]) > n * 0.02) { lo = i; break; }
  acc = 0;
  for (let i = 255; i >= 0; i--) if ((acc += hist[i]) > n * 0.02) { hi = i; break; }
  // šetrně: tmavé pozadí kolem dokladu nezčerná, slabý kontrast se zesílí nejvýš 3×
  lo = Math.min(lo, 70);
  const span = Math.max(85, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

function rotate90(c: HTMLCanvasElement): HTMLCanvasElement {
  const r = document.createElement("canvas");
  r.width = c.height;
  r.height = c.width;
  const ctx = r.getContext("2d")!;
  ctx.translate(r.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(c, 0, 0);
  return r;
}

const defaultQuad = (w: number, h: number): Pt[] => {
  const m = Math.round(Math.min(w, h) * 0.04);
  return [{ x: m, y: m }, { x: w - m, y: m }, { x: w - m, y: h - m }, { x: m, y: h - m }];
};

export interface PhotoEditorLabels {
  rotate: string;
  enhance: string;
  done: string;
  cancel: string;
  reset: string;
  hint: string;
}

export function PhotoEditor({ file, onDone, onCancel, L }: { file: File; onDone: (f: File) => void; onCancel: () => void; L: PhotoEditorLabels }) {
  const s = useStyles();
  const view = useRef<HTMLCanvasElement>(null);
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [quad, setQuad] = useState<Pt[]>([]);
  const [better, setBetter] = useState(true);
  const [busy, setBusy] = useState(false);
  const drag = useRef<number | null>(null);

  // načíst fotku (zmenšenou) do plátna
  useEffect(() => {
    let alive = true;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const k = Math.min(1, MAX_SRC / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      setSrc(c);
      setQuad(defaultQuad(c.width, c.height));
      URL.revokeObjectURL(url);
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    if (!src || !view.current) return;
    view.current.width = src.width;
    view.current.height = src.height;
    view.current.getContext("2d")!.drawImage(src, 0, 0);
  }, [src]);

  const toImg = (e: React.PointerEvent): Pt => {
    const r = view.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * src!.width, y: ((e.clientY - r.top) / r.height) * src!.height };
  };

  const finish = async () => {
    if (!src) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 20)); // ať se ukáže „zpracovává se“
    const out = warp(src, quad);
    if (better) enhance(out);
    out.toBlob(
      (b) => {
        setBusy(false);
        if (b) onDone(new File([b], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.85,
    );
  };

  if (!src) return <Text>…</Text>;
  const r = Math.max(src.width, src.height) * 0.025;
  return (
    <div>
      <Text size={200} block style={{ marginBottom: 6 }}>
        {L.hint}
      </Text>
      <div className={s.wrap}>
        <canvas ref={view} className={s.canvas} />
        <svg
          className={s.svg}
          viewBox={`0 0 ${src.width} ${src.height}`}
          preserveAspectRatio="none"
          onPointerDown={(e) => {
            const p = toImg(e);
            let best = -1, bd = Infinity;
            quad.forEach((q, i) => {
              const d = dist(p, q);
              if (d < bd) {
                bd = d;
                best = i;
              }
            });
            if (bd < r * 4) {
              drag.current = best;
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }
          }}
          onPointerMove={(e) => {
            if (drag.current === null) return;
            const p = toImg(e);
            const i = drag.current;
            setQuad((q) => q.map((x, j) => (j === i ? { x: Math.max(0, Math.min(src.width, p.x)), y: Math.max(0, Math.min(src.height, p.y)) } : x)));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <polygon points={quad.map((q) => `${q.x},${q.y}`).join(" ")} fill="rgba(31,78,121,0.12)" stroke="#1f78d1" strokeWidth={r * 0.25} />
          {quad.map((q, i) => (
            <circle key={i} cx={q.x} cy={q.y} r={r} fill="rgba(255,255,255,0.85)" stroke="#1f78d1" strokeWidth={r * 0.3} />
          ))}
        </svg>
      </div>
      <div className={s.bar}>
        <Button
          icon={<ArrowRotateClockwise24Regular />}
          onClick={() => {
            const n = rotate90(src);
            setSrc(n);
            setQuad(defaultQuad(n.width, n.height));
          }}
        >
          {L.rotate}
        </Button>
        <Button appearance="subtle" onClick={() => setQuad(defaultQuad(src.width, src.height))}>
          {L.reset}
        </Button>
        <Switch checked={better} onChange={(_, d) => setBetter(d.checked)} label={L.enhance} />
      </div>
      <div className={s.bar}>
        <Button appearance="primary" icon={<Checkmark24Regular />} disabled={busy} onClick={finish}>
          {busy ? "…" : L.done}
        </Button>
        <Button icon={<Dismiss24Regular />} onClick={onCancel}>
          {L.cancel}
        </Button>
      </div>
    </div>
  );
}
