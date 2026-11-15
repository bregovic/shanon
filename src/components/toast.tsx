"use client";

/**
 * Nenápadné potvrzení (Uloženo): malá bublina vpravo nahoře, obsah neposouvá,
 * plynule se objeví a po chvíli zmizí. Hostitel je v AppShell, takže přežije
 * přechod na jinou stránku (nový záznam → jeho stránka po uložení).
 */
import { makeStyles, tokens } from "@fluentui/react-components";
import { Checkmark16Filled } from "@fluentui/react-icons";
import { useEffect, useState } from "react";

const EVENT = "shanon:toast";

/** Ukázat potvrzení (jen úspěch — chyby zůstávají u formuláře). */
export function toast(text: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: text }));
}

const useStyles = makeStyles({
  box: {
    position: "fixed",
    top: "64px",
    right: "24px",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    boxShadow: tokens.shadow8,
    fontSize: tokens.fontSizeBase200,
    pointerEvents: "none",
    transitionProperty: "opacity, transform",
    transitionTimingFunction: "ease",
  },
  icon: { color: tokens.colorPaletteGreenForeground1 },
});

export function ToastHost() {
  const s = useStyles();
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setMsg((m) => ({ text: String((e as CustomEvent).detail), n: (m?.n ?? 0) + 1 }));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  // objevit (200 ms), držet 2,5 s, pomalu zmizet (600 ms)
  useEffect(() => {
    if (!msg) return;
    const a = setTimeout(() => setShown(true), 20);
    const b = setTimeout(() => setShown(false), 2500);
    const c = setTimeout(() => setMsg(null), 3200);
    return () => [a, b, c].forEach(clearTimeout);
  }, [msg]);

  if (!msg) return null;
  return (
    <div className={s.box} role="status" aria-live="polite" style={{ opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(-4px)", transitionDuration: shown ? "200ms" : "600ms" }}>
      <Checkmark16Filled className={s.icon} />
      {msg.text}
    </div>
  );
}
