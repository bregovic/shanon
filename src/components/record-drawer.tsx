"use client";

/**
 * Šuplík zprava pro založení / úpravu záznamu (standard formulářů staré verze:
 * Drawer position="end", nahoře název a zavření, dole [Zpět] … [Uložit]).
 */
import { useEffect, useState } from "react";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  MessageBar,
  MessageBarBody,
  Spinner,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { getRecordAction, saveRecordAction } from "@/app/actions";
import { RecordForm, type FormGroup, type Values } from "./record-form";
import { useShortcuts } from "./shortcuts";

export interface DrawerLabels {
  save: string;
  cancel: string;
  close: string;
  newTitle: string;
}

export interface EditorState {
  values: Values;
  titles: Record<string, string>;
  errors: Record<string, string>;
  message?: string;
  version?: number;
}

/** Hodnoty pro formulář: pole objektu + pole rozšíření z ext. */
export function recordToValues(record: Values): Values {
  return { ...record, ...((record.ext as Values) ?? {}) };
}

type DrawerProps = {
  objectId: string;
  id: string | null;
  open: boolean;
  title: string;
  groups: FormGroup[];
  defaults: Values;
  defaultTitles?: Record<string, string>;
  readOnly?: boolean;
  /** hodnoty, které se uloží vždy, i když pole ve formuláři není (rodič řádku) */
  fixed?: Values;
  labels: DrawerLabels;
  onClose: () => void;
  onSaved: (record: Values) => void;
};

export function RecordDrawer(p: DrawerProps) {
  return (
    <Drawer type="overlay" position="end" size="medium" open={p.open} onOpenChange={(_, d) => !d.open && p.onClose()}>
      {/* nový klíč při každém otevření = čistý stav formuláře */}
      {p.open && <Editor key={p.id ?? "new"} {...p} />}
    </Drawer>
  );
}

function Editor({ objectId, id, title, groups, defaults, defaultTitles, readOnly, fixed, labels, onClose, onSaved }: DrawerProps) {
  const [state, setState] = useState<EditorState>({ values: defaults, titles: defaultTitles ?? {}, errors: {} });
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    getRecordAction(objectId, id).then((r) => {
      if (!alive) return;
      setLoading(false);
      if (!r.ok || !r.data) {
        setState((s) => ({ ...s, message: r.ok ? undefined : r.message }));
        return;
      }
      setState({
        values: recordToValues(r.data),
        titles: (r.data._titles as Record<string, string>) ?? {},
        errors: {},
        version: r.data.version as number,
      });
    });
    return () => {
      alive = false;
    };
  }, [id, objectId]);

  const save = async () => {
    setSaving(true);
    const editable = groups.flatMap((g) => g.fields).filter((f) => !f.readOnly);
    const values: Values = {};
    for (const f of editable) values[f.name] = state.values[f.name] ?? null;
    Object.assign(values, fixed ?? {});
    const res = await saveRecordAction(objectId, id, values, state.version);
    setSaving(false);
    if (!res.ok) {
      // chyby u polí, která formulář neukazuje, musí být vidět aspoň v hlášce
      const shown = new Set(groups.flatMap((g) => g.fields.map((f) => f.name)));
      const hidden = Object.entries(res.errors ?? {}).filter(([k, v]) => v && !shown.has(k)).map(([, v]) => v);
      setState((s) => ({ ...s, errors: res.errors ?? {}, message: [res.message, ...hidden].join(" ") }));
      return;
    }
    onSaved(res.data);
  };

  useShortcuts({ save: !readOnly && !saving && !loading ? save : undefined });

  return (
    <>
      <DrawerHeader>
        <DrawerHeaderTitle
          action={<Button appearance="subtle" aria-label={labels.close} icon={<Dismiss24Regular />} onClick={onClose} />}
        >
          {id ? title : labels.newTitle}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {state.message && (
          <MessageBar intent="error" style={{ marginBottom: 16 }}>
            <MessageBarBody>{state.message}</MessageBarBody>
          </MessageBar>
        )}
        {loading ? (
          <Spinner />
        ) : (
          <RecordForm
            groups={groups}
            values={state.values}
            titles={state.titles}
            errors={state.errors}
            readOnly={!!readOnly}
            columns={1}
            onChange={(name, value, t) =>
              setState((s) => ({
                ...s,
                values: { ...s.values, [name]: value },
                titles: t !== undefined ? { ...s.titles, [name]: t } : s.titles,
                errors: { ...s.errors, [name]: "" },
              }))
            }
          />
        )}
      </DrawerBody>
      <DrawerFooter>
        <Button onClick={onClose}>{labels.cancel}</Button>
        <span style={{ flex: 1 }} />
        {!readOnly && (
          <Button appearance="primary" disabled={saving || loading} onClick={save}>
            {labels.save}
          </Button>
        )}
      </DrawerFooter>
    </>
  );
}
