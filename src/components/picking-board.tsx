"use client";

/**
 * Vychystávání objednávek e-shopu (tablet u pultu): den vyzvednutí, objednávky nebo souhrn stejných položek napříč
 * objednávkami (krájení, příprava najednou), skutečné množství z váhy / ručně, Chybí, Dokončit = faktura podle skutečnosti.
 */
import { useRef, useState, useTransition } from "react";
import { Badge, Button, Input, makeStyles, MessageBar, MessageBarBody, Tab, TabList, tokens } from "@fluentui/react-components";
import { ArrowClockwise24Regular, CheckmarkCircle24Regular, Dismiss16Regular, PlugConnected24Regular, Scales24Regular } from "@fluentui/react-icons";
import { pickBoardAction, pickCompleteAction, pickSetAction } from "@/app/actions";
import type { PickBoard, PickRow } from "@/modules/shop/picking";
import type { PickingLabels } from "@/server/ui";
import { connectScalePort, readScale, readScaleSim, scalePort, type ScaleConfig, type ScaleReading } from "@/lib/scale";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";

const useStyles = makeStyles({
  days: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" },
  grid: { display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))" },
  card: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusLarge, background: tokens.colorNeutralBackground1, padding: "12px 14px" },
  head: { display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap", marginBottom: "6px" },
  title: { fontWeight: 600, fontSize: "16px" },
  sub: { color: tokens.colorNeutralForeground3, fontSize: "13px" },
  note: { background: tokens.colorPaletteYellowBackground1, padding: "4px 8px", borderRadius: tokens.borderRadiusMedium, fontSize: "13px", margin: "4px 0" },
  row: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "4px 8px", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${tokens.colorNeutralStroke3}` },
  name: { fontWeight: 600 },
  qtys: { color: tokens.colorNeutralForeground3, fontSize: "13px" },
  ctl: { display: "flex", gap: "6px", alignItems: "center", gridColumn: "1 / -1" },
  qty: { width: "110px" },
  over: { color: tokens.colorPaletteRedForeground1, fontSize: "13px" },
  foot: { display: "flex", justifyContent: "flex-end", marginTop: "10px" },
});

const num = (v: string | null) => (v === null ? "" : Number(v).toLocaleString("cs-CZ", { maximumFractionDigits: 3 }));
const dayLabel = (d: string | null, none: string) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }) : none;

export function PickingBoard({
  crumbs,
  initial,
  scale,
  labels: L,
}: {
  crumbs: { label: string; href?: string }[];
  initial: PickBoard;
  scale: ({ driver: string } & ScaleConfig) | null;
  labels: PickingLabels;
}) {
  const st = useStyles();
  const [board, setBoard] = useState(initial);
  const [view, setView] = useState<"orders" | "items">("orders");
  const [msg, setMsg] = useState<{ intent: "error" | "warning" | "success"; text: string } | null>(null);
  const [busy, start] = useTransition();
  const [weighing, setWeighing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const loop = useRef(0);

  const reload = (date = board.date) =>
    start(async () => {
      const r = await pickBoardAction(date ?? "none");
      if (r.ok) setBoard(r.data);
      else setMsg({ intent: "error", text: r.message });
    });

  const save = (p: PickRow, qty: string | null, missing = false) =>
    start(async () => {
      const r = await pickSetAction(p.id, qty, missing);
      if (!r.ok) return setMsg({ intent: "error", text: r.message });
      setMsg(r.data.warnings.length ? { intent: "warning", text: r.data.warnings.join(" ") } : null);
      setDraft((d) => {
        const n = { ...d };
        delete n[p.id];
        return n;
      });
      const b = await pickBoardAction(board.date ?? "none");
      if (b.ok) setBoard(b.data);
    });

  const complete = (orderId: string) =>
    start(async () => {
      const r = await pickCompleteAction(orderId);
      if (!r.ok) return setMsg({ intent: "error", text: r.message });
      setMsg({ intent: r.data.warnings.length ? "warning" : "success", text: [r.data.message, ...r.data.warnings].join(" ") });
      const b = await pickBoardAction(board.date ?? "none");
      if (b.ok) setBoard(b.data);
    });

  /** Zvážit: čte váhu, dokud se hmotnost neustálí (nejvýš ~8 s), a uloží ji. */
  const weigh = async (p: PickRow) => {
    if (!scale) return;
    const my = ++loop.current;
    setWeighing(p.id);
    const sim = scale.driver === "scaleSim";
    const port = sim ? null : await scalePort();
    if (!sim && !port) {
      setWeighing(null);
      return setMsg({ intent: "error", text: L.connectScale });
    }
    for (let i = 0; i < 20; i++) {
      if (loop.current !== my) return;
      let r: ScaleReading;
      try {
        r = sim ? await readScaleSim(i) : await readScale(port as Parameters<typeof readScale>[0], scale);
      } catch (e) {
        setWeighing(null);
        return setMsg({ intent: "error", text: String((e as Error).message ?? e) });
      }
      if (r.stable && r.kg !== null && r.kg > 0) {
        setWeighing(null);
        return save(p, String(Math.round(r.kg * 1000) / 1000));
      }
      await new Promise((res) => setTimeout(res, 400));
    }
    setWeighing(null);
    setMsg({ intent: "warning", text: L.scaleNotStable });
  };

  const row = (p: PickRow, label: string, sub?: string) => {
    const over = p.status === "picked" && Number(p.pickedQty) > Number(p.maxQty) + 1e-9;
    const value = draft[p.id] ?? (p.status === "picked" ? num(p.pickedQty) : "");
    return (
      <div key={p.id} className={st.row}>
        <div>
          <div className={st.name}>
            {label}{" "}
            <Badge appearance="tint" color={p.status === "picked" ? "success" : p.status === "missing" ? "danger" : "warning"} size="small">
              {p.status === "picked" ? L.status.picked : p.status === "missing" ? L.status.missingS : L.status.pending}
            </Badge>
          </div>
          <div className={st.qtys}>
            {sub ? `${sub} · ` : ""}
            {L.ordered} {num(p.orderedQty)} {p.unit}
            {p.weighed ? ` · ${L.max} ${num(p.maxQty)} ${p.unit}` : ""}
          </div>
          {over && <div className={st.over}>{L.max} {num(p.maxQty)} {p.unit}</div>}
        </div>
        <div />
        <div className={st.ctl}>
          <Input
            className={st.qty}
            inputMode="decimal"
            aria-label={L.actual}
            placeholder={L.actual}
            value={value}
            disabled={busy || p.status === "missing"}
            contentAfter={p.unit}
            onChange={(_, d) => setDraft((x) => ({ ...x, [p.id]: d.value }))}
            onKeyDown={(e) => e.key === "Enter" && draft[p.id] !== undefined && save(p, draft[p.id])}
            onBlur={() => draft[p.id] !== undefined && save(p, draft[p.id])}
          />
          {scale && p.weighed && p.status !== "missing" && (
            <Button icon={<Scales24Regular />} disabled={busy || !!weighing} onClick={() => void weigh(p)}>
              {weighing === p.id ? "…" : L.weigh}
            </Button>
          )}
          {p.status === "pending" ? (
            <Button appearance="subtle" icon={<Dismiss16Regular />} disabled={busy} onClick={() => save(p, null, true)}>
              {L.missing}
            </Button>
          ) : (
            <Button appearance="subtle" disabled={busy} onClick={() => save(p, null)}>
              {L.undo}
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
        <Spacer />
        {scale && scale.driver !== "scaleSim" && (
          <Button icon={<PlugConnected24Regular />} onClick={() => void connectScalePort()}>
            {L.connectScale}
          </Button>
        )}
        <Button appearance="subtle" icon={<ArrowClockwise24Regular />} disabled={busy} onClick={() => reload()}>
          {L.refresh}
        </Button>
      </ActionBar>
      <PageContent>
        {msg && (
          <MessageBar intent={msg.intent} style={{ marginBottom: 10 }}>
            <MessageBarBody>{msg.text}</MessageBarBody>
          </MessageBar>
        )}
        <div className={st.days}>
          {board.days.map((d) => (
            <Button key={d.date ?? "none"} appearance={d.date === board.date ? "primary" : "secondary"} onClick={() => reload(d.date ?? "none")}>
              {dayLabel(d.date, L.noDate)} ({d.count})
            </Button>
          ))}
        </div>
        <TabList selectedValue={view} onTabSelect={(_, d) => setView(d.value as "orders" | "items")} style={{ marginBottom: 10 }}>
          <Tab value="orders">
            {L.byOrder} ({board.orders.length})
          </Tab>
          <Tab value="items">
            {L.byItem} ({board.items.length})
          </Tab>
        </TabList>
        {!board.orders.length && <p>{L.none}</p>}
        {view === "orders" ? (
          <div className={st.grid}>
            {board.orders.map((o) => (
              <section key={o.id} className={st.card}>
                <div className={st.head}>
                  <span className={st.title}>{o.orderNum}</span>
                  <span>{o.buyerName}</span>
                  {o.pickupHour !== null && <Badge appearance="outline">{o.pickupHour}:00</Badge>}
                  <span className={st.sub}>
                    {[o.phone, o.payment].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {o.note && <div className={st.note}>{o.note}</div>}
                {o.picks.map((p) => row(p, p.name))}
                <div className={st.foot}>
                  <Button appearance="primary" icon={<CheckmarkCircle24Regular />} disabled={busy || o.picks.some((p) => p.status === "pending")} onClick={() => complete(o.id)}>
                    {L.complete}
                  </Button>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className={st.grid}>
            {board.items.map((it) => {
              const buyer = new Map(board.orders.map((o) => [o.id, `${o.buyerName}${o.pickupHour !== null ? ` · ${o.pickupHour}:00` : ""}`]));
              return (
                <section key={it.key} className={st.card}>
                  <div className={st.head}>
                    <span className={st.title}>{it.name}</span>
                    <span className={st.sub}>
                      {L.total} {num(it.ordered)} {it.unit} · {L.inOrders.replace("{n}", String(it.rows.length))}
                      {Number(it.picked) > 0 ? ` · ${L.actual.toLowerCase()} ${num(it.picked)} ${it.unit}` : ""}
                    </span>
                  </div>
                  {it.rows.map((p) => row(p, p.orderNum, buyer.get(p.shopOrderId)))}
                </section>
              );
            })}
          </div>
        )}
      </PageContent>
    </>
  );
}
