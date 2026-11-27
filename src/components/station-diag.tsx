"use client";

/**
 * Diagnostika tiskové stanice: pozná Shanon tento prohlížeč (nebo vybrané zařízení), běží stanice, tiskárny
 * se stavem z Windows, kam jde účtenka a ostatní doklady; Obnovit stav, Zkušební stránka. Texty dodá server.
 * Použití: Nastavení (tento počítač), detail zařízení (akce Diagnostika), seznam Zařízení (tlačítko Diagnostika tohoto počítače).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Link,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  stationConnectAction,
  stationDiagnosticsAction,
  stationPrinterAction,
  stationRefreshAction,
  stationSetupAction,
  stationTestPageAction,
} from "@/app/actions";
import type { StationDiagnostics } from "@/server/station";
import { STATION_KEY, stationId } from "@/lib/station-print";
import {
  findUsbPrinter,
  listUsbPrinters,
  usbSupported,
  usbTestPrint,
  type UsbPrinterInfo,
} from "@/lib/escpos";

const useStyles = makeStyles({
  box: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px 12px",
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground2,
    width: "100%",
    boxSizing: "border-box",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    margin: "4px 0",
  },
  row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  bad: { color: tokens.colorPaletteRedForeground1 },
  ok: { color: tokens.colorPaletteGreenForeground1 },
});

const BAD = new Set(["offline", "noPaper", "jammed", "doorOpen", "error"]);

/** prohlížeč a systém pro záznam počítače („Chrome 131 · Windows“) */
function browserLabel(): string {
  const ua = navigator.userAgent;
  const known: [string, RegExp][] = [
    ["Edge", /Edg\/(\d+)/],
    ["Opera", /OPR\/(\d+)/],
    ["Chrome", /Chrome\/(\d+)/],
    ["Firefox", /Firefox\/(\d+)/],
    ["Safari", /Version\/(\d+).*Safari/],
  ];
  const hit = known.map(([n, re]) => [n, re.exec(ua)?.[1]] as const).find(([, v]) => v);
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return [hit ? `${hit[0]} ${hit[1]}` : "", os].filter(Boolean).join(" · ");
}

/** jde si zapamatovat počítač v prohlížeči? (bez úložiště by se při každém otevření zakládal nový) */
function storageOk(): boolean {
  try {
    localStorage.setItem("shanon.test", "1");
    localStorage.removeItem("shanon.test");
    return true;
  } catch {
    return false;
  }
}

