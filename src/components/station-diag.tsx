"use client";

/**
 * Diagnostika tiskové stanice: pozná Shanon tento prohlížeč (nebo vybrané zařízení), běží stanice, tiskárny
 * se stavem z Windows, kam jde účtenka a ostatní doklady; Obnovit stav, Zkušební stránka. Texty dodá server.
 * Použití: Nastavení (tento počítač), detail zařízení (akce Diagnostika), stránka /int/diagnostika.
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { stationDiagnosticsAction, stationRefreshAction, stationTestPageAction } from "@/app/actions";
import type { StationDiagnostics } from "@/server/station";
import { stationId } from "@/lib/station-print";

const useStyles = makeStyles({
  box: { display: "flex", flexDirection: "column", gap: "4px", padding: "10px 12px", borderRadius: tokens.borderRadiusMedium, background: tokens.colorNeutralBackground2, width: "100%", boxSizing: "border-box" },
  list: { display: "flex", flexDirection: "column", gap: "2px", margin: "4px 0" },
  row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  bad: { color: tokens.colorPaletteRedForeground1 },
  ok: { color: tokens.colorPaletteGreenForeground1 },
});

const BAD = new Set(["offline", "noPaper", "jammed", "doorOpen", "error"]);

/** `deviceId` = diagnostika vybraného zařízení; bez něj počítač tohoto prohlížeče. `auto` = načíst hned. */
export function StationDiag({ deviceId, auto = true }: { deviceId?: string; auto?: boolean }) {
  const s = useStyles();
  const [d, setD] = useState<StationDiagnostics | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    const r = await stationDiagnosticsAction(stationId(), deviceId ?? null).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setMsg(r?.message ?? "");
    setD(r.data);
  }, [deviceId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- načtení stavu ze serveru při otevření
    if (auto) void load();
  }, [auto, load]);
  const T = d?.texts ?? {};
  const refresh = async (id: string) => {
    setMsg(T.StationDiagRefreshing ?? "");
    await stationRefreshAction(id).catch(() => null);
    setTimeout(() => void load().then(() => setMsg("")), 4000);
  };
  const test = async (printerId: string) => {
    const r = await stationTestPageAction(printerId).catch(() => null);
    setMsg(r?.ok ? (T.StationDiagTestSent ?? "") : (r?.message ?? ""));
  };
  if (!d) return busy ? <Spinner size="tiny" /> : auto ? null : <Button size="small" onClick={() => void load()}>…</Button>;
  return (
    <div className={s.box}>
      {d.source !== "device" && (
        <Text weight="semibold">{d.source === "browser" ? T.StationDiagBrowser : d.source === "user" ? T.StationDiagUser : T.StationDiagNone}</Text>
      )}
      {d.staleBrowser && <Text size={200}>{T.StationDiagStale}</Text>}
      {d.source === "none" && d.userDevices > 1 && <Text size={200}>{T.StationDiagMany}</Text>}
      {d.device && (
        <>
          <Text size={200}>
            <b>{d.device.name}</b>
            {d.device.hostName && d.device.hostName !== d.device.name ? ` · ${d.device.hostName}` : ""}
            {" · "}
            <span className={d.device.paired && d.device.online ? s.ok : s.bad}>{!d.device.paired ? T.StationDiagUnpaired : d.device.online ? T.StationDiagOnline : T.StationDiagOffline}</span>
            {d.device.lastSeenAt ? ` (${new Date(d.device.lastSeenAt).toLocaleString()})` : ""}
            {d.device.version ? ` · v${d.device.version}` : ""}
          </Text>
          {d.device.version && d.agentVersion && d.device.version !== d.agentVersion && (
            <Text size={200}>{(d.device.version === "1.0.0" ? T.StationDiagReinstall : T.StationDiagUpdating ?? "").replace("{v}", d.agentVersion)}</Text>
          )}
          <div className={s.list}>
            {d.printers.length === 0 && <Text size={200}>{T.StationDiagNoPrinters}</Text>}
            {d.printers.map((x) => (
              <div key={x.id} className={s.row}>
                <Text size={200}>
                  {x.label}
                  {x.printerName !== x.label ? ` (${x.printerName})` : ""} · {x.paper === "a4" ? "A4" : x.paper === "a6" ? "A6" : `${x.paper} mm`}
                  {x.isDefault ? ` · ${T.StationDiagDefault}` : ""}
                  {!x.present ? ` · ${T.StationDiagMissing}` : ""}
                  {x.state ? (
                    <>
                      {" · "}
                      <span className={BAD.has(x.state) ? s.bad : x.state === "ready" ? s.ok : undefined}>{x.stateLabel}</span>
                    </>
                  ) : null}
                  {x.queued ? ` · ${(T.StationDiagQueue ?? "").replace("{n}", String(x.queued))}` : ""}
                </Text>
                <Button size="small" appearance="subtle" disabled={!x.present} onClick={() => void test(x.id)}>
                  {T.StationDiagTest}
                </Button>
              </div>
            ))}
          </div>
          {d.device.paired && (
            <div>
              <Button size="small" onClick={() => void refresh(d.device!.id)}>
                {T.StationDiagRefresh}
              </Button>
            </div>
          )}
        </>
      )}
      <Text size={200}>
        {T.StationDiagReceipt}: {d.receipt ?? T.StationDiagBrowserPrint}
      </Text>
      <Text size={200}>
        {T.StationDiagDocs}: {d.documents ?? T.StationDiagBrowserPrint}
      </Text>
      {msg && <Text size={200}>{msg}</Text>}
    </div>
  );
}
