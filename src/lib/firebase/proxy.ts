import { NextResponse, type NextRequest } from "next/server";
import { adminAuth, SESSION_COOKIE } from "@/lib/firebase/admin";

/**
 * Verifies the Firebase session cookie on every matched request and applies
 * optimistic route protection. Invoked from the root `src/proxy.ts`.
 *
 * IMPORTANT: on most routes this only checks the cookie's signature/expiry
 * locally (no network call), as recommended for proxy. Real authorization
 * (including revocation checks) still happens close to the data in
 * `requireUser()`.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  const isPublicRoute = pathname === "/" || isAuthRoute;

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  let signedIn = false;
  if (cookie) {
    try {
      // On the login page also check revocation, otherwise a revoked-but-
      // unexpired cookie would bounce between /login and /problems forever.
      await adminAuth.verifySessionCookie(cookie, isAuthRoute);
      signedIn = true;
    } catch {
      signedIn = false;
    }
  }

  let response: NextResponse;

  if (!signedIn && pathname.startsWith("/api/")) {
    // API callers (fetch) expect JSON, not the HTML of the login page.
    response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else if (!signedIn && !isPublicRoute) {
    // Unauthenticated user trying to reach a protected route -> /login
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    response = NextResponse.redirect(url);
  } else if (signedIn && isAuthRoute) {
    // Authenticated user on the login page -> /problems
    const url = request.nextUrl.clone();
    url.pathname = "/problems";
    url.search = "";
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next({ request });
  }

  // Drop a cookie that is expired, tampered with or revoked.
  if (cookie && !signedIn) response.cookies.delete(SESSION_COOKIE);

  return response;
}
