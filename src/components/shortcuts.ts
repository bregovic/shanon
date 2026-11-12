"use client";

/**
 * Klávesové zkratky podle standardu Shanonu:
 *   Shift+N nový · Shift+R obnovit · Shift+D smazat · Shift+S uložit (i Ctrl+S)
 *   Esc zpět / zavřít · Enter otevřít (řeší grid)
 * Zkratky se Shiftem se při psaní do pole ignorují (psalo by se velké písmeno).
 */
import { useEffect, useRef } from "react";

export type ShortcutMap = Partial<Record<"new" | "refresh" | "delete" | "save" | "escape", () => void>>;

const typing = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
};

export function useShortcuts(map: ShortcutMap, enabled = true) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const m = ref.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && m.save) {
        e.preventDefault();
        m.save();
        return;
      }
      if (e.key === "Escape" && m.escape) {
        // otevřený dialog/menu si Esc obslouží sám
        if (document.querySelector("[role=dialog],[role=menu],[role=listbox]")) return;
        m.escape();
        return;
      }
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
      const action = ({ N: m.new, R: m.refresh, D: m.delete, S: m.save } as Record<string, (() => void) | undefined>)[e.key.toUpperCase()];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
