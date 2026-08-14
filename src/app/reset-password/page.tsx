"use client";

import { useActionState } from "react";
import { setPasswordAction } from "./actions";

export default function ResetPasswordPage() {
  const [state, formAction, isPending] = useActionState(setPasswordAction, { error: null });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8">
        <h1 className="font-display text-2xl font-bold">Set your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a password for your NOVA POS account.
        </p>

        <form action={formAction} className="mt-6 flex flex-col gap-3">
          <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
            New password
          </label>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
            Confirm password
          </label>
          <input
            type="password"
            name="confirm"
            required
            minLength={8}
            autoComplete="new-password"
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand"
          />

          {state.error && <p className="text-sm text-red-500">{state.error}</p>}

          <button
            type="submit"
            disabled={isPending}
            className="mt-3 rounded-full bg-brand py-2.5 text-sm font-medium text-black disabled:opacity-40"
          >
            {isPending ? "Saving…" : "Set password"}
          </button>
        </form>
      </div>
    </div>
  );
}
