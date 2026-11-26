"use client";

/** Moje nastavení: údaje, jazyk, heslo, PIN do pokladny, upozornění e-mailem. */
import { useEffect, useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};
import { useRouter } from "next/navigation";
import { Button, Dropdown, Switch, Field, Input, MessageBar, MessageBarBody, Option, Text, makeStyles, tokens } from "@fluentui/react-components";
import { changePasswordAction, saveProfileAction, setPosPinAction, stationClaimAction, stationDiagnosticsAction, stationRefreshAction, stationSetupAction, stationTestPageAction } from "@/app/actions";
import type { StationDiagnostics } from "@/server/station";
import { STATION_KEY, stationId } from "@/lib/station-print";
import { ActionBar, Crumbs, PageContent } from "./page";
import { InstallAppButton } from "./install-app";

const useStyles = makeStyles({
  diag: { display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" },
  diagBox: { display: "flex", flexDirection: "column", gap: "4px", padding: "10px 12px", borderRadius: tokens.borderRadiusMedium, background: tokens.colorNeutralBackground2, width: "100%", boxSizing: "border-box" },
  diagList: { display: "flex", flexDirection: "column", gap: "2px", margin: "4px 0" },
  diagRow: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "20px", maxWidth: "1100px" },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "20px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  title: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  actions: { display: "flex", justifyContent: "flex-end" },
});

type Msg = { intent: "success" | "error"; text: string } | null;

