"use client";

/**
 * Neuložené změny ve formuláři: odchod (odkaz v aplikaci, Esc, zavření šuplíku) se zeptá
 * Uložit / Neukládat / Zpět; zavření nebo obnovení okna prohlížeče ukáže upozornění prohlížeče.
 * Formulář hlásí změny přes `isDirty()` (změna pole uživatelem, po uložení zase čisto).
 */
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type UnsavedLabels = { title: string; text: string; save: string; discard: string; back: string };

export function useUnsavedGuard(isDirty: () => boolean, save: () => Promise<boolean>, opts: { links?: boolean } = {}) {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dirtyFn = useRef(isDirty);
  useEffect(() => {
    dirtyFn.current = isDirty;
  });
  const links = opts.links !== false;

  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (!dirtyFn.current()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // odkazy v aplikaci (menu, drobečky, proklik na záznam) — dřív než je zpracuje router
    const click = (e: MouseEvent) => {
      if (!links || !dirtyFn.current() || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || (/^https?:/i.test(href) && !href.startsWith(location.origin))) return;
      if (a.closest(".fui-DialogSurface")) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(() => () => router.push(href));
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [links, router]);

  /** provést odchod; s neuloženými změnami nejdřív dotaz */
  const guard = (go: () => void) => (dirtyFn.current() ? setPending(() => go) : go());

  const dialog = (l: UnsavedLabels): ReactNode => (
    <Dialog open={!!pending} onOpenChange={(_, d) => !d.open && setPending(null)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{l.title}</DialogTitle>
          <DialogContent>{l.text}</DialogContent>
          <DialogActions>
            <Button onClick={() => setPending(null)}>{l.back}</Button>
            <Button
              onClick={() => {
                const go = pending;
                setPending(null);
                dirtyFn.current = () => false;
                go?.();
              }}
            >
              {l.discard}
            </Button>
            <Button
              appearance="primary"
              onClick={async () => {
                const go = pending;
                setPending(null);
                if (await save()) go?.();
              }}
            >
              {l.save}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );

  return { guard, dialog };
}
