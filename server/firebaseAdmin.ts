import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Firebase Admin for standalone Node processes (worker, seed script). Mirrors
 * src/lib/firebase/admin.ts, which can't be imported here because it is
 * marked "server-only" for Next.js.
 */
export function getAdminDb() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!(projectId && clientEmail && privateKey) && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "Missing Firebase Admin credentials: set FIREBASE_PROJECT_ID, " +
        "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (or GOOGLE_APPLICATION_CREDENTIALS)"
    );
    process.exit(1);
  }

  const app =
    getApps()[0] ??
    initializeApp({
      projectId,
      credential:
        projectId && clientEmail && privateKey
          ? cert({ projectId, clientEmail, privateKey })
          : applicationDefault(),
    });

  return getFirestore(app);
}
