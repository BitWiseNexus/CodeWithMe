/**
 * Grants (or removes) admin rights: the `admin: true` custom claim.
 *
 *   npm run set-admin -- you@example.com
 *   npm run set-admin -- you@example.com --remove
 *
 * The user must sign out and in again — the session cookie only picks up
 * claims at sign-in.
 */
import { getAuth } from "firebase-admin/auth";
import { getApps } from "firebase-admin/app";
import { getAdminDb } from "../server/firebaseAdmin";

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  const remove = args.includes("--remove");
  if (!email) {
    console.error("Usage: npm run set-admin -- <email> [--remove]");
    process.exit(1);
  }

  getAdminDb(); // initialises the Admin app from .env.local
  const auth = getAuth(getApps()[0]);
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims ?? {}) };
  if (remove) delete claims.admin;
  else claims.admin = true;
  await auth.setCustomUserClaims(user.uid, claims);

  console.log(
    `[set-admin] ${email} is ${remove ? "no longer an admin" : "now an admin"}. ` +
      "Sign out and back in for it to take effect."
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[set-admin] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
