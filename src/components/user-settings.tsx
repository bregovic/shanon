"use client";

/** Moje nastavení: údaje, jazyk, heslo, PIN do pokladny, upozornění e-mailem. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Dropdown, Field, Input, MessageBar, MessageBarBody, Option, Text, makeStyles, tokens } from "@fluentui/react-components";
import { changePasswordAction, saveProfileAction, setPosPinAction } from "@/app/actions";
import { ActionBar, Crumbs, PageContent } from "./page";

const useStyles = makeStyles({
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
  crumbs: { label: string; href?: string }[];
  user: { firstName: string; lastName: string; email: string; lang: string; hasPin: boolean; notify: Record<string, boolean> };
  L: Record<string, string>;
}) {
  const st = useStyles();
  const router = useRouter();
  const L = p.L;
  const [firstName, setFirstName] = useState(p.user.firstName);
  const [lastName, setLastName] = useState(p.user.lastName);
  const [lang, setLang] = useState(p.user.lang);
  const [notify, setNotify] = useState(p.user.notify);
  const [pw, setPw] = useState({ current: "", next: "", repeat: "" });
  const [pin, setPin] = useState("");
  const [hasPin, setHasPin] = useState(p.user.hasPin);
  const [msg, setMsg] = useState<Record<string, Msg>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

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
            <Field label={L.Language}>
              <Dropdown value={lang === "en" ? "English" : "Čeština"} selectedOptions={[lang]} onOptionSelect={(_, d) => setLang(String(d.optionValue))}>
                <Option value="cs">Čeština</Option>
                <Option value="en">English</Option>
              </Dropdown>
            </Field>
            <div className={st.title}>{L.Notifications}</div>
            {(
              [
                ["dailySummary", L.NotifyDailySummary],
                ["overdueInvoices", L.NotifyOverdue],
                ["integrationErrors", L.NotifyIntegration],
              ] as const
            ).map(([k, label]) => (
              <Checkbox key={k} label={label} checked={!!notify[k]} onChange={(_, d) => setNotify((n) => ({ ...n, [k]: !!d.checked }))} />
            ))}
            <Text size={200} className={st.muted}>
              {L.NotifyInfo}
            </Text>
            <Note m={msg.profile} />
            <div className={st.actions}>
              <Button appearance="primary" disabled={busy} onClick={() => run("profile", () => saveProfileAction({ firstName, lastName, lang, notify }), L.Saved, () => router.refresh())}>
                {L.Save}
              </Button>
            </div>
          </section>

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
              <Button appearance="primary" disabled={busy || !pw.current || !pw.next} onClick={() => run("pw", () => changePasswordAction(pw), L.PasswordChanged, () => setPw({ current: "", next: "", repeat: "" }))}>
                {L.ChangePassword}
              </Button>
            </div>
          </section>

          <section className={st.card}>
            <div className={st.title}>{L.PosPin}</div>
            <Text className={st.muted}>{hasPin ? L.PosPinSet : L.PosPinNone}</Text>
            <Field label={L.PosPin} hint={L.PosPinHelp} validationMessage={errs.pin}>
              <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(_, d) => setPin(d.value.replace(/\D/g, ""))} />
            </Field>
            <Note m={msg.pin} />
            <div className={st.actions}>
              <Button appearance="primary" disabled={busy || !pin} onClick={() => run("pin", () => setPosPinAction(pin), L.Saved, () => (setHasPin(true), setPin("")))}>
                {L.Save}
              </Button>
            </div>
          </section>
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
