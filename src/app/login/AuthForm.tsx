"use client";

import { useActionState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

export function AuthForm({ redirectTo }: { redirectTo: string }) {
  const [signInState, signInAction, signingIn] = useActionState<
    AuthState,
    FormData
  >(signIn, undefined);
  const [signUpState, signUpAction, signingUp] = useActionState<
    AuthState,
    FormData
  >(signUp, undefined);

  const message = signInState?.error ?? signUpState?.error;
  const pending = signingIn || signingUp;

  return (
    <form className="flex flex-col gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          // Some browser extensions (e.g. Temp Mail) inject attributes onto
          // email inputs before hydration; ignore the resulting mismatch.
          suppressHydrationWarning
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-blue-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-blue-500"
        />
      </label>

      {message && (
        <p className="text-sm text-red-500" role="alert">
          {message}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          formAction={signInAction}
          disabled={pending}
          className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {signingIn ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="submit"
          formAction={signUpAction}
          disabled={pending}
          className="flex-1 rounded-md border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
        >
          {signingUp ? "Creating…" : "Sign up"}
        </button>
      </div>
    </form>
  );
}
