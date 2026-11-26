"use client";

/**
 * Doklad → Označit k vyrovnání: nezaúčtované řádky deníků (platby z výpisu) partnera dokladu nebo bez účtu,
 * výběr řádku a částky. Vyrovná se při zaúčtování deníku (`src/server/journal-settle.ts`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Radio,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { markSettleSaveAction, markSettleViewAction } from "@/app/actions";
import type { MarkView } from "@/server/journal-settle";

const useStyles = makeStyles({
  surface: { maxWidth: "min(1000px, 96vw)", width: "100%" },
  filters: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px 12px", alignItems: "end", marginBottom: "12px" },
  tableWrap: { maxHeight: "50vh", overflow: "auto", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  num: { textAlign: "right", whiteSpace: "nowrap" },
  foot: { display: "flex", gap: "16px", alignItems: "end", flexWrap: "wrap", marginTop: "10px", justifyContent: "flex-end" },
});

export function MarkSettleDialog({ objectId, id, open, onClose, onSaved, lang }: { objectId: string; id: string; open: boolean; onClose: () => void; onSaved: () => void; lang: string }) {
  const s = useStyles();
  const nf = useMemo(() => new Intl.NumberFormat(lang === "en" ? "en-GB" : "cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [lang]);
  const [view, setView] = useState<MarkView | null>(null);
  const [crit, setCrit] = useState<{ all?: boolean; vs?: string; amount?: string }>({});
  const [line, setLine] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (c: typeof crit) => {
      setBusy(true);
      const r = await markSettleViewAction(objectId, id, c);
      setBusy(false);
      if (!r.ok) return setError(r.message);
      setError(undefined);
      setView(r.data);
    },
    [objectId, id],
  );
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- nový dialog = nový výběr
    setLine(null);
    setAmount("");
    setCrit({});
    void load({});
  }, [open, load]);

  const T = view?.texts ?? {};
  const money = (v: string) => nf.format(Number(v));
  const save = async () => {
    if (!line) return;
    setBusy(true);
    const r = await markSettleSaveAction(objectId, id, line, amount);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle>
            {T.MarkSettle ?? ""}
            {view && ` · ${view.doc.num}${view.doc.partnerName ? ` · ${view.doc.partnerName}` : ""}`}
          </DialogTitle>
          <DialogContent>
            {T.MarkSettleHint && <Text size={200} block style={{ marginBottom: 10, color: tokens.colorNeutralForeground3 }}>{T.MarkSettleHint}</Text>}
            {error && (
              <MessageBar intent="error" style={{ marginBottom: 8 }}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            <form
              className={s.filters}
              onSubmit={(e) => {
                e.preventDefault();
                void load(crit);
              }}
            >
              <Field label={T.MarkSettleAll}>
                <Switch checked={!!crit.all} onChange={(_, d) => setCrit((c) => ({ ...c, all: d.checked }))} />
              </Field>
              <Field label={T.Vs}>
                <Input value={crit.vs ?? ""} onChange={(_, d) => setCrit((c) => ({ ...c, vs: d.value }))} inputMode="numeric" />
              </Field>
              <Field label={T.Amount}>
                <Input value={crit.amount ?? ""} onChange={(_, d) => setCrit((c) => ({ ...c, amount: d.value }))} inputMode="decimal" />
              </Field>
              <Button type="submit" appearance="secondary" disabled={busy}>
                {T.SettleSearch}
              </Button>
            </form>
            <div className={s.tableWrap}>
              {!view ? (
                <Spinner style={{ margin: 20 }} />
              ) : !view.rows.length ? (
                <Text block style={{ padding: 16 }}>{T.SettleNone2}</Text>
              ) : (
                <Table size="small">
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell style={{ width: 40 }} />
                      <TableHeaderCell>{T.MarkJournal}</TableHeaderCell>
                      <TableHeaderCell>{T.Date}</TableHeaderCell>
                      <TableHeaderCell>{T.Text}</TableHeaderCell>
                      <TableHeaderCell>{T.Vs}</TableHeaderCell>
                      <TableHeaderCell>{T.SettlePartner}</TableHeaderCell>
                      <TableHeaderCell className={s.num}>{T.Amount}</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.rows.map((r) => (
                      <TableRow key={r.lineId} onClick={() => setLine(r.lineId)} style={{ cursor: "pointer", fontWeight: r.marked ? 600 : undefined }}>
                        <TableCell>
                          <Radio checked={line === r.lineId} onChange={() => setLine(r.lineId)} aria-label={r.text || r.journal} />
                        </TableCell>
                        <TableCell>{r.journal}</TableCell>
                        <TableCell>{r.date ? new Date(r.date).toLocaleDateString(lang === "en" ? "en-GB" : "cs-CZ") : ""}</TableCell>
                        <TableCell>{r.text}</TableCell>
                        <TableCell>{r.vs}</TableCell>
                        <TableCell>{r.partnerName}</TableCell>
                        <TableCell className={s.num}>{money(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            {view && (
              <div className={s.foot}>
                <Text>
                  {T.SettleRemaining}: <b>{money(view.doc.remaining)}</b>
                </Text>
                <Field label={T.Amount}>
                  <Input value={amount} placeholder={money(view.doc.remaining)} onChange={(_, d) => setAmount(d.value)} inputMode="decimal" style={{ width: 130 }} />
                </Field>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              {lang === "en" ? "Close" : "Zavřít"}
            </Button>
            <Button appearance="primary" disabled={busy || !line} onClick={() => void save()}>
              {T.MarkSettle}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
