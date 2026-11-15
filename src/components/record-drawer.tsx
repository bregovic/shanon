"use client";

/**
 * Šuplík zprava pro založení / úpravu záznamu (standard formulářů staré verze:
 * Drawer position="end", nahoře název a zavření, dole [Zpět] … [Uložit]).
 */
import { toast } from "./toast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnsavedGuard, type UnsavedLabels } from "./unsaved-guard";
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
import { duplicateRecordAction, getRecordAction, saveRecordAction } from "@/app/actions";
import { triggersPreview, usePreview } from "./use-preview";
import { RecordForm, type FormGroup, type ImageLabels, type Values } from "./record-form";
import { useShortcuts } from "./shortcuts";

export interface DrawerLabels {
  image: ImageLabels;
  save: string;
  cancel: string;
  close: string;
  newTitle: string;
  open: string;
  duplicate: string;
  unsaved: UnsavedLabels;
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
  // neuložené změny: zavření šuplíku (Esc, klik vedle, Zpět, křížek) se zeptá Uložit / Neukládat / Zpět
  const dirtyRef = useRef(false);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  const unsaved = useUnsavedGuard(() => p.open && dirtyRef.current, () => saveRef.current(), { links: false });
  const close = () => unsaved.guard(() => {
    dirtyRef.current = false;
    p.onClose();
  });
  return (
    <>
      <Drawer type="overlay" position="end" size="medium" open={p.open} onOpenChange={(_, d) => !d.open && close()}>
        {/* nový klíč při každém otevření = čistý stav formuláře */}
        {p.open && <Editor key={p.id ?? "new"} {...p} onClose={close} dirtyRef={dirtyRef} saveRef={saveRef} />}
      </Drawer>
      {unsaved.dialog(p.labels.unsaved)}
    </>
  );
}

function Editor({ objectId, id: openedId, title, groups, defaults, defaultTitles, readOnly, fixed, labels, onClose, onSaved, dirtyRef, saveRef }: DrawerProps & { dirtyRef: { current: boolean }; saveRef: { current: () => Promise<boolean> } }) {
  // Duplikovat přepne formulář na nový záznam s předvyplněnými hodnotami
  const [id, setId] = useState(openedId);
  const [state, setState] = useState<EditorState>({ values: defaults, titles: defaultTitles ?? {}, errors: {} });
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  // náhled: co uložení doplní (cena z položky, číslo z řady) — ukázat hned
  const allFields = useMemo(() => groups.flatMap((g) => g.fields), [groups]);
  const pv = usePreview(objectId, id, { fields: useMemo(() => allFields.map((f) => f.name), [allFields]), fixed, disabled: !!readOnly });
  const applyPreview = useCallback((vals: Values, t: Record<string, string>) => setState((s) => ({ ...s, values: { ...s.values, ...vals }, titles: { ...s.titles, ...t } })), []);
  useEffect(() => {
    if (!id && !readOnly) pv.run(defaults, applyPreview, 0);
    // jen při otevření nového záznamu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const save = async (): Promise<boolean> => {
    setSaving(true);
    const editable = groups.flatMap((g) => g.fields).filter((f) => !f.readOnly);
    const values: Values = {};
    for (const f of editable) values[f.name] = state.values[f.name] ?? null;
    Object.assign(values, fixed ?? {});
    const res = await saveRecordAction(objectId, id, pv.strip(values), state.version);
    setSaving(false);
    if (!res.ok) {
      // chyby u polí, která formulář neukazuje, musí být vidět aspoň v hlášce
      const shown = new Set(groups.flatMap((g) => g.fields.map((f) => f.name)));
      const hidden = Object.entries(res.errors ?? {}).filter(([k, v]) => v && !shown.has(k)).map(([, v]) => v);
      setState((s) => ({ ...s, errors: res.errors ?? {}, message: [res.message, ...hidden].join(" ") }));
      return false;
    }
    dirtyRef.current = false;
    const warns = (res.data as { _warnings?: string[] })._warnings;
    if (warns?.length) toast(warns.join(" · "), "warning");
    onSaved(res.data);
    return true;
  };
  useEffect(() => {
    saveRef.current = save;
  });

  const duplicate = async () => {
    if (!id) return;
    setSaving(true);
    const r = await duplicateRecordAction(objectId, id);
    setSaving(false);
    if (!r.ok || !r.data) return setState((s) => ({ ...s, message: r.ok ? undefined : r.message }));
    if ("id" in r.data) return onSaved({ id: r.data.id });
    setId(null);
    setState({ values: { ...defaults, ...r.data.values }, titles: r.data.titles, errors: {} });
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
            openLabel={labels.open}
            record={{ objectId, id, labels: labels.image }}
            onChange={(name, value, t) => {
              dirtyRef.current = true;
              pv.touch(name);
              setState((s) => ({
                ...s,
                values: { ...s.values, [name]: value },
                titles: t !== undefined ? { ...s.titles, [name]: t } : s.titles,
                errors: { ...s.errors, [name]: "" },
              }));
              if (triggersPreview(allFields.find((f) => f.name === name)?.kind)) pv.run({ ...state.values, [name]: value }, applyPreview);
            }}
          />
        )}
      </DrawerBody>
      <DrawerFooter>
        <Button onClick={onClose}>{labels.cancel}</Button>
        <span style={{ flex: 1 }} />
        {!readOnly && id && (
          <Button disabled={saving || loading} onClick={duplicate}>
            {labels.duplicate}
          </Button>
        )}
        {!readOnly && (
          <Button appearance="primary" disabled={saving || loading} onClick={save}>
            {labels.save}
          </Button>
        )}
      </DrawerFooter>
    </>
  );
}
