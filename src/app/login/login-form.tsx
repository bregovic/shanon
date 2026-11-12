"use client";

import { useActionState } from "react";
import { Button, Field, Input, makeStyles, MessageBar, MessageBarBody, tokens } from "@fluentui/react-components";
import { loginAction, type FormState } from "../actions";

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

export function LoginForm({ labels }: { labels: { email: string; password: string; submit: string } }) {
  const s = useStyles();
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
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
      </form>
    </main>
  );
}
