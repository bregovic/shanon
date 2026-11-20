"use client";
/**
 * Proužek workflow nad detailem záznamu (jako v AX): stav běhu a aktuální krok, tlačítka úkolu pro řešitele
 * (Schválit / Zamítnout / Hotovo s komentářem), historie kroků v dialogu, zrušení běhu. Data `src/server/workflow-bar.ts`.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  makeStyles,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { Checkmark24Regular, CheckmarkCircle24Regular, DismissCircle24Regular, History24Regular, Open24Regular } from "@fluentui/react-icons";
import { cancelWorkflowAction, workflowItemAction } from "@/app/actions";
import type { WorkflowBarData, WorkflowBarItem } from "@/server/workflow-bar";
import { toast } from "./toast";

export interface WorkflowBarLabels {
  workflow: string;
  step: string;
  assignee: string;
  unassigned: string;
  due: string;
  approve: string;
  reject: string;
  done: string;
  history: string;
  openTask: string;
  cancel: string;
  cancelConfirm: string;
  comment: string;
  confirm: string;
  back: string;
  close: string;
  kind: string;
  status: string;
  created: string;
  completed: string;
  completedBy: string;
  result: string;
  task: string;
}

const useStyles = makeStyles({
  bar: { marginBottom: tokens.spacingVerticalM },
  meta: { color: tokens.colorNeutralForeground2 },
  actions: { flexWrap: "wrap", rowGap: tokens.spacingVerticalXS },
  table: { minWidth: "760px" },
  scroll: { overflowX: "auto" },
});

const INTENT: Record<string, "warning" | "success" | "error" | "info"> = { waiting: "warning", running: "info", completed: "success", rejected: "error", cancelled: "info" };
const COLOR: Record<string, "warning" | "success" | "danger" | "subtle" | "brand"> = { open: "warning", done: "success", rejected: "danger", cancelled: "subtle" };

const day = (v: string | null, lang: string) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString(lang === "en" ? "en-GB" : "cs-CZ") : "");
const when = (v: string | null, lang: string) => (v ? new Date(v).toLocaleString(lang === "en" ? "en-GB" : "cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export function WorkflowBar({ data, objectId, recordId, labels: L, lang }: { data: WorkflowBarData; objectId: string; recordId: string; labels: WorkflowBarLabels; lang: string }) {
  const s = useStyles();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [history, setHistory] = useState(false);
  const [act, setAct] = useState<{ item: WorkflowBarItem; action: "approve" | "reject" | "done" } | null>(null);
  const [comment, setComment] = useState("");
  const [cancelAsk, setCancelAsk] = useState(false);

  const run = (item: WorkflowBarItem, action: "approve" | "reject" | "done") =>
    start(async () => {
      const r = await workflowItemAction(item.id, action, comment || null, objectId, recordId);
      if (!r.ok) {
        toast(r.message, "warning");
        return;
      }
      setAct(null);
      setComment("");
      router.refresh();
    });

  const cancelRun = () =>
    start(async () => {
      const r = await cancelWorkflowAction(data.instanceId, objectId, recordId);
      if (!r.ok) toast(r.message, "warning");
      setCancelAsk(false);
      router.refresh();
    });

  const cur = data.open[0];
  const parts = [
    data.stepName ? `${L.step}: ${data.stepName}` : null,
    cur ? `${L.assignee}: ${cur.assignee ?? L.unassigned}` : null,
    cur?.dueDate ? `${L.due} ${day(cur.dueDate, lang)}` : null,
  ].filter(Boolean);

  return (
    <>
      <MessageBar intent={INTENT[data.status] ?? "info"} layout="multiline" className={s.bar} data-testid="workflow-bar">
        <MessageBarBody>
          <MessageBarTitle>
            {L.workflow} {data.definition} · {data.statusLabel}
          </MessageBarTitle>
          {parts.length > 0 && <span className={s.meta}>{parts.join(" · ")}</span>}
          {data.message && <div>{data.message}</div>}
        </MessageBarBody>
        <MessageBarActions className={s.actions}>
          {data.open
            .filter((w) => w.canAct)
            .flatMap((w) =>
              w.kind === "approval"
                ? [
                    <Button key={`${w.id}a`} appearance="primary" icon={<CheckmarkCircle24Regular />} disabled={busy} onClick={() => setAct({ item: w, action: "approve" })}>
                      {L.approve}
                    </Button>,
                    <Button key={`${w.id}r`} icon={<DismissCircle24Regular />} disabled={busy} onClick={() => setAct({ item: w, action: "reject" })}>
                      {L.reject}
                    </Button>,
                  ]
                : [
                    <Button key={`${w.id}d`} appearance="primary" icon={<Checkmark24Regular />} disabled={busy} onClick={() => setAct({ item: w, action: "done" })}>
                      {L.done}
                    </Button>,
                    <Button key={`${w.id}r`} icon={<DismissCircle24Regular />} disabled={busy} onClick={() => setAct({ item: w, action: "reject" })}>
                      {L.reject}
                    </Button>,
                  ],
            )}
          {cur && (
            <Button appearance="subtle" icon={<Open24Regular />} onClick={() => router.push(`/wf/workItem/${cur.id}`)}>
              {L.openTask}
            </Button>
          )}
          <Button appearance="subtle" icon={<History24Regular />} onClick={() => setHistory(true)}>
            {L.history}
          </Button>
        </MessageBarActions>
      </MessageBar>

      {/* vyřízení úkolu s komentářem */}
      <Dialog open={!!act} onOpenChange={(_, d) => !d.open && setAct(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{act ? `${act.action === "approve" ? L.approve : act.action === "reject" ? L.reject : L.done}: ${act.item.title}` : ""}</DialogTitle>
            <DialogContent>
              {act?.item.description && <p>{act.item.description}</p>}
              <Field label={L.comment}>
                <Textarea value={comment} onChange={(_, d) => setComment(d.value)} maxLength={255} resize="vertical" autoFocus />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setAct(null)}>{L.back}</Button>
              <Button appearance="primary" disabled={busy} onClick={() => act && run(act.item, act.action)}>
                {L.confirm}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* historie schvalování */}
      <Dialog open={history} onOpenChange={(_, d) => setHistory(d.open)}>
        <DialogSurface style={{ maxWidth: 1000 }}>
          <DialogBody>
            <DialogTitle>
              {L.history} · {data.definition}
            </DialogTitle>
            <DialogContent>
              <div className={s.scroll}>
                <Table size="small" className={s.table} style={{ tableLayout: "auto" }}>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>{L.task}</TableHeaderCell>
                      <TableHeaderCell>{L.kind}</TableHeaderCell>
                      <TableHeaderCell>{L.status}</TableHeaderCell>
                      <TableHeaderCell>{L.assignee}</TableHeaderCell>
                      <TableHeaderCell>{L.created}</TableHeaderCell>
                      <TableHeaderCell>{L.completed}</TableHeaderCell>
                      <TableHeaderCell>{L.completedBy}</TableHeaderCell>
                      <TableHeaderCell>{L.result}</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.history.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell>
                          <a href={`/wf/workItem/${w.id}`}>{w.title}</a>
                          {data.runs > 1 && <div className={s.meta}>{w.workflow}</div>}
                          {w.description && <div className={s.meta}>{w.description}</div>}
                        </TableCell>
                        <TableCell>{w.kindLabel}</TableCell>
                        <TableCell>
                          <Badge appearance="tint" color={COLOR[w.status] ?? "subtle"}>
                            {w.statusLabel}
                          </Badge>
                        </TableCell>
                        <TableCell>{w.assignee ?? L.unassigned}</TableCell>
                        <TableCell>{when(w.createdAt, lang)}</TableCell>
                        <TableCell>{when(w.completedAt, lang)}</TableCell>
                        <TableCell>{w.completedBy ?? ""}</TableCell>
                        <TableCell>{w.result ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DialogContent>
            <DialogActions>
              {data.canCancel && (
                <Button icon={<DismissCircle24Regular />} disabled={busy} onClick={() => setCancelAsk(true)}>
                  {L.cancel}
                </Button>
              )}
              <Button appearance="primary" onClick={() => setHistory(false)}>
                {L.close}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={cancelAsk} onOpenChange={(_, d) => setCancelAsk(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{L.cancel}</DialogTitle>
            <DialogContent>{L.cancelConfirm}</DialogContent>
            <DialogActions>
              <Button onClick={() => setCancelAsk(false)}>{L.back}</Button>
              <Button appearance="primary" disabled={busy} onClick={cancelRun}>
                {L.cancel}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
