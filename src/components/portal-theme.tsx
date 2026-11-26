"use client";

/**
 * Vzhled veřejné stránky portálu (doklady dodavatelů, smlouvy): barvy z nastavení portálu jako motiv Fluentu
 * (tlačítka, výběr, rámečky), pozadí stránky, logo, patička. Bez nastavení = barvy Shanonu.
 */
import { createLightTheme, FluentProvider, tokens, type BrandVariants } from "@fluentui/react-components";
import { shanonTheme } from "@/components/providers";
import type { PortalDesign } from "@/server/supplier-portal";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** 16 odstínů značky z jedné barvy: 80 = zadaná barva, níž tmavší, výš světlejší (jako u motivu Shanonu). */
export function brandFromHex(hex: string): BrandVariants {
  const c = rgb(hex);
  const out: Record<number, string> = {};
  for (let k = 1; k <= 16; k++) {
    const step = k * 10;
    out[step] = step <= 80 ? toHex(mix([0, 0, 0], c, 0.12 + (0.88 * (step - 10)) / 70)) : toHex(mix(c, [255, 255, 255], (step - 80) / 90));
  }
  return out as unknown as BrandVariants;
}

/** Světlá barva → tmavý text nahoře (žlutá, světle modrá…). */
export function isLight(hex: string): boolean {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

/** Pozadí stránky podle nastavení; `heroColor` = barva textu v horním pruhu. */
export function portalBackground(d: PortalDesign): { background: string; heroColor: string } {
  const a = d.accent;
  const top = a ?? tokens.colorBrandBackground;
  const top2 = d.accent2 ?? (a ? toHex(mix(rgb(a), [0, 0, 0], 0.35)) : tokens.colorBrandBackgroundPressed);
  const lightTop = !!a && isLight(a) && d.background !== "photo";
  const hero = lightTop ? "#1b1b1b" : "#ffffff";
  switch (d.background) {
    case "light":
      return { background: tokens.colorNeutralBackground2, heroColor: tokens.colorNeutralForeground1 };
    case "solid":
      return { background: `linear-gradient(180deg, ${top} 0%, ${top} 38%, ${tokens.colorNeutralBackground2} 38.1%)`, heroColor: hero };
    case "photo":
      return d.backgroundImage
        ? { background: `linear-gradient(rgba(10, 14, 24, 0.55), rgba(10, 14, 24, 0.55)), url("${d.backgroundImage}") center / cover fixed`, heroColor: "#ffffff" }
        : { background: tokens.colorNeutralBackground2, heroColor: tokens.colorNeutralForeground1 };
    default:
      return { background: `linear-gradient(160deg, ${top} 0%, ${top2} 38%, ${tokens.colorNeutralBackground2} 38.1%)`, heroColor: hero };
  }
}

export function PortalTheme({ design, children }: { design: PortalDesign; children: React.ReactNode }) {
  const theme = design.accent ? { ...createLightTheme(brandFromHex(design.accent)), fontFamilyBase: shanonTheme.fontFamilyBase } : shanonTheme;
  return (
    <FluentProvider theme={theme} style={{ minHeight: "100vh", background: "transparent" }}>
      {children}
    </FluentProvider>
  );
}

/** Logo nad nadpisem (nenačte-li se, zmizí). */
export function PortalLogo({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- obrázek z portálu (veřejná adresa s klíčem portálu)
    <img src={src} alt="" style={{ maxHeight: 56, maxWidth: 220, objectFit: "contain", alignSelf: "flex-start", marginBottom: 6 }} onError={(e) => e.currentTarget.remove()} />
  );
}
