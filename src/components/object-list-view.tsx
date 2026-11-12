"use client";

/**
 * Seznam záznamů objektu: lišta akcí + SmartGrid + šuplík.
 * Objekty s řádky (deník, doklad) se místo šuplíku otevírají na celé stránce.
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  ToolbarDivider,
} from "@fluentui/react-components";
import { Add24Regular, ArrowClockwise24Regular, Delete24Regular, Edit24Regular } from "@fluentui/react-icons";
import { deleteRecordsAction } from "@/app/actions";
import { objectHref, type FieldMeta } from "@/lib/meta";
import type { UiLabels } from "@/server/ui";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";
import { RecordDrawer } from "./record-drawer";
import type { FormGroup, Values } from "./record-form";
import { useShortcuts } from "./shortcuts";
import { SmartGrid } from "./smart-grid";

type Row = Record<string, unknown>;

export interface ObjectListProps {
  objectId: string;
  crumbs: { label: string; href?: string }[];
  label: string;
  titleField: string;
  columns: FieldMeta[];
  groups: FormGroup[];
  defaults: Values;
  canCreate: boolean;
  canDelete: boolean;
  openInPage: boolean;
  initial: { rows: Row[]; total: number };
  lang: string;
  labels: UiLabels;
}

export function ObjectListView(p: ObjectListProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Row[]>([]);
  const [reload, setReload] = useState(0);
  const [drawer, setDrawer] = useState<{ open: boolean; id: string | null; title: string }>({ open: false, id: null, title: "" });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();

  const open = useCallback(
    (row: Row | null) => {
      if (p.openInPage) {
        router.push(objectHref(p.objectId, row ? String(row.id) : "new"));
        return;
      }
      setDrawer({ open: true, id: row ? String(row.id) : null, title: row ? String(row[p.titleField] ?? p.label) : "" });
    },
    [p.openInPage, p.objectId, p.titleField, p.label, router],
  );

  // standard: Shift+N nový, Shift+R obnovit, Shift+D smazat, Esc zpět na modul
  useShortcuts(
    {
      new: p.canCreate ? () => open(null) : undefined,
      refresh: () => setReload((n) => n + 1),
      delete: p.canDelete ? () => selected.length && setConfirm(true) : undefined,
      escape: () => p.crumbs[0]?.href && router.push(p.crumbs[0].href),
    },
    !drawer.open && !confirm,
  );

  const remove = async () => {
    setConfirm(false);
    const res = await deleteRecordsAction(p.objectId, selected.map((r) => String(r.id)));
    if (!res.ok) setError(res.message);
    else {
      setError(undefined);
      setReload((n) => n + 1);
    }
  };

  return (
    <>
      <ActionBar>
        <Crumbs items={p.crumbs} />
        <Spacer />
        {p.canCreate && (
          <Button appearance="primary" icon={<Add24Regular />} title={`${p.labels.actions.new} (Shift+N)`} onClick={() => open(null)}>
            {p.labels.actions.new}
          </Button>
        )}
        <Button icon={<Edit24Regular />} disabled={selected.length !== 1} onClick={() => open(selected[0])}>
          {p.labels.actions.edit}
        </Button>
        {p.canDelete && (
          <Button icon={<Delete24Regular />} title={`${p.labels.actions.delete} (Shift+D)`} disabled={selected.length === 0} onClick={() => setConfirm(true)}>
            {p.labels.actions.delete}
          </Button>
        )}
        <ToolbarDivider />
        <Button appearance="subtle" icon={<ArrowClockwise24Regular />} title={`${p.labels.actions.refresh} (Shift+R)`} onClick={() => setReload((n) => n + 1)}>
          {p.labels.actions.refresh}
        </Button>
      </ActionBar>

      <PageContent>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <SmartGrid
          objectId={p.objectId}
          columns={p.columns}
          lang={p.lang}
          labels={p.labels.grid}
          initial={p.initial}
          reloadKey={reload}
          storageKey={p.objectId}
          onOpen={open}
          onSelectionChange={setSelected}
        />
      </PageContent>

      {!p.openInPage && (
        <RecordDrawer
          objectId={p.objectId}
          id={drawer.id}
          open={drawer.open}
          title={drawer.title}
          groups={p.groups}
          defaults={p.defaults}
          labels={p.labels.drawer}
          onClose={() => setDrawer((d) => ({ ...d, open: false }))}
          onSaved={() => {
            setDrawer((d) => ({ ...d, open: false }));
            setReload((n) => n + 1);
          }}
        />
      )}

      <Dialog open={confirm} onOpenChange={(_, d) => setConfirm(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{p.labels.actions.delete}</DialogTitle>
            <DialogContent>{p.labels.actions.confirmDelete.replace("{n}", String(selected.length))}</DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(false)}>{p.labels.actions.cancel}</Button>
              <Button appearance="primary" onClick={remove}>
                {p.labels.actions.delete}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
