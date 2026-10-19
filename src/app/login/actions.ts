"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth, SESSION_COOKIE, SESSION_MAX_AGE_MS } from "@/lib/firebase/admin";
import { safeRedirect } from "@/lib/redirect";

export type AuthState = { error: string } | undefined;

/**
 * Exchanges a freshly minted Firebase ID token (from the client SDK sign-in /
 * sign-up) for an httpOnly session cookie, then redirects.
 */
export async function createSession(
  idToken: string,
  redirectTo: string
): Promise<AuthState> {
  if (typeof idToken !== "string" || !idToken) {
    return { error: "Missing credentials." };
  }

  let authTime: number;
  try {
    ({ auth_time: authTime } = await adminAuth.verifyIdToken(idToken, true));
  } catch {
    return { error: "Could not verify your sign-in. Please try again." };
  }

  // Only create a session from a recent sign-in, per Firebase's guidance.
  if (Date.now() / 1000 - authTime > 5 * 60) {
    return { error: "Sign-in expired. Please try again." };
  }

  let sessionCookie: string;
  try {
    sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_MS,
    });
  } catch {
    return { error: "Could not start your session. Please try again." };
  }

  (await cookies()).set(SESSION_COOKIE, sessionCookie, {
    maxAge: SESSION_MAX_AGE_MS / 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  redirect(safeRedirect(redirectTo));
}

export async function signOut() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
  cookieStore.delete(SESSION_COOKIE);

  if (sessionCookie) {
    try {
      // Revoke refresh tokens so the session is invalid everywhere.
      const { uid } = await adminAuth.verifySessionCookie(sessionCookie);
      await adminAuth.revokeRefreshTokens(uid);
    } catch {
      // Cookie was already invalid — nothing to revoke.
    }
  }

  redirect("/login");
}
