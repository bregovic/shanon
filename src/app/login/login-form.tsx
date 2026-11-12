"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "../actions";

export function LoginForm({ labels }: { labels: { email: string; password: string; submit: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4" key={JSON.stringify(state)}>
      <label className="block space-y-1">
        <span className="text-sm text-muted">{labels.email}</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={String(state.values?.email ?? "")}
          className="input"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-muted">{labels.password}</span>
        <input name="password" type="password" autoComplete="current-password" required className="input" />
      </label>
      {state.message && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.message}</p>}
      <button className="btn btn-primary w-full justify-center" disabled={pending}>
        {labels.submit}
      </button>
    </form>
  );
}
