"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { deleteAction, recordAction, saveAction, searchRefs, type FormState } from "@/app/actions";
import type { FieldMeta } from "@/server/ui";
import { cn } from "@/lib/cn";

export interface FormLabels {
  save: string;
  delete: string;
  saved: string;
  search: string;
}

interface Props {
  objectId: string;
  id: string | null;
  version?: number;
  back?: string;
  groups: { label: string; fields: FieldMeta[] }[];
  values: Record<string, unknown>;
  titles: Record<string, string>;
  readOnly: boolean;
  canDelete: boolean;
  actions: { id: string; label: string }[];
  labels: FormLabels;
  justSaved?: boolean;
}

export function ObjectForm(p: Props) {
  const [state, save, saving] = useActionState<FormState, FormData>(saveAction, {});
  const [delState, del, deleting] = useActionState<FormState, FormData>(deleteAction, {});
  const [actState, act, acting] = useActionState<FormState, FormData>(recordAction, {});
  const message = state.message ?? delState.message ?? actState.message;
  const errors = state.errors ?? {};
  const allFields = p.groups.flatMap((g) => g.fields);
  const values = state.values ? { ...p.values, ...state.values } : p.values;
  const titles = state.titles ? { ...p.titles, ...state.titles } : p.titles;

  return (
    <div className="space-y-4">
      {message && <div className="rounded-lg bg-danger-soft px-4 py-2.5 text-sm text-danger">{message}</div>}
      {!message && p.justSaved && <div className="rounded-lg bg-ok-soft px-4 py-2.5 text-sm text-ok">{p.labels.saved}</div>}

      <form action={save} className="space-y-4" key={`${p.version ?? "new"}:${JSON.stringify(state)}`}>
        <input type="hidden" name="_object" value={p.objectId} />
        <input type="hidden" name="_id" value={p.id ?? ""} />
        <input type="hidden" name="_version" value={p.version ?? ""} />
        <input type="hidden" name="_back" value={p.back ?? ""} />
        <input
          type="hidden"
          name="_fields"
          value={JSON.stringify(allFields.filter((f) => !f.readOnly).map((f) => ({ name: f.name, kind: f.kind })))}
        />
        {p.groups.map((g) => (
          <fieldset key={g.label} className="card p-5">
            <legend className="sr-only">{g.label}</legend>
            <div className="mb-4 text-sm font-semibold">{g.label}</div>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {g.fields.map((f) => (
                <Field
                  key={f.name}
                  f={f}
                  value={values[f.name]}
                  title={titles[f.name]}
                  error={errors[f.name]}
                  disabled={p.readOnly || f.readOnly}
                  searchLabel={p.labels.search}
                />
              ))}
            </div>
          </fieldset>
        ))}
        {!p.readOnly && (
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={saving}>
              {p.labels.save}
            </button>
          </div>
        )}
      </form>

      {(p.actions.length > 0 || p.canDelete) && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {p.actions.map((a) => (
            <form key={a.id} action={act}>
              <input type="hidden" name="_object" value={p.objectId} />
              <input type="hidden" name="_id" value={p.id ?? ""} />
              <input type="hidden" name="_action" value={a.id} />
              <button className="btn btn-primary" disabled={acting}>
                {a.label}
              </button>
            </form>
          ))}
          {p.canDelete && (
            <form action={del} className="ml-auto">
              <input type="hidden" name="_object" value={p.objectId} />
              <input type="hidden" name="_id" value={p.id ?? ""} />
              <input type="hidden" name="_back" value={p.back ?? ""} />
              <button className="btn btn-danger" disabled={deleting}>
                {p.labels.delete}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  f,
  value,
  title,
  error,
  disabled,
  searchLabel,
}: {
  f: FieldMeta;
  value: unknown;
  title?: string;
  error?: string;
  disabled: boolean;
  searchLabel: string;
}) {
  const name = `f:${f.name}`;
  const v = value === null || value === undefined ? "" : String(value);
  const cls = cn("input", error && "border-danger", f.align === "right" && "text-right tabular-nums");
  let input: React.ReactNode;
  switch (f.kind) {
    case "bool":
      input = (
        <input type="checkbox" name={name} defaultChecked={value === true} disabled={disabled} className="h-4 w-4 accent-[var(--accent)]" />
      );
      break;
    case "enum":
      input = (
        <select name={name} defaultValue={v} disabled={disabled} className={cls}>
          {!f.mandatory && <option value="" />}
          {f.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "text":
      input = <textarea name={name} defaultValue={v} disabled={disabled} rows={3} className={cn(cls, "h-auto py-2")} />;
      break;
    case "date":
      input = <input type="date" name={name} defaultValue={v} disabled={disabled} className={cls} />;
      break;
    case "ref":
      input = disabled ? (
        <div className="flex h-9 items-center text-sm">
          {v ? (
            <Link href={`${f.refHref}/${v}`} className="text-accent hover:underline">
              {title || "—"}
            </Link>
          ) : (
            "—"
          )}
        </div>
      ) : (
        <RefPicker name={name} f={f} value={v} title={title ?? ""} invalid={!!error} searchLabel={searchLabel} />
      );
      break;
    default:
      input = (
        <input
          name={name}
          defaultValue={v}
          disabled={disabled}
          maxLength={f.maxLength}
          inputMode={f.kind === "decimal" || f.kind === "int" ? "decimal" : undefined}
          className={cls}
        />
      );
  }
  return (
    <label className={cn("block space-y-1", f.kind === "text" && "sm:col-span-2", f.kind === "bool" && "flex items-center gap-2 space-y-0 pt-6")}>
      {f.kind !== "bool" && (
        <span className="text-xs font-medium text-muted">
          {f.label}
          {f.mandatory && !disabled && <span className="text-danger"> *</span>}
        </span>
      )}
      {input}
      {f.kind === "bool" && <span className="text-sm">{f.label}</span>}
      {error && <span className="block text-xs text-danger">{error}</span>}
    </label>
  );
}

/** Výběr odkazovaného záznamu s hledáním. */
function RefPicker({
  name,
  f,
  value,
  title,
  invalid,
  searchLabel,
}: {
  name: string;
  f: FieldMeta;
  value: string;
  title: string;
  invalid: boolean;
  searchLabel: string;
}) {
  const [selected, setSelected] = useState({ id: value, title });
  const [q, setQ] = useState(title);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ id: string; title: string; subtitle: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => {
      searchRefs(f.refObject!, q === selected.title ? "" : q).then(setOptions);
    }, 150);
    return () => clearTimeout(h);
  }, [q, open, f.refObject, selected.title]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setQ(selected.title);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [selected.title]);

  return (
    <div ref={box} className="relative">
      <input type="hidden" name={name} value={selected.id} />
      <input type="hidden" name={name.replace(/^f:/, "t:")} value={selected.title} />
      <input
        value={q}
        placeholder={searchLabel}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (!e.target.value) setSelected({ id: "", title: "" });
        }}
        className={cn("input", invalid && "border-danger")}
      />
      {open && options.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  setSelected({ id: o.id, title: o.title });
                  setQ(o.title);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{o.title}</span>
                <span className="truncate text-xs text-muted">{o.subtitle}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
