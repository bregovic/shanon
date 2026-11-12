"use client";

/** Historie změn záznamu — šuplík s tím, kdo, kdy a co změnil. */
import { useEffect, useState } from "react";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Spinner,
  tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular, History24Regular } from "@fluentui/react-icons";
import { historyAction } from "@/app/actions";
import type { HistoryEntry } from "@/server/history";

export interface HistoryLabels {
  history: string;
  noHistory: string;
  close: string;
  actions: Record<string, string>;
}

const useStyles = makeStyles({
  entry: { padding: "12px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  head: { display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "6px" },
  action: { fontWeight: tokens.fontWeightSemibold },
  meta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: tokens.fontSizeBase200 },
  label: { color: tokens.colorNeutralForeground3, paddingRight: "12px", verticalAlign: "top", whiteSpace: "nowrap" },
  from: { color: tokens.colorNeutralForeground3, textDecorationLine: "line-through", paddingRight: "8px" },
  empty: { color: tokens.colorNeutralForeground3, padding: "24px 0", textAlign: "center" },
});

export function HistoryButton({
  objectId,
  recordId,
  recordTitle,
  labels,
}: {
  objectId: string;
  recordId: string | null;
  recordTitle: string;
  labels: HistoryLabels;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button appearance="subtle" icon={<History24Regular />} disabled={!recordId} title={labels.history} aria-label={labels.history} onClick={() => setOpen(true)} />
      <Drawer type="overlay" position="end" size="medium" open={open && !!recordId} onOpenChange={(_, d) => !d.open && setOpen(false)}>
        {open && recordId && (
          <Body key={recordId} objectId={objectId} recordId={recordId} recordTitle={recordTitle} labels={labels} onClose={() => setOpen(false)} />
        )}
      </Drawer>
    </>
  );
}

function Body({
  objectId,
  recordId,
  recordTitle,
  labels,
  onClose,
}: {
  objectId: string;
  recordId: string;
  recordTitle: string;
  labels: HistoryLabels;
  onClose: () => void;
}) {
  const s = useStyles();
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    historyAction(objectId, recordId).then((r) => {
      if (!alive) return;
      if (r.ok) setItems(r.data);
      else setError(r.message);
    });
    return () => {
      alive = false;
    };
  }, [objectId, recordId]);

  return (
    <>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={labels.close} icon={<Dismiss24Regular />} onClick={onClose} />}>
          {labels.history} · {recordTitle}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {!items && !error && <Spinner />}
        {items?.length === 0 && <div className={s.empty}>{labels.noHistory}</div>}
        {items?.map((h, i) => (
          <div key={i} className={s.entry}>
            <div className={s.head}>
              <span className={s.action}>{labels.actions[h.action] ?? h.action}</span>
              <span className={s.meta}>
                {new Date(h.at).toLocaleString("cs-CZ")}
                {h.user && ` · ${h.user}`}
              </span>
            </div>
            {h.changes.length > 0 && (
              <table className={s.table}>
                <tbody>
                  {h.changes.map((c, j) => (
                    <tr key={j}>
                      <td className={s.label}>{c.label}</td>
                      <td>
                        {c.from && <span className={s.from}>{c.from}</span>}
                        {c.to}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </DrawerBody>
    </>
  );
}
