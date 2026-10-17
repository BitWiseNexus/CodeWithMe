import "server-only";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Firebase Admin SDK for Server Components, Server Actions, Route Handlers and
 * the proxy. Admin access bypasses Firestore security rules, so every query
 * here must be scoped to the authenticated user by the caller.
 *
 * Credentials come from FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY, or fall back to GOOGLE_APPLICATION_CREDENTIALS.
 */
function initAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  return initializeApp({
    projectId,
    credential:
      projectId && clientEmail && privateKey
        ? cert({ projectId, clientEmail, privateKey })
        : applicationDefault(),
  });
}

const app = initAdminApp();

export const adminAuth = getAuth(app);
export const db = getFirestore(app);

/** httpOnly cookie holding the Firebase session cookie (a signed JWT). */
export const SESSION_COOKIE = "__session";
/** Session lifetime. Firebase allows between 5 minutes and 2 weeks. */
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