/** `deviceId` = diagnostika vybraného zařízení; bez něj počítač tohoto prohlížeče. `auto` = načíst hned. */
export function StationDiag({
  deviceId,
  auto = true,
}: {
  deviceId?: string;
  auto?: boolean;
}) {
  const s = useStyles();
  const [d, setD] = useState<StationDiagnostics | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    const r = await stationDiagnosticsAction(
      stationId(),
      deviceId ?? null,
    ).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setMsg(r?.message ?? "");
    setD(r.data);
  }, [deviceId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- načtení stavu ze serveru při otevření
    if (auto) void load();
  }, [auto, load]);
  const T = d?.texts ?? {};
  /** Připojit sdílenou tiskárnu z katalogu (stanice ji připojí ve Windows a nahlásí) */
  const connect = async (devId: string, modelId: string) => {
    const r = await stationConnectAction(devId, modelId).catch(() => null);
    if (!r?.ok) return setMsg(r?.message ?? "");
    setMsg(T.StationDiagConnectSent ?? "");
    setTimeout(() => void load(), 6000);
  };
  const refresh = async (id: string) => {
    setMsg(T.StationDiagRefreshing ?? "");
    await stationRefreshAction(id).catch(() => null);
    setTimeout(() => void load().then(() => setMsg("")), 4000);
  };
  // bez instalace: USB tiskárny připojené k tomuto počítači (WebUSB v Chrome / Edge)
  const [usbList, setUsbList] = useState<
    { info: UsbPrinterInfo; dev: Parameters<typeof usbTestPrint>[0] }[] | null
  >(null);
  const [usbMsg, setUsbMsg] = useState("");
  const usbOk = typeof navigator !== "undefined" && usbSupported();
  useEffect(() => {
    // dříve povolené USB tiskárny (bez dotazu)
    if (!deviceId && typeof navigator !== "undefined" && usbSupported())
      void listUsbPrinters().then(setUsbList);
  }, [deviceId]);
  const loadUsb = async (ask: boolean) => {
    setUsbMsg("");
    try {
      if (ask) await findUsbPrinter();
    } catch {
      /* zrušený výběr */
    }
    setUsbList(await listUsbPrinters());
  };
  const usbTest = async (x: {
    info: UsbPrinterInfo;
    dev: Parameters<typeof usbTestPrint>[0];
  }) => {
    try {
      await usbTestPrint(x.dev, "Shanon – test USB");
      setUsbMsg(T.StationDiagUsbPrinted ?? "");
    } catch (e) {
      // na Windows tiskárnu obvykle drží ovladač – tiskne se přes stanici
      setUsbMsg(`${T.StationDiagUsbBusy ?? ""} (${(e as Error).message})`);
    }
  };
  /** Používat / Uložit do katalogu: změna a nové načtení */
  const printerOp = async (
    id: string,
    op: "enable" | "disable" | "toCatalog",
  ) => {
    const r = await stationPrinterAction(id, op).catch(() => null);
    if (!r?.ok) return setMsg(r?.message ?? "");
    setMsg(r.data.message ?? T.StationDiagSaved ?? "");
    await load();
  };
  /** Přidat tento počítač: jen zařízení v Shanonu (prohlížeč si ho zapamatuje), nic se nestahuje */
  const addPc = async (browser = browserLabel()) => {
    setBusy(true);
    const r = await stationSetupAction(stationId(), false, browser).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setMsg(r?.message ?? "");
    try {
      localStorage.setItem(STATION_KEY, r.data.deviceId);
    } catch {
      /* bez úložiště pozná počítač server podle uživatele zařízení */
    }
    await load();
    setMsg(T.StationDiagAdded ?? "");
  };
  /** Stáhnout instalaci stanice pro toto zařízení (tiskárny Windows nahlásí až program na počítači) */
  const install = async (id: string) => {
    setBusy(true);
    const r = await stationSetupAction(id).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setMsg(r?.message ?? "");
    // stažení přímo z adresy (Windows si zapamatuje odkud – instalátor z toho vezme párovací kód), záloha do schránky
    void navigator.clipboard?.writeText(new URL(r.data.href, window.location.href).href).catch(() => undefined);
    window.location.assign(r.data.href);
    setMsg(T.StationDiagAddPcHint ?? "");
  };
  // diagnostika tohoto počítače: záznam se založí (Shanon počítač nezná) nebo aktualizuje (prohlížeč, čas) sám
  const autoDone = useRef(false);
  useEffect(() => {
    if (deviceId || !d || !d.canEdit || autoDone.current) return;
    autoDone.current = true;
    const browser = browserLabel();
    if (d.device) {
      void stationSetupAction(d.device.id, false, browser).then((r) => {
        if (!r?.ok) return;
        try {
          localStorage.setItem(STATION_KEY, r.data.deviceId);
        } catch {
          /* bez úložiště ho pozná server podle uživatele počítače */
        }
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- založení záznamu na serveru (vnější systém)
    } else if (d.source === "none" && storageOk()) void addPc(browser);
    // jednou po prvním načtení
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, deviceId]);
  const test = async (printerId: string) => {
    const r = await stationTestPageAction(printerId).catch(() => null);
    setMsg(r?.ok ? (T.StationDiagTestSent ?? "") : (r?.message ?? ""));
  };
  if (!d)
    return busy ? (
      <Spinner size="tiny" />
    ) : auto ? null : (
      <Button size="small" onClick={() => void load()}>
        …
      </Button>
    );
  return (
    <div className={s.box}>
      {d.source !== "device" && (
        <Text weight="semibold">
          {d.source === "browser"
            ? T.StationDiagBrowser
            : d.source === "user"
              ? T.StationDiagUser
              : T.StationDiagNone}
        </Text>
      )}
      {d.staleBrowser && <Text size={200}>{T.StationDiagStale}</Text>}
      {d.source === "none" && d.userDevices > 1 && (
        <Text size={200}>{T.StationDiagMany}</Text>
      )}
      {d.device && (
        <>
          <Text size={200}>
            <b>{d.device.name}</b>
            {d.device.hostName && d.device.hostName !== d.device.name
              ? ` · ${d.device.hostName}`
              : ""}
            {" · "}
            <span className={d.device.paired && d.device.online ? s.ok : s.bad}>
              {!d.device.paired
                ? T.StationDiagUnpaired
                : d.device.online
                  ? T.StationDiagOnline
                  : T.StationDiagOffline}
            </span>
            {d.device.lastSeenAt
              ? ` (${new Date(d.device.lastSeenAt).toLocaleString()})`
              : ""}
            {d.device.version ? ` · v${d.device.version}` : ""}
          </Text>
          {d.device.version &&
            d.agentVersion &&
            d.device.version !== d.agentVersion && (
              <Text size={200}>
                {(d.device.version === "1.0.0"
                  ? T.StationDiagReinstall
                  : (T.StationDiagUpdating ?? "")
                ).replace("{v}", d.agentVersion)}
              </Text>
            )}
          <div className={s.list}>
            {d.printers.length === 0 && (
              <Text size={200}>{T.StationDiagNoPrinters}</Text>
            )}
            {d.printers.some((x) => x.enabled) && (
              <Text size={200} weight="semibold">
                {T.StationDiagUse}
              </Text>
            )}
            {[...d.printers]
              .sort((a, b) => Number(b.enabled) - Number(a.enabled))
              .map((x, i, arr) => (
                <div key={x.id}>
                  {!x.enabled && (i === 0 || arr[i - 1].enabled) && (
                    <Text as="p" style={{ margin: "4px 0 0" }} size={200} weight="semibold">
                      {T.StationDiagFound}
                    </Text>
                  )}
                  <div className={s.row}>
                    {d.canEdit && (
                      <Checkbox
                        checked={x.enabled}
                        aria-label={T.StationDiagUse}
                        onChange={(_, v) =>
                          void printerOp(x.id, v.checked ? "enable" : "disable")
                        }
                      />
                    )}
                    <Text size={200}>
                      {x.label}
                      {x.printerName !== x.label
                        ? ` (${x.printerName})`
                        : ""} ·{" "}
                      {x.paper === "a4"
                        ? "A4"
                        : x.paper === "a6"
                          ? "A6"
                          : `${x.paper} mm`}
                      {x.isDefault ? ` · ${T.StationDiagDefault}` : ""}
                      {!x.present ? ` · ${T.StationDiagMissing}` : ""}
                      {x.state ? (
                        <>
                          {" · "}
                          <span
                            className={
                              BAD.has(x.state)
                                ? s.bad
                                : x.state === "ready"
                                  ? s.ok
                                  : undefined
                            }
                          >
                            {x.stateLabel}
                          </span>
                        </>
                      ) : null}
                      {x.queued
                        ? ` · ${(T.StationDiagQueue ?? "").replace("{n}", String(x.queued))}`
                        : ""}
                      {x.model
                        ? ` · ${(T.StationDiagInCatalog ?? "").replace("{name}", x.model)}`
                        : ""}
                    </Text>
                    <Button
                      size="small"
                      appearance="subtle"
                      disabled={!x.present || !x.enabled}
                      onClick={() => void test(x.id)}
                    >
                      {T.StationDiagTest}
                    </Button>
                    {d.canEdit && !x.model && x.enabled && (
                      <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => void printerOp(x.id, "toCatalog")}
                      >
                        {T.StationDiagToCatalog}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            {d.usbNoDriver.map((u) => (
              <div key={u.name} className={s.row}>
                <Text size={200}>
                  <b>{u.name}</b> ·{" "}
                  <span className={s.bad}>{T.StationDiagNoDriver}</span>
                  {u.model
                    ? ` · ${(T.StationDiagInCatalog ?? "").replace("{name}", u.model)}`
                    : ""}
                </Text>
                {u.driverUrl ? (
                  <Link
                    href={u.driverUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {T.StationDiagDriverLink}
                  </Link>
                ) : (
                  <Text size={200}>{T.StationDiagDriverNoLink}</Text>
                )}
              </div>
            ))}
          </div>
          {d.connectable.length > 0 && (
            <div className={s.list}>
              <Text size={200} weight="semibold">
                {T.StationDiagConnect}
              </Text>
              <Text size={200}>{T.StationDiagConnectHint}</Text>
              {d.connectable.map((m) => (
                <div key={m.id} className={s.row}>
                  <Text size={200}>
                    {m.name} · {m.path}
                    {m.queued ? ` · ${T.StationDiagConnectQueued}` : ""}
                  </Text>
                  {d.canEdit && (
                    <Button size="small" appearance="subtle" disabled={!d.device!.paired || m.queued} onClick={() => void connect(d.device!.id, m.id)}>
                      {T.StationDiagConnectBtn}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {d.device.connectResult && <Text size={200}>{d.device.connectResult}</Text>}
          {d.device.paired && (
            <div>
              <Button size="small" onClick={() => void refresh(d.device!.id)}>
                {T.StationDiagRefresh}
              </Button>
            </div>
          )}
          {!d.device.paired && d.canEdit && (
            <>
              <Text size={200}>{T.StationDiagInstallHint}</Text>
              <div>
                <Button size="small" disabled={busy} onClick={() => void install(d.device!.id)}>
                  {T.StationDiagInstall}
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {!d.device && d.source !== "device" && (
        <>
          <Text size={200}>{T.StationDiagNoAgent}</Text>
          {d.canEdit && (
            <div>
              <Button
                size="small"
                appearance="primary"
                disabled={busy}
                onClick={() => void addPc(browserLabel())}
              >
                {T.StationDiagAddPc}
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
      {d.source !== "device" && (
        <div className={s.list}>
          <Text weight="semibold">{T.StationDiagUsb}</Text>
          {!usbOk ? (
            <Text size={200}>{T.StationDiagUsbNone}</Text>
          ) : (
            <>
              <Text size={200}>{T.StationDiagUsbHint}</Text>
              <div className={s.row}>
                <Button size="small" onClick={() => void loadUsb(true)}>
                  {T.StationDiagUsbFind}
                </Button>
              </div>
              {usbList && usbList.length === 0 && (
                <Text size={200}>{T.StationDiagUsbEmpty}</Text>
              )}
              {usbList?.map((x) => (
                <div key={x.info.key} className={s.row}>
                  <Text size={200}>
                    <b>{x.info.vendor}</b> {x.info.product} · USB {x.info.ids}
                  </Text>
                  <Button
                    size="small"
                    appearance="subtle"
                    onClick={() => void usbTest(x)}
                  >
                    {T.StationDiagUsbTest}
                  </Button>
                </div>
              ))}
              {usbMsg && <Text size={200}>{usbMsg}</Text>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