export function UserSettings(p: {
  /** profile = Můj profil (iniciály: jméno, heslo); settings = Nastavení (ozubené kolo: jazyk, firma, oznámení, PIN, aplikace) */
  section: "profile" | "settings";
  crumbs: { label: string; href?: string }[];
  user: { firstName: string; lastName: string; email: string; lang: string; hasPin: boolean; notify: Record<string, boolean>; defaultCompanyId: string };
  /** firmy, kam uživatel smí (výběr výchozí firmy) */
  companies: { id: string; label: string }[];
  /** smí zakládat zařízení (Integrace → Zařízení) — instalace tiskové stanice pro Windows */
  canDevices?: boolean;
  /** spárované počítače s tiskovou stanicí (výběr „Tento prohlížeč tiskne přes“) */
  stations?: { id: string; label: string; mine: boolean }[];
  L: Record<string, string>;
}) {
  const st = useStyles();
  const router = useRouter();
  const L = p.L;
  const [firstName, setFirstName] = useState(p.user.firstName);
  const [lastName, setLastName] = useState(p.user.lastName);
  const [lang, setLang] = useState(p.user.lang);
  const [defaultCompanyId, setDefaultCompanyId] = useState(p.user.defaultCompanyId);
  const [notify, setNotify] = useState(p.user.notify);
  const [pw, setPw] = useState({ current: "", next: "", repeat: "" });
  const [pin, setPin] = useState("");
  const [hasPin, setHasPin] = useState(p.user.hasPin);
  const [msg, setMsg] = useState<Record<string, Msg>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const isWindows = useSyncExternalStore(noSubscribe, () => /Windows/i.test(navigator.userAgent), () => false);
  const [stationBusy, setStationBusy] = useState(false);
  const [stationMsg, setStationMsg] = useState("");
  const [thisStation, setThisStation] = useState<string>("");
  // počítač tohoto prohlížeče z úložiště (vnější zdroj, až po hydrataci)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setThisStation(stationId() ?? ""), []);
  const [diag, setDiag] = useState<StationDiagnostics | null>(null);
  const [diagMsg, setDiagMsg] = useState("");
  const runDiag = async () => {
    setDiagMsg("");
    const r = await stationDiagnosticsAction(stationId()).catch(() => null);
    if (!r?.ok) return setDiagMsg(r?.message ?? "");
    setDiag(r.data);
  };
  /** Obnovit stav: stanice pošle tiskárny hned, diagnostika se za chvíli načte znovu */
  const refreshState = async (deviceId: string) => {
    setDiagMsg(L.StationDiagRefreshing);
    await stationRefreshAction(deviceId).catch(() => null);
    setTimeout(() => void runDiag().then(() => setDiagMsg("")), 4000);
  };
  const testPage = async (printerId: string) => {
    const r = await stationTestPageAction(printerId).catch(() => null);
    setDiagMsg(r?.ok ? L.StationDiagTestSent : (r?.message ?? ""));
  };
  /** výběr počítače pro tisk z tohoto prohlížeče (bez zástupce Shanon) */
  const chooseStation = async (id: string) => {
    setThisStation(id);
    try {
      if (id) localStorage.setItem(STATION_KEY, id);
      else localStorage.removeItem(STATION_KEY);
    } catch {
      /* bez úložiště */
    }
    if (id) await stationClaimAction(id).catch(() => null);
    setStationMsg(id ? L.StationChosen : "");
  };
  /** instalátor Shanon Pokladna: zařízení tohoto počítače (ze zástupce), jinak nové → stáhnout .cmd */
  const installStation = async () => {
    setStationBusy(true);
    const r = await stationSetupAction(stationId()).catch(() => null);
    setStationBusy(false);
    if (!r?.ok) return setStationMsg(r?.message ?? "");
    // tento prohlížeč je na instalovaném počítači – tisk z něj půjde na jeho tiskárny
    try {
      localStorage.setItem(STATION_KEY, r.data.deviceId);
    } catch {
      /* bez úložiště pozná počítač server podle uživatele zařízení */
    }
    setThisStation(r.data.deviceId);
    // stažení přímo z adresy (ne přes blob): Windows si zapamatuje odkud — instalátor z toho vezme párovací kód;
    // záloha: odkaz i do schránky (instalátor se podívá i tam)
    void navigator.clipboard?.writeText(new URL(r.data.href, window.location.href).href).catch(() => undefined);
    window.location.assign(r.data.href);
    setStationMsg(L.StationAppInstalled.replace("{name}", "Shanon-instalace.exe"));
  };

  const run = async (key: string, fn: () => Promise<{ ok: boolean; message?: string; errors?: Record<string, string> }>, ok: string, after?: () => void) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setErrs(r.ok ? {} : (r.errors ?? {}));
    setMsg((m) => ({ ...m, [key]: r.ok ? { intent: "success", text: ok } : { intent: "error", text: r.message ?? "" } }));
    if (r.ok) after?.();
  };

  return (
    <>
      <ActionBar>
        <Crumbs items={p.crumbs} />
      </ActionBar>
      <PageContent>
        <div className={st.grid}>
          {p.section === "profile" && (
            <section className={st.card}>
              <div className={st.title}>{L.Profile}</div>
              <Field label={L.FirstName} required validationMessage={errs.firstName}>
                <Input value={firstName} onChange={(_, d) => setFirstName(d.value)} maxLength={60} />
              </Field>
              <Field label={L.LastName} required validationMessage={errs.lastName}>
                <Input value={lastName} onChange={(_, d) => setLastName(d.value)} maxLength={60} />
              </Field>
              <Field label={L.Email}>
                <Input value={p.user.email} disabled />
              </Field>
              <Note m={msg.profile} />
              <div className={st.actions}>
                <Button
                  appearance="primary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      "profile",
                      () => saveProfileAction({ firstName, lastName, lang, notify, defaultCompanyId: defaultCompanyId || null }),
                      L.Saved,
                      () => router.refresh(),
                    )
                  }
                >
                  {L.Save}
                </Button>
              </div>
            </section>
          )}

          {p.section === "settings" && (
            <section className={st.card}>
              <div className={st.title}>{L.Preferences}</div>
              <Field label={L.Language}>
                <Dropdown value={lang === "en" ? "English" : "Čeština"} selectedOptions={[lang]} onOptionSelect={(_, d) => setLang(String(d.optionValue))}>
                  <Option value="cs">Čeština</Option>
                  <Option value="en">English</Option>
                </Dropdown>
              </Field>
              {p.companies.length > 1 && (
                <Field label={L.DefaultCompany} hint={L.DefaultCompanyHelp}>
                  <Dropdown
                    value={p.companies.find((c) => c.id === defaultCompanyId)?.label ?? L.DefaultCompanyFirst}
                    selectedOptions={[defaultCompanyId]}
                    onOptionSelect={(_, d) => setDefaultCompanyId(String(d.optionValue ?? ""))}
                  >
                    <Option value="">{L.DefaultCompanyFirst}</Option>
                    {p.companies.map((c) => (
                      <Option key={c.id} value={c.id}>
                        {c.label}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              )}
              {/* Aplikace: Windows (správce) = instalace se zástupcem a tiskem bez dialogu, jinak aplikace z prohlížeče */}
              <div className={st.title}>{L.StationApp}</div>
              <div>
                {isWindows && p.canDevices ? (
                  <Button appearance="primary" disabled={stationBusy} onClick={() => void installStation()}>
                    {L.StationAppInstall}
                  </Button>
                ) : (
                  <InstallAppButton label={L.StationAppInstall} iosText={L.InstallAppIos} installedText={L.InstallAppDone} />
                )}
              </div>
              {!!p.stations?.length && (
                <Field label={L.StationThisBrowser} hint={L.StationThisBrowserHelp}>
                  <Dropdown
                    value={p.stations.find((x) => x.id === thisStation)?.label ?? L.StationNone}
                    selectedOptions={[thisStation]}
                    onOptionSelect={(_, d) => void chooseStation(String(d.optionValue ?? ""))}
                  >
                    <Option value="">{L.StationNone}</Option>
                    {p.stations.map((x) => (
                      <Option key={x.id} value={x.id}>
                        {x.label}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              )}
              {stationMsg && <Text size={200}>{stationMsg}</Text>}
              {p.stations !== undefined && (
                <div className={st.diag}>
                  <Button size="small" onClick={() => void runDiag()}>
                    {L.StationDiag}
                  </Button>
                  {diag && (
                    <div className={st.diagBox}>
                      <Text weight="semibold">
                        {diag.source === "browser" ? L.StationDiagBrowser : diag.source === "user" ? L.StationDiagUser : L.StationDiagNone}
                      </Text>
                      {diag.staleBrowser && <Text size={200}>{L.StationDiagStale}</Text>}
                      {diag.source === "none" && diag.userDevices > 1 && <Text size={200}>{L.StationDiagMany}</Text>}
                      {diag.device && (
                        <>
                          <Text size={200}>
                            {diag.device.name}
                            {diag.device.hostName && diag.device.hostName !== diag.device.name ? ` · ${diag.device.hostName}` : ""}
                            {" · "}
                            {!diag.device.paired ? L.StationDiagUnpaired : diag.device.online ? L.StationDiagOnline : L.StationDiagOffline}
                            {diag.device.lastSeenAt ? ` (${new Date(diag.device.lastSeenAt).toLocaleString()})` : ""}
                            {diag.device.version ? ` · v${diag.device.version}` : ""}
                          </Text>
                          {diag.device.version && diag.agentVersion && diag.device.version !== diag.agentVersion && (
                            <Text size={200}>{(diag.device.version === "1.0.0" ? L.StationDiagReinstall : L.StationDiagUpdating).replace("{v}", diag.agentVersion)}</Text>
                          )}
                          {diag.device.paired && (
                            <Button size="small" appearance="subtle" onClick={() => void refreshState(diag.device!.id)}>
                              {L.StationDiagRefresh}
                            </Button>
                          )}
                          <div className={st.diagList}>
                            {diag.printers.length === 0 && <Text size={200}>{L.StationDiagNoPrinters}</Text>}
                            {diag.printers.map((x) => (
                              <div key={x.id} className={st.diagRow}>
                                <Text size={200}>
                                  {x.label}
                                  {x.printerName !== x.label ? ` (${x.printerName})` : ""} · {x.paper === "a4" ? "A4" : x.paper === "a6" ? "A6" : `${x.paper} mm`}
                                  {x.isDefault ? ` · ${L.StationDiagDefault}` : ""}
                                  {!x.present ? ` · ${L.StationDiagMissing}` : ""}
                                  {x.state ? ` · ${x.stateLabel}` : ""}
                                  {x.queued ? ` · ${L.StationDiagQueue.replace("{n}", String(x.queued))}` : ""}
                                </Text>
                                <Button size="small" appearance="subtle" disabled={!x.present} onClick={() => void testPage(x.id)}>
                                  {L.StationDiagTest}
                                </Button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      <Text size={200}>
                        {L.StationDiagReceipt}: {diag.receipt ?? L.StationDiagBrowserPrint}
                      </Text>
                      <Text size={200}>
                        {L.StationDiagDocs}: {diag.documents ?? L.StationDiagBrowserPrint}
                      </Text>
                    </div>
                  )}
                  {diagMsg && <Text size={200}>{diagMsg}</Text>}
                </div>
              )}
              <div className={st.title}>{L.Notifications}</div>
              {/* jeden přepínač: oznámení e-mailem zapnutá / vypnutá (souhrn úkolů, faktury po splatnosti, chyby napojení) */}
              <Switch
                label={L.NotifyEmail}
                checked={Object.values(notify).some(Boolean)}
                onChange={(_, d) => setNotify({ dailySummary: d.checked, overdueInvoices: d.checked, integrationErrors: d.checked })}
              />
              <Text size={200} className={st.muted}>
                {L.NotifyInfo}
              </Text>
              <Note m={msg.settings} />
              <div className={st.actions}>
                <Button
                  appearance="primary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      "settings",
                      () => saveProfileAction({ firstName, lastName, lang, notify, defaultCompanyId: defaultCompanyId || null }),
                      L.Saved,
                      () => router.refresh(),
                    )
                  }
                >
                  {L.Save}
                </Button>
              </div>
            </section>
          )}

          {p.section === "profile" && (
            <section className={st.card}>
              <div className={st.title}>{L.ChangePassword}</div>
              <Field label={L.CurrentPassword} validationMessage={errs.current}>
                <Input type="password" autoComplete="current-password" value={pw.current} onChange={(_, d) => setPw((x) => ({ ...x, current: d.value }))} />
              </Field>
              <Field label={L.NewPassword} hint={L.PasswordRules} validationMessage={errs.next}>
                <Input type="password" autoComplete="new-password" value={pw.next} onChange={(_, d) => setPw((x) => ({ ...x, next: d.value }))} />
              </Field>
              <Field label={L.RepeatPassword} validationMessage={errs.repeat}>
                <Input type="password" autoComplete="new-password" value={pw.repeat} onChange={(_, d) => setPw((x) => ({ ...x, repeat: d.value }))} />
              </Field>
              <Note m={msg.pw} />
              <div className={st.actions}>
                <Button
                  appearance="primary"
                  disabled={busy || !pw.current || !pw.next}
                  onClick={() =>
                    run(
                      "pw",
                      () => changePasswordAction(pw),
                      L.PasswordChanged,
                      () => setPw({ current: "", next: "", repeat: "" }),
                    )
                  }
                >
                  {L.ChangePassword}
                </Button>
              </div>
            </section>
          )}

          {p.section === "settings" && (
            <section className={st.card}>
              <div className={st.title}>{L.PosPin}</div>
              <Text className={st.muted}>{hasPin ? L.PosPinSet : L.PosPinNone}</Text>
              <Field label={L.PosPin} hint={L.PosPinHelp} validationMessage={errs.pin}>
                <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(_, d) => setPin(d.value.replace(/\D/g, ""))} />
              </Field>
              <Note m={msg.pin} />
              <div className={st.actions}>
                <Button
                  appearance="primary"
                  disabled={busy || !pin}
                  onClick={() =>
                    run(
                      "pin",
                      () => setPosPinAction(pin),
                      L.Saved,
                      () => (setHasPin(true), setPin("")),
                    )
                  }
                >
                  {L.Save}
                </Button>
              </div>
            </section>
          )}
        </div>
      </PageContent>
    </>
  );
}

function Note({ m }: { m: Msg | undefined }) {
  return m ? (
    <MessageBar intent={m.intent}>
      <MessageBarBody>{m.text}</MessageBarBody>
    </MessageBar>
  ) : null;
}
