import { io, type Socket } from "socket.io-client";

// Browser-side helpers for the realtime server (another origin, so it can't
// read our session cookie — connections present a token instead).

/** A fresh realtime token from /api/realtime-token (requires a session). */
export async function fetchRealtimeToken(): Promise<string> {
  const res = await fetch("/api/realtime-token", { cache: "no-store" });
  if (!res.ok) throw new Error(`realtime token: HTTP ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

/** Socket.IO connection that authenticates with a fresh token on every (re)connect. */
export function connectRealtime(url: string): Socket {
  return io(url, {
    transports: ["websocket"],
    auth: (cb) => {
      fetchRealtimeToken().then(
        (token) => cb({ token }),
        () => cb({}) // server rejects it; Socket.IO retries with backoff
      );
    },
  });
}
