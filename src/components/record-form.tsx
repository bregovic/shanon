"use client";

/**
 * Formulář záznamu vykreslený z popisu polí (FieldMeta). Řízený stavem —
 * hodnoty se po chybě uložení neztratí.
 */
import { useEffect, useRef, useState } from "react";
import {
  Checkbox,
  Combobox,
  Dropdown,
  Field,
  Input,
  makeStyles,
  Option,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import NextLink from "next/link";
import { searchRefs } from "@/app/actions";
import type { FieldMeta } from "@/lib/meta";

export type Values = Record<string, unknown>;

export interface FormGroup {
  label: string;
  fields: FieldMeta[];
}

const useStyles = makeStyles({
  group: { display: "flex", flexDirection: "column", gap: "12px" },
  groupTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    paddingBottom: "6px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: "12px 24px",
  },
  wide: { gridColumn: "1 / -1" },
});

export function RecordForm({
  groups,
  values,
  titles,
  errors,
  readOnly,
  onChange,
  columns = 2,
}: {
  groups: FormGroup[];
  values: Values;
  titles: Record<string, string>;
  errors: Record<string, string>;
  readOnly: boolean;
  onChange: (name: string, value: unknown, title?: string) => void;
  /** 1 = šuplík (jeden sloupec), 2 = celá stránka */
  columns?: 1 | 2;
}) {
  const s = useStyles();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {groups.map((g) => (
        <section key={g.label} className={s.group}>
          <div className={s.groupTitle}>{g.label}</div>
          <div className={s.grid} style={columns === 1 ? { gridTemplateColumns: "1fr" } : undefined}>
            {g.fields.map((f) => (
              <div key={f.name} className={f.kind === "text" ? s.wide : undefined}>
                <FieldInput
                  f={f}
                  value={values[f.name]}
                  title={titles[f.name]}
                  error={errors[f.name]}
                  disabled={readOnly || f.readOnly}
                  onChange={onChange}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FieldInput({
  f,
  value,
  title,
  error,
  disabled,
  onChange,
}: {
  f: FieldMeta;
  value: unknown;
  title?: string;
  error?: string;
  disabled: boolean;
  onChange: (name: string, value: unknown, title?: string) => void;
}) {
  const v = value === null || value === undefined ? "" : String(value);
  let control: React.ReactElement;
  switch (f.kind) {
    case "bool":
      return (
        <Field validationMessage={error} style={{ paddingTop: 22 }}>
          <Checkbox label={f.label} checked={value === true} disabled={disabled} onChange={(_, d) => onChange(f.name, d.checked === true)} />
        </Field>
      );
    case "enum": {
      const opt = f.options!.find((o) => o.value === v);
      control = (
        <Dropdown
          value={opt?.label ?? ""}
          selectedOptions={v ? [v] : []}
          disabled={disabled}
          onOptionSelect={(_, d) => onChange(f.name, d.optionValue ?? "")}
        >
          {!f.mandatory && <Option value="">—</Option>}
          {f.options!.map((o) => (
            <Option key={o.value} value={o.value}>
              {o.label}
            </Option>
          ))}
        </Dropdown>
      );
      break;
    }
    case "text":
      control = <Textarea value={v} disabled={disabled} resize="vertical" rows={3} onChange={(_, d) => onChange(f.name, d.value)} />;
      break;
    case "date":
      control = <Input type="date" value={v} disabled={disabled} onChange={(_, d) => onChange(f.name, d.value)} />;
      break;
    case "ref":
      if (disabled) {
        // zamčený odkaz = odkaz na záznam, ne rozbalovací pole
        control = (
          <div style={{ minHeight: 32, display: "flex", alignItems: "center" }}>
            {v ? (
              <NextLink href={`${f.refHref}/${v}`} style={{ color: tokens.colorBrandForegroundLink, textDecoration: "none", fontWeight: 600 }}>
                {title || "—"}
              </NextLink>
            ) : (
              "—"
            )}
          </div>
        );
        break;
      }
      control = <RefCombobox f={f} value={v} title={title ?? ""} disabled={disabled} onChange={onChange} />;
      break;
    default:
      control = (
        <Input
          value={v}
          disabled={disabled}
          maxLength={f.maxLength}
          inputMode={f.kind === "decimal" || f.kind === "int" ? "decimal" : undefined}
          input={{ style: { textAlign: f.align } }}
          onChange={(_, d) => onChange(f.name, d.value)}
        />
      );
  }
  return (
    <Field label={f.label} required={f.mandatory && !disabled} validationMessage={error}>
      {control}
    </Field>
  );
}

/** Výběr odkazovaného záznamu s hledáním na serveru. */
function RefCombobox({
  f,
  value,
  title,
  disabled,
  onChange,
}: {
  f: FieldMeta;
  value: string;
  title: string;
  disabled: boolean;
  onChange: (name: string, value: unknown, title?: string) => void;
}) {
  const [query, setQuery] = useState(title);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ id: string; title: string; subtitle: string }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // nový titulek zvenčí (výběr, načtení záznamu) přepíše text v poli
  const [prevTitle, setPrevTitle] = useState(title);
  if (title !== prevTitle) {
    setPrevTitle(title);
    setQuery(title);
  }

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      searchRefs(f.refObject!, query === title ? "" : query).then(setOptions);
    }, 150);
    return () => clearTimeout(timer.current);
  }, [query, open, f.refObject, title]);

  return (
    <Combobox
      value={query}
      selectedOptions={value ? [value] : []}
      disabled={disabled}
      freeform
      open={open}
      onOpenChange={(_, d) => {
        setOpen(d.open);
        if (!d.open) setQuery(title);
      }}
      onChange={(e) => {
        setQuery(e.target.value);
        setOpen(true);
        if (!e.target.value) onChange(f.name, null, "");
      }}
      onOptionSelect={(_, d) => {
        if (!d.optionValue) return;
        const o = options.find((x) => x.id === d.optionValue);
        onChange(f.name, d.optionValue, o?.title ?? "");
        setQuery(o?.title ?? "");
      }}
    >
      {options.map((o) => (
        <Option key={o.id} value={o.id} text={o.title}>
          <span style={{ fontWeight: 600 }}>{o.title}</span>
          {o.subtitle && <span style={{ marginLeft: 8, color: tokens.colorNeutralForeground3 }}>{o.subtitle}</span>}
        </Option>
      ))}
    </Combobox>
  );
}
