"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input, Link, makeStyles, MessageBar, MessageBarBody, Text, Textarea, tokens } from "@fluentui/react-components";
import { loginAction, loginHelpAction, type FormState } from "../actions";

const useStyles = makeStyles({
  page: { minHeight: "100vh", display: "grid", placeItems: "center", padding: "16px", backgroundColor: tokens.colorNeutralBackground2 },
  card: {
    width: "100%",
    maxWidth: "380px",
    padding: "40px 32px 32px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow16,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  logo: { display: "block", margin: "0 auto 12px", width: "200px", height: "auto" },
});

type Labels = { email: string; password: string; submit: string; cantLogin: string; helpIntro: string; helpMessage: string; helpSend: string; helpSent: string; back: string };

export function LoginForm({ labels }: { labels: Labels }) {
  const s = useStyles();
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  const [help, setHelp] = useState(false);
  if (help) return <HelpForm labels={labels} email={String(state.values?.email ?? "")} onBack={() => setHelp(false)} />;
  return (
    <main className={s.page}>
      <form action={action} className={s.card} key={JSON.stringify(state)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Shanon" className={s.logo} />
        <Field label={labels.email} required>
          <Input name="email" type="email" autoComplete="username" defaultValue={String(state.values?.email ?? "")} />
        </Field>
        <Field label={labels.password} required>
          <Input name="password" type="password" autoComplete="current-password" />
        </Field>
        {state.message && (
          <MessageBar intent="error">
            <MessageBarBody>{state.message}</MessageBarBody>
          </MessageBar>
        )}
        <Button appearance="primary" type="submit" disabled={pending} size="large">
          {labels.submit}
        </Button>
        <Link as="button" type="button" onClick={() => setHelp(true)} style={{ alignSelf: "center" }}>
          {labels.cantLogin}
        </Link>
      </form>
    </main>
  );
}

/** „Nemůžu se přihlásit“: e-mail (+ zpráva) správci; odpověď je vždy stejná. */
function HelpForm({ labels, email, onBack }: { labels: Labels; email: string; onBack: () => void }) {
  const s = useStyles();
  const [state, action, pending] = useActionState<FormState, FormData>(loginHelpAction, {});
  const sent = state.values?.sent === "1";
  return (
    <main className={s.page}>
      <form action={action} className={s.card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Shanon" className={s.logo} />
        <Text weight="semibold" size={400}>
          {labels.cantLogin}
        </Text>
        {sent ? (
          <MessageBar intent="success">
            <MessageBarBody>{labels.helpSent}</MessageBarBody>
          </MessageBar>
        ) : (
          <>
            <Text>{labels.helpIntro}</Text>
            <Field label={labels.email} required>
              <Input name="email" type="email" autoComplete="username" defaultValue={String(state.values?.email ?? email)} />
            </Field>
            <Field label={labels.helpMessage}>
              <Textarea name="message" rows={3} maxLength={2000} />
            </Field>
            {state.message && (
              <MessageBar intent="error">
                <MessageBarBody>{state.message}</MessageBarBody>
              </MessageBar>
            )}
            <Button appearance="primary" type="submit" disabled={pending} size="large">
              {labels.helpSend}
            </Button>
          </>
        )}
        <Link as="button" type="button" onClick={onBack} style={{ alignSelf: "center" }}>
          {labels.back}
        </Link>
      </form>
    </main>
  );
}
