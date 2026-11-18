"use client";

import { useActionState } from "react";
import { Button, Field, Input, Link, makeStyles, MessageBar, MessageBarBody, Text, tokens } from "@fluentui/react-components";
import { setPasswordAction, type FormState } from "../../actions";

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
  logo: { display: "block", margin: "0 auto 4px", width: "200px", height: "auto" },
});

export function SetPasswordForm({
  token,
  email,
  labels,
}: {
  token: string;
  email: string | null;
  labels: { title: string; account: string; password: string; password2: string; hint: string; submit: string; invalid: string; back: string };
}) {
  const s = useStyles();
  const [state, action, pending] = useActionState<FormState, FormData>(setPasswordAction, {});
  return (
    <main className={s.page}>
      <form action={action} className={s.card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Shanon" className={s.logo} />
        <Text as="h1" size={500} weight="semibold" align="center">
          {labels.title}
        </Text>
        {!email ? (
          <MessageBar intent="warning">
            <MessageBarBody>{labels.invalid}</MessageBarBody>
          </MessageBar>
        ) : (
          <>
            <Text align="center">{labels.account}</Text>
            {/* správce hesel si heslo uloží k e-mailu */}
            <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
            <input type="hidden" name="token" value={token} />
            <Field label={labels.password} required hint={labels.hint}>
              <Input name="password" type="password" autoComplete="new-password" minLength={10} />
            </Field>
            <Field label={labels.password2} required>
              <Input name="password2" type="password" autoComplete="new-password" minLength={10} />
            </Field>
            {state.message && (
              <MessageBar intent="error">
                <MessageBarBody>{state.message}</MessageBarBody>
              </MessageBar>
            )}
            <Button appearance="primary" type="submit" disabled={pending} size="large">
              {labels.submit}
            </Button>
          </>
        )}
        <Link href="/login" style={{ alignSelf: "center" }}>
          {labels.back}
        </Link>
      </form>
    </main>
  );
}
