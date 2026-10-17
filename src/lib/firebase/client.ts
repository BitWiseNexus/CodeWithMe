import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, inMemoryPersistence, setPersistence, type Auth } from "firebase/auth";

/**
 * Firebase client SDK for use in Client Components ("use client"). Only used
 * to sign in and obtain an ID token; the server then exchanges it for an
 * httpOnly session cookie, which is the single source of truth for auth.
 */
export async function getClientAuth(): Promise<Auth> {
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });

  const auth = getAuth(app);
  // Don't keep a second, browser-side session around (IndexedDB) — the
  // server-side session cookie is what the app trusts.
  await setPersistence(auth, inMemoryPersistence);
  return auth;
}
