"use client";

/** Pole data se zkratkami jako v AX (d = dnes, d+1, 15, 1511, 15.11.…); ukládá ISO. */
import { useState } from "react";
import { Input, type InputProps } from "@fluentui/react-components";
import { formatDateInput, parseDateInput } from "@/lib/date-input";

export function DateInput({
  value,
  onChange,
  lang = "cs",
  ...rest
}: { value: string | null | undefined; onChange: (iso: string | null) => void; lang?: string } & Omit<InputProps, "value" | "onChange" | "type">) {
  const [text, setText] = useState(formatDateInput(value, lang));
  const [bad, setBad] = useState(false);
  // změna hodnoty zvenku (načtení, předvyplnění) → přepsat text (odvozený stav, bez efektu)
  const [shown, setShown] = useState(`${value ?? ""}|${lang}`);
  if (shown !== `${value ?? ""}|${lang}`) {
    setShown(`${value ?? ""}|${lang}`);
    setText(formatDateInput(value, lang));
    setBad(false);
  }
  const commit = () => {
    const iso = parseDateInput(text);
    if (iso === undefined) return setBad(true);
    setBad(false);
    setText(formatDateInput(iso, lang));
    if ((iso ?? null) !== (value || null)) onChange(iso);
  };
  return (
    <Input
      {...rest}
      value={text}
      placeholder={rest.placeholder ?? (lang === "en" ? "dd/mm/yyyy · d = today" : "d.m.rrrr · d = dnes")}
      aria-invalid={bad || undefined}
      style={{ ...(rest.style ?? {}), ...(bad ? { outline: "2px solid var(--colorPaletteRedBorder2)" } : {}) }}
      onChange={(_, d) => setText(d.value)}
      onBlur={(e) => {
        commit();
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        // Enter: nejdřív převést zkratku, pak teprve obsluha mřížky (uložení řádku)
        if (e.key === "Enter") commit();
        rest.onKeyDown?.(e);
      }}
    />
  );
}
