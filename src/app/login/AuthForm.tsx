"use client";

import { useActionState } from "react";
import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as signOutClient,
} from "firebase/auth";
import { getClientAuth } from "@/lib/firebase/client";
import { createSession, type AuthState } from "./actions";

const AUTH_ERRORS: Record<string, string> = {
  "auth/invalid-credential": "Invalid email or password.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/network-request-failed": "Network error. Check your connection.",
};

function authErrorMessage(e: unknown) {
  if (e instanceof FirebaseError) return AUTH_ERRORS[e.code] ?? e.message;
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * Signs in (or up) with the Firebase client SDK, then hands the ID token to
 * the server, which sets the session cookie and redirects.
 */
async function authenticate(
  mode: "signIn" | "signUp",
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/problems");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (mode === "signUp" && password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  let idToken: string;
  try {
    const auth = await getClientAuth();
    const credential =
      mode === "signIn"
        ? await signInWithEmailAndPassword(auth, email, password)
        : await createUserWithEmailAndPassword(auth, email, password);
    idToken = await credential.user.getIdToken();
    // The server session cookie is the source of truth from here on.
    await signOutClient(auth);
  } catch (e) {
    return { error: authErrorMessage(e) };
  }

  // Not inside try/catch: on success this throws Next's redirect signal.
  return createSession(idToken, redirectTo);
}

const signIn = (_prev: AuthState, formData: FormData) =>
  authenticate("signIn", formData);
const signUp = (_prev: AuthState, formData: FormData) =>
  authenticate("signUp", formData);

type ResetState = { error?: string; info?: string } | undefined;

/** Emails a password-reset link (Firebase sends it and hosts the reset page). */
async function resetPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email above, then click “Forgot password?”." };
  try {
    await sendPasswordResetEmail(await getClientAuth(), email);
  } catch (e) {
    // "user not found" is deliberately reported as success (no account probing).
    if (!(e instanceof FirebaseError && e.code === "auth/user-not-found")) {
      return { error: authErrorMessage(e) };
    }
  }
  return { info: "If an account exists for that email, a reset link is on its way. Check your inbox (and spam)." };
}

export function AuthForm({ redirectTo }: { redirectTo: string }) {
  const [signInState, signInAction, signingIn] = useActionState<
    AuthState,
    FormData
  >(signIn, undefined);
  const [signUpState, signUpAction, signingUp] = useActionState<
    AuthState,
    FormData
  >(signUp, undefined);

  const [resetState, resetAction, resetting] = useActionState<ResetState, FormData>(
    resetPassword,
    undefined
  );

  const message = signInState?.error ?? signUpState?.error ?? resetState?.error;
  const pending = signingIn || signingUp || resetting;

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
      {resetState?.info && !message && (
        <p className="text-sm text-green-600 dark:text-green-400" role="status">
          {resetState.info}
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

      <button
        type="submit"
        formAction={resetAction}
        formNoValidate // only the email is needed
        disabled={pending}
        className="self-center text-xs text-black/60 hover:underline disabled:opacity-50 dark:text-white/60"
      >
        {resetting ? "Sending…" : "Forgot password?"}
      </button>
    </form>
  );
}
