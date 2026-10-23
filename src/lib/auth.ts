import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { adminAuth, SESSION_COOKIE } from "@/lib/firebase/admin";

export interface AuthUser {
  id: string;
  email: string | null;
  /**
   * From the `admin: true` custom claim (scripts/set-admin.ts). The session
   * cookie copies claims at sign-in, so a new admin must sign in again.
   */
  isAdmin: boolean;
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
    return { id: decoded.uid, email: decoded.email ?? null, isAdmin: decoded.admin === true };
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

/**
 * Returns the user if they're an admin. Everyone else gets a 404, so admin
 * pages don't even reveal that they exist. Use in every admin page AND every
 * admin Server Action (actions are callable directly, not only from the page).
 */
export const requireAdmin = cache(async (): Promise<AuthUser> => {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
});
