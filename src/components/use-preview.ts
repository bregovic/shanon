"use client";

/**
 * Náhled hodnot před uložením: po výběru v odkazu / výčtu se formulář zeptá serveru,
 * co by uložení doplnilo (cena a DPH z položky, číslo deníku, číslo dokladu…), a ukáže
 * to hned. Doplněné hodnoty si pamatuje — změní-li uživatel třeba položku, přepočítají
 * se znovu; co uživatel přepíše sám, zůstane. Předběžná čísla z řady se při uložení
 * neposílají (číslo přidělí až uložení, jinak by se řada neposunula).
 */
import { useCallback, useRef } from "react";
import { previewRecordAction } from "@/app/actions";

type Values = Record<string, unknown>;

export function usePreview(objectId: string, id: string | null, opts: { fields: string[]; fixed?: Values; disabled?: boolean }) {
  const auto = useRef(new Set<string>());
  const provisional = useRef(new Set<string>());
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { fields, fixed, disabled } = opts;

  /** uživatel pole změnil sám — už ho nepřepisovat */
  const touch = useCallback((name: string) => {
    auto.current.delete(name);
    provisional.current.delete(name);
  }, []);

  /** zeptat se serveru (s krátkým zpožděním, poslední dotaz vyhrává) */
  const run = useCallback(
    (values: Values, apply: (vals: Values, titles: Record<string, string>) => void, delay = 200) => {
      if (disabled) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const my = ++seq.current;
        // doplněné hodnoty neposílat — ať se po změně (jiná položka) spočítají znovu
        const input: Values = {};
        for (const [k, v] of Object.entries(values)) if (!auto.current.has(k)) input[k] = v;
        Object.assign(input, fixed ?? {});
        const r = await previewRecordAction(objectId, id, input);
        if (!r.ok || my !== seq.current) return;
        const vals: Values = {};
        const titles: Record<string, string> = {};
        for (const k of fields) {
          const v = r.data.values[k];
          const cur = values[k];
          const empty = cur === null || cur === undefined || cur === "";
          if (!empty && !auto.current.has(k)) continue;
          if (v === null || v === undefined || v === "") {
            // dřív doplněné, teď už ne (jiná položka bez ceny) — vyčistit
            if (auto.current.has(k)) vals[k] = null;
            continue;
          }
          if (String(cur ?? "") !== String(v)) vals[k] = v;
          auto.current.add(k);
          if (r.data.titles[k]) titles[k] = r.data.titles[k];
        }
        provisional.current = new Set(r.data.provisional.filter((k) => auto.current.has(k)));
        if (Object.keys(vals).length || Object.keys(titles).length) apply(vals, titles);
      }, delay);
    },
    [objectId, id, fields, fixed, disabled],
  );

  /** hodnoty k uložení bez předběžných čísel */
  const strip = useCallback((v: Values) => {
    const out: Values = {};
    for (const [k, x] of Object.entries(v)) if (!provisional.current.has(k)) out[k] = x;
    return out;
  }, []);

  const isProvisional = useCallback((name: string) => provisional.current.has(name), []);

  return { run, touch, strip, isProvisional };
}

/** Změna, po které má smysl náhled (výběr, ne každé písmeno). */
export const triggersPreview = (kind: string | undefined) => kind === "ref" || kind === "enum" || kind === "bool" || kind === "date" || kind === "decimal" || kind === "int";
