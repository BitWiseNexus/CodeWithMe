import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { colorFor } from "@/lib/collab";
import { signRealtimeToken } from "@/lib/realtime-token";

/**
 * GET: a signed token for the realtime server (Socket.IO + signaling). The
 * realtime server is on another origin and can't read our session cookie, so
 * the browser fetches this and presents it when connecting. Name and colour
 * are decided here, not by the browser.
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const identity = {
    uid: user.id,
    name: (user.email?.split("@")[0] ?? "anon").slice(0, 40),
    color: colorFor(user.email ?? user.id),
  };
  return NextResponse.json(
    { token: signRealtimeToken(identity), user: identity },
    { headers: { "Cache-Control": "no-store" } }
  );
}
