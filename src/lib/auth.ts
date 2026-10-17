import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth, SESSION_COOKIE } from "@/lib/firebase/admin";

export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * Verifies the session cookie with Firebase (including revocation) and returns
 * the user, or null. Cached per render pass so multiple calls don't re-hit
 * Firebase.
 */
export const getUser = cache(async (): Promise<AuthUser | null> => {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(cookie, true);
    return { id: decoded.uid, email: decoded.email ?? null };
  } catch {
    return null;
  }
});

/** Returns the authenticated user, or redirects to /login if there is none. */
export const requireUser = cache(async (): Promise<AuthUser> => {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
});
