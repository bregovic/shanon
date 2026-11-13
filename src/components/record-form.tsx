"use client";

/**
 * Formulář záznamu vykreslený z popisu polí (FieldMeta). Řízený stavem —
 * hodnoty se po chybě uložení neztratí.
 */
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Combobox,
  Dropdown,
  Field,
  Input,
  makeStyles,
  Option,
  Textarea,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Open24Regular } from "@fluentui/react-icons";
import { searchRefs, uploadImageAction } from "@/app/actions";
import { displayValue, type FieldMeta, refLink } from "@/lib/meta";

export type Values = Record<string, unknown>;

export interface FormGroup {
  label: string;
  fields: FieldMeta[];
  visibleWhen?: { field: string; in: unknown[] };
}

const shown = (w: { field: string; in: unknown[] } | undefined, values: Values) => !w || w.in.includes(values[w.field] ?? null);

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
  openLabel,
  record,
}: {
  groups: FormGroup[];
  values: Values;
  titles: Record<string, string>;
  errors: Record<string, string>;
  readOnly: boolean;
  onChange: (name: string, value: unknown, title?: string) => void;
  /** 1 = šuplík (jeden sloupec), 2 = celá stránka */
  columns?: 1 | 2 | 4;
  /** popisek tlačítka pro proskok na odkazovaný záznam */
  openLabel: string;
  /** záznam (pro pole s obrázkem: nahrání k uloženému záznamu) */
  record?: { objectId: string; id: string | null; labels: ImageLabels };
}) {
  const s = useStyles();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {groups.filter((g) => shown(g.visibleWhen, values) && g.fields.some((f) => shown(f.visibleWhen, values))).map((g) => (
        <section key={g.label} className={s.group}>
          <div className={s.groupTitle}>{g.label}</div>
          <div className={s.grid} style={columns === 1 ? { gridTemplateColumns: "1fr" } : columns === 4 ? { gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "4px 16px" } : undefined}>
            {g.fields.filter((f) => shown(f.visibleWhen, values)).map((f) => (
              <div key={f.name} className={f.kind === "text" || f.image ? s.wide : undefined}>
                {f.image ? (
                  <ImageField f={f} value={values[f.name] as string | null} record={record} disabled={readOnly} onChange={onChange} />
                ) : (
                <FieldInput
                  f={f}
                  value={values[f.name]}
                  title={titles[f.name]}
                  error={errors[f.name]}
                  disabled={readOnly || f.readOnly}
                  onChange={onChange}
                  openLabel={openLabel}
                />
                )}
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
  openLabel,
}: {
  f: FieldMeta;
  value: unknown;
  title?: string;
  error?: string;
  disabled: boolean;
  onChange: (name: string, value: unknown, title?: string) => void;
  openLabel: string;
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
    case "datetime": {
      const local = v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
      control = (
        <Input type="datetime-local" value={local} disabled={disabled} onChange={(_, d) => onChange(f.name, d.value ? new Date(d.value).toISOString() : "")} />
      );
      break;
    }
    case "ref":
      if (disabled) {
        // zamčený odkaz = odkaz na záznam, ne rozbalovací pole
        control = (
          <div style={{ minHeight: 32, display: "flex", alignItems: "center" }}>
            {v ? (
              <NextLink href={refLink(f, v)} style={{ color: tokens.colorBrandForegroundLink, textDecoration: "none", fontWeight: 600 }}>
                {title || "—"}
              </NextLink>
            ) : (
              "—"
            )}
          </div>
        );
        break;
      }
      control = <RefCombobox f={f} value={v} title={title ?? ""} disabled={disabled} onChange={onChange} openLabel={openLabel} />;
      break;
    default:
      control = (
        <Input
          type={f.secret ? "password" : undefined}
          autoComplete={f.secret ? "new-password" : undefined}
          // zamčené číslo zobrazit česky (12 450,00), editované nechat surové
          value={disabled && v && (f.kind === "decimal" || f.kind === "int") ? displayValue(f, { [f.name]: v }, "cs") : v}
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

function OpenRef({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return (
    <Tooltip content={label} relationship="label">
      <Button appearance="subtle" icon={<Open24Regular />} onClick={() => router.push(href)} />
    </Tooltip>
  );
}

/** Výběr odkazovaného záznamu s hledáním na serveru. */
export function RefCombobox({
  f,
  value,
  title,
  disabled,
  onChange,
  openLabel,
  compact = false,
}: {
  f: FieldMeta;
  value: string;
  title: string;
  disabled: boolean;
  onChange: (name: string, value: unknown, title?: string) => void;
  openLabel: string;
  /** mřížka řádků: malá velikost, bez tlačítka Otevřít */
  compact?: boolean;
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
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <Combobox
        // obal se má zúžit (primární slot Comboboxu je input, proto root)
        root={{ style: { flex: 1, minWidth: 0 } }}
        size={compact ? "small" : undefined}
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
      {/* proskok na odkazovaný záznam (číselník, nastavení, subjekt…) */}
      {value && !compact && <OpenRef href={refLink(f, value)} label={openLabel} />}
    </div>
  );
}

export interface ImageLabels {
  upload: string;
  remove: string;
  drop: string;
  afterSave: string;
}

/** Obrázek záznamu: náhled, nahrání tlačítkem nebo přetažením, odebrání. */
function ImageField({
  f,
  value,
  record,
  disabled,
  onChange,
}: {
  f: FieldMeta;
  value: string | null;
  record?: { objectId: string; id: string | null; labels: ImageLabels };
  disabled: boolean;
  onChange: (name: string, value: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const L = record?.labels;
  const can = !!record?.id && !disabled;
  const send = async (file: File | null) => {
    if (!record?.id) return;
    setBusy(true);
    setError(undefined);
    const fd = new FormData();
    fd.set("objectId", record.objectId);
    fd.set("id", record.id);
    fd.set("field", f.name);
    if (file) fd.set("file", file);
    const r = await uploadImageAction(fd);
    setBusy(false);
    if (!r.ok) setError(r.message);
    else onChange(f.name, r.data);
  };
  return (
    <Field label={f.label} validationMessage={error}>
      <div
        onDragOver={(e) => {
          if (!can) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (can && e.dataTransfer.files[0]) void send(e.dataTransfer.files[0]);
        }}
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          padding: 12,
          border: `1px dashed ${over ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke1}`,
          borderRadius: tokens.borderRadiusMedium,
          background: over ? tokens.colorBrandBackground2 : undefined,
        }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- soubor za přihlášením, ne statický obrázek
          <img src={`/api/files/${value}`} alt="" width={128} height={128} style={{ objectFit: "contain", borderRadius: tokens.borderRadiusMedium, background: tokens.colorNeutralBackground3 }} />
        ) : (
          <div style={{ width: 128, height: 128, borderRadius: tokens.borderRadiusMedium, background: tokens.colorNeutralBackground3 }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {can ? <span style={{ color: tokens.colorNeutralForeground3 }}>{L?.drop}</span> : <span style={{ color: tokens.colorNeutralForeground3 }}>{record?.id ? "" : L?.afterSave}</span>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button disabled={!can || busy} onClick={() => input.current?.click()}>
              {L?.upload}
            </Button>
            {value && (
              <Button appearance="subtle" disabled={!can || busy} onClick={() => send(null)}>
                {L?.remove}
              </Button>
            )}
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (file) void send(file);
          }}
        />
      </div>
    </Field>
  );
}
