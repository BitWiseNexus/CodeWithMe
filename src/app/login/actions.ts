"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string } | undefined;

function readCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/problems");
  return { email, password, redirectTo };
}

export async function signIn(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const { email, password, redirectTo } = readCredentials(formData);
  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }

  redirect(redirectTo || "/problems");
}

export async function signUp(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return { error: error.message };
  }

  // If email confirmation is enabled, there is no active session yet.
  if (!data.session) {
    return { error: "Check your email to confirm your account, then sign in." };
  }

  redirect("/problems");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
