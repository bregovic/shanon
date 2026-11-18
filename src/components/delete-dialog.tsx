"use client";

/**
 * Potvrzení smazání (standard pro seznam, detail i řádky): po otevření se server zeptá nanečisto,
 * co smazat půjde; nejde-li něco, ukáže proč a kde je záznam použitý (odkazy na doklady).
 * Smaže se jen to, co jde.
 */
import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Link, Spinner, Text, tokens } from "@fluentui/react-components";
import { deleteCheckAction } from "@/app/actions";
import type { UiLabels } from "@/server/ui";

type Check = { id: string; title: string; ok: boolean; reason?: string; refs: { label: string; count: number; titles: string[]; href?: string }[] };

export function DeleteDialog({
  open,
  objectId,
  ids,
  labels,
  onClose,
  onConfirm,
}: {
  open: boolean;
  objectId: string;
  ids: string[];
  labels: UiLabels["actions"];
  onClose: () => void;
  /** smazat tyto záznamy (jen ty, které kontrola pustila) */
  onConfirm: (ids: string[]) => void;
}) {
  const key = `${objectId}:${ids.join(",")}`;
  // výsledek patří k výběru, pro který se kontroloval (jiný výběr = znovu „Kontroluji…“)
  const [res, setRes] = useState<{ key: string; rows?: Check[]; error?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void deleteCheckAction(objectId, ids).then((r) => {
      if (live) setRes(r.ok ? { key, rows: r.data } : { key, error: r.message });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  // zavřením se výsledek zahodí — příště se kontroluje znovu (data se mezitím mohla změnit)
  const close = () => {
    setRes(null);
    onClose();
  };
  const cur = open && res?.key === key ? res : null;
  const rows = cur?.rows ?? null;
  const error = cur?.error;
  const ok = rows?.filter((r) => r.ok) ?? [];
  const bad = rows?.filter((r) => !r.ok) ?? [];
  const n = ids.length;

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && close()}>
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle>{labels.delete}</DialogTitle>
          <DialogContent>
            {error ? (
              <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>
            ) : !rows ? (
              <Spinner size="tiny" label={labels.deleteChecking} labelPosition="after" />
            ) : !bad.length ? (
              labels.deleteAllOk.replace("{n}", String(n))
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Text>{ok.length ? labels.deleteSomeOk.replace("{ok}", String(ok.length)).replace("{n}", String(n)) : labels.deleteNoneOk}</Text>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                  {bad.map((r) => (
                    <div key={r.id} style={{ borderLeft: `3px solid ${tokens.colorPaletteRedBorder2}`, paddingLeft: 8 }}>
                      <Text weight="semibold">{r.title}</Text>
                      {!r.refs.length && r.reason && (
                        <div>
                          <Text size={200}>{r.reason}</Text>
                        </div>
                      )}
                      {r.refs.map((x, i) => (
                        <div key={i}>
                          <Text size={200}>
                            {labels.deleteUsedIn}{" "}
                            {x.href ? (
                              <Link href={x.href} target="_blank" inline>
                                {x.label}
                              </Link>
                            ) : (
                              x.label
                            )}{" "}
                            ({x.count}){x.titles.length ? `: ${x.titles.join(", ")}${x.count > x.titles.length ? ", …" : ""}` : ""}
                          </Text>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>{labels.cancel}</Button>
            {(!rows || ok.length > 0) && <Button appearance="primary" disabled={!rows} onClick={() => {
                setRes(null);
                onConfirm(ok.map((r) => r.id));
              }}>
              {bad.length ? labels.deleteCount.replace("{n}", String(ok.length)) : labels.delete}
            </Button>}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
