/**
 * Logo organizace na účtence ESC/POS (USB i síť): prohlížeč obrázek zmenší, převede na černobílý a pošle
 * jako rastr (GS v 0) vycentrovaný na šířku papíru. Jen v prohlížeči (canvas); nepovede-li se, účtenka je bez loga.
 */

const cache = new Map<string, Promise<Uint8Array | null>>();

/** body tiskové šířky: 80 mm = 576, 58 mm = 384 (203 dpi) */
export const paperDots = (paperWidth: string) => (paperWidth === "58" ? 384 : 576);

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("logo"));
    // obrázek, který se nenačte do 4 s, účtenku nezdrží (vytiskne se bez loga)
    setTimeout(() => reject(new Error("logo timeout")), 4000);
    img.src = src;
  });
}

async function build(logoId: string, dots: number): Promise<Uint8Array | null> {
  const img = await loadImage(`/api/files/${logoId}`);
  const maxW = Math.round(dots * 0.66);
  const scale = Math.min(1, maxW / (img.naturalWidth || maxW), 160 / (img.naturalHeight || 160));
  const w = Math.max(8, Math.round((img.naturalWidth || maxW) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 80) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, w, h);
  c.drawImage(img, 0, 0, w, h);
  const px = c.getImageData(0, 0, w, h).data;
  const pad = Math.max(0, Math.floor((dots - w) / 2));
  const bw = Math.ceil((pad + w) / 8);
  const out = new Uint8Array(8 + bw * h + 1);
  out.set([0x1d, 0x76, 0x30, 0, bw & 0xff, bw >> 8, h & 0xff, h >> 8]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // jas (bílé pozadí pod průhledností) – tmavé body tisknout
      if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 140) {
        const X = pad + x;
        out[8 + y * bw + (X >> 3)] |= 0x80 >> (X & 7);
      }
    }
  out[out.length - 1] = 0x0a;
  return out;
}

/** Rastr loga pro tiskárnu (uložený pro opakovaný tisk), null = bez loga. */
export function logoRaster(logoId: string | null | undefined, paperWidth: string): Promise<Uint8Array | null> {
  if (!logoId || typeof document === "undefined") return Promise.resolve(null);
  const key = `${logoId}:${paperWidth}`;
  if (!cache.has(key)) cache.set(key, build(logoId, paperDots(paperWidth)).catch(() => null));
  return cache.get(key)!;
}

/** logo + účtenka (bez loga jen účtenka) */
export async function withLogo(receipt: Uint8Array, logoId: string | null | undefined, paperWidth: string): Promise<Uint8Array> {
  const logo = await logoRaster(logoId, paperWidth).catch(() => null);
  if (!logo) return receipt;
  const all = new Uint8Array(logo.length + receipt.length);
  all.set(logo);
  all.set(receipt, logo.length);
  return all;
}
