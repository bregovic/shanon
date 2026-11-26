"use client";

/**
 * Deník → Vyrovnat: otevřené položky salda k vybranému řádku. Kritéria (jen partner řádku, druh, VS, částka,
 * datum, doklad / partner), zaškrtnutí + částka k úhradě, uložení výběru. Řádek bez partnera ho převezme
 * z vybraného dokladu (server: `src/modules/gl/settlement.ts`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
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
  Select,
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
import { settleSaveAction, settleViewAction } from "@/app/actions";
import type { SettleView } from "@/server/journal-settle";
import type { SettleCriteria } from "@/modules/gl/settlement";

const useStyles = makeStyles({
  surface: { maxWidth: "min(1100px, 96vw)", width: "100%" },
  filters: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px 12px", alignItems: "end", marginBottom: "12px" },
  tableWrap: { maxHeight: "50vh", overflow: "auto", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  num: { textAlign: "right", whiteSpace: "nowrap" },
  sum: { display: "flex", gap: "20px", flexWrap: "wrap", marginTop: "10px", justifyContent: "flex-end" },
  amount: { width: "110px" },
});

type Pick = Record<string, string>; // transId → částka

export function SettleDialog({ lineId, open, onClose, onSaved, lang }: { lineId: string | null; open: boolean; onClose: () => void; onSaved: () => void; lang: string }) {
  const s = useStyles();
  const nf = useMemo(() => new Intl.NumberFormat(lang === "en" ? "en-GB" : "cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [lang]);
  const [view, setView] = useState<SettleView | null>(null);
  const [crit, setCrit] = useState<SettleCriteria>({ partnerOnly: true });
  const [pick, setPick] = useState<Pick>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (c: SettleCriteria) => {
      if (!lineId) return;
      setBusy(true);
      const r = await settleViewAction(lineId, c);
      setBusy(false);
      if (!r.ok) return setError(r.message);
      setError(undefined);
      setView(r.data);
      // už vybrané na řádku zůstanou vybrané
      setPick((p) => {
        const next: Pick = { ...p };
        for (const x of r.data.rows) if (x.selected && next[x.transId] === undefined) next[x.transId] = x.selected;
        return next;
      });
    },
    [lineId],
  );

  useEffect(() => {
    if (!open || !lineId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- nový dialog = nový výběr
    setPick({});
    setView(null);
    const c: SettleCriteria = { partnerOnly: true };
    setCrit(c);
    void load(c);
  }, [open, lineId, load]);

  const T = view?.texts ?? {};
  const money = (v: string | number) => nf.format(Number(v));
  const rows = view?.rows ?? [];
  const chosen = rows.filter((r) => pick[r.transId] !== undefined);
  const total = chosen.reduce((a, r) => a + Math.abs(Number(String(pick[r.transId] || r.remaining).replace(",", "."))), 0);
  const locked = !!view?.line.locked;

  const toggle = (id: string, remaining: string, on: boolean) => {
    setPick((p) => {
      const next = { ...p };
      if (!on) delete next[id];
      else {
        // zbytek řádku, nejvýš zbytek dokladu
        const lineAmt = Number(view?.line.amount ?? 0);
        const used = Object.entries(next).reduce((a, [k, v]) => a + Math.abs(Number(String(v || rows.find((x) => x.transId === k)?.remaining || 0).replace(",", "."))), 0);
        const rest = Math.abs(Number(remaining));
        const amt = lineAmt > 0 ? Math.min(rest, Math.max(0, lineAmt - used)) : rest;
        next[id] = (amt > 0 ? amt : rest).toFixed(2);
      }
      return next;
    });
  };

  const save = async (clear = false) => {
    if (!lineId) return;
    setBusy(true);
    const items = clear ? [] : chosen.map((r) => ({ kind: r.kind, transId: r.transId, amount: String(pick[r.transId] ?? "") }));
    const r = await settleSaveAction(lineId, items);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSaved();
  };

  const setC = (patch: Partial<SettleCriteria>) => setCrit((c) => ({ ...c, ...patch }));
  const hasPartner = !!view?.line.partnerKind;

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle>
            {T.SettleTitle ?? ""}
            {view && ` · ${view.line.lineNum}${view.line.partnerName ? ` · ${view.line.partnerName}` : ""}`}
          </DialogTitle>
          <DialogContent>
            {T.SettleHint && <Text size={200} block style={{ marginBottom: 10, color: tokens.colorNeutralForeground3 }}>{T.SettleHint}</Text>}
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
              {hasPartner && (
                <Field label={T.SettlePartnerOnly}>
                  <Switch checked={crit.partnerOnly !== false} onChange={(_, d) => setC({ partnerOnly: d.checked })} />
                </Field>
              )}
              {(!hasPartner || crit.partnerOnly === false) && (
                <Field label={T.SettleKind}>
                  <Select value={crit.kind ?? ""} onChange={(_, d) => setC({ kind: d.value as SettleCriteria["kind"] })}>
                    <option value="">{T.SettleAll}</option>
                    <option value="customer">{T.SettleCustomers}</option>
                    <option value="vendor">{T.SettleVendors}</option>
                  </Select>
                </Field>
              )}
              <Field label={T.Vs}>
                <Input value={crit.vs ?? ""} onChange={(_, d) => setC({ vs: d.value })} inputMode="numeric" />
              </Field>
              <Field label={T.Amount}>
                <Input value={crit.amount ?? ""} onChange={(_, d) => setC({ amount: d.value })} inputMode="decimal" />
              </Field>
              <Field label={T.SettleDateFrom}>
                <Input type="date" value={crit.dateFrom ?? ""} onChange={(_, d) => setC({ dateFrom: d.value })} />
              </Field>
              <Field label={T.SettleDateTo}>
                <Input type="date" value={crit.dateTo ?? ""} onChange={(_, d) => setC({ dateTo: d.value })} />
              </Field>
              <Field label={T.SettleSearchText}>
                <Input value={crit.text ?? ""} onChange={(_, d) => setC({ text: d.value })} />
              </Field>
              <Button type="submit" appearance="secondary" disabled={busy}>
                {T.SettleSearch}
              </Button>
            </form>
            <div className={s.tableWrap}>
              {!view ? (
                <Spinner style={{ margin: 20 }} />
              ) : !rows.length ? (
                <Text block style={{ padding: 16 }}>{T.SettleNone2}</Text>
              ) : (
                <Table size="small">
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell style={{ width: 40 }} />
                      <TableHeaderCell>{T.SettlePartner}</TableHeaderCell>
                      <TableHeaderCell>{T.SettleDoc}</TableHeaderCell>
                      <TableHeaderCell>{T.Vs}</TableHeaderCell>
                      <TableHeaderCell>{T.Date}</TableHeaderCell>
                      <TableHeaderCell>{T.SettleDue}</TableHeaderCell>
                      <TableHeaderCell className={s.num}>{T.Amount}</TableHeaderCell>
                      <TableHeaderCell className={s.num}>{T.SettleRemaining}</TableHeaderCell>
                      <TableHeaderCell className={s.num}>{T.SettlePay}</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const on = pick[r.transId] !== undefined;
                      return (
                        <TableRow key={r.transId}>
                          <TableCell>
                            <Checkbox checked={on} disabled={locked} onChange={(_, d) => toggle(r.transId, r.remaining, !!d.checked)} aria-label={r.documentNum} />
                          </TableCell>
                          <TableCell>{r.partnerName}</TableCell>
                          <TableCell>{r.documentNum}</TableCell>
                          <TableCell>{r.vs}</TableCell>
                          <TableCell>{r.date ? new Date(r.date).toLocaleDateString(lang === "en" ? "en-GB" : "cs-CZ") : ""}</TableCell>
                          <TableCell>{r.dueDate ? new Date(r.dueDate).toLocaleDateString(lang === "en" ? "en-GB" : "cs-CZ") : ""}</TableCell>
                          <TableCell className={s.num}>{money(r.amount)}</TableCell>
                          <TableCell className={s.num}>{money(r.remaining)}</TableCell>
                          <TableCell className={s.num}>
                            {on ? (
                              <Input className={s.amount} size="small" value={pick[r.transId]} disabled={locked} inputMode="decimal" onChange={(_, d) => setPick((p) => ({ ...p, [r.transId]: d.value }))} />
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
            {view && (
              <div className={s.sum}>
                <Text>
                  {T.SettleLine}: <b>{Number(view.line.amount) ? money(view.line.amount) : "—"}</b>
                </Text>
                <Text>
                  {T.SettleSelected}: <b>{money(total)}</b>
                </Text>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            {rows.some((r) => r.selected) && !locked && (
              <Button appearance="secondary" disabled={busy} onClick={() => void save(true)}>
                {T.SettleClear}
              </Button>
            )}
            <Button appearance="secondary" onClick={onClose}>
              {lang === "en" ? "Close" : "Zavřít"}
            </Button>
            <Button appearance="primary" disabled={busy || locked || !chosen.length} onClick={() => void save()}>
              {T.SettleSave}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
