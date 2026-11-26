"use client";

/**
 * Výběr textu tažením v rozbalovacím okénku (filtr sloupce, nabídka s polem): stisk uvnitř a puštění
 * myši mimo okénko vyhodnotí prohlížeč jako klik mimo a Fluent okénko zavře. Hook pozná tažení, které
 * začalo uvnitř a skončilo venku, a takové zavření ignoruje (klik na položku nabídky zavírá dál).
 *
 *   const guard = useDragGuard();
 *   <Menu onOpenChange={(e, d) => guard.allow(d) && setOpen(d.open)}> … <MenuPopover {...guard.surface}>
 */
import { useEffect, useMemo, useRef } from "react";

export function useDragGuard() {
  const surfaceEl = useRef<HTMLElement | null>(null);
  const pressed = useRef(false);
  const dragOut = useRef(false);
  useEffect(() => {
    const up = (e: PointerEvent) => {
      dragOut.current = pressed.current && !!surfaceEl.current && !surfaceEl.current.contains(e.target as Node);
      pressed.current = false;
      // klik, který prohlížeč pošle po puštění, ještě uvidí příznak; pak se smaže
      setTimeout(() => (dragOut.current = false), 0);
    };
    document.addEventListener("pointerup", up, true);
    return () => document.removeEventListener("pointerup", up, true);
  }, []);
  return useMemo(
    () => ({
      surface: {
        onPointerDownCapture: (e: React.PointerEvent<HTMLElement>) => {
          surfaceEl.current = e.currentTarget;
          pressed.current = true;
        },
      },
      /** false = zavření ignorovat (tažení začalo v okénku a skončilo venku) */
      allow: (d: { open: boolean }) => d.open || !dragOut.current,
    }),
    [],
  );
}
