import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { isValidRoomId, roomChannel, type CursorPayload, type RoomUser } from "@/lib/collab";
import { execRoom, type ExecResult } from "@/lib/exec";
import { requireWorkerSecret } from "./config";
import { startSignalingServer } from "./signaling";

const SOCKET_PORT = Number(process.env.SOCKET_PORT ?? 3001);
const SIGNALING_PORT = Number(process.env.SIGNALING_PORT ?? 4444);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";
const WORKER_SECRET = requireWorkerSecret();

/** How long a finished result is kept for late `watch` calls. */
const RESULT_TTL_MS = 60_000;

const EXECUTION_ID = /^[A-Za-z0-9]{1,128}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

// --- y-webrtc signaling relay ---
startSignalingServer(SIGNALING_PORT);

// --- Socket.IO presence + cursor broadcasting ---
const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CodeWithMe realtime server\n");
});

const io = new SocketIOServer(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

async function presenceList(channel: string): Promise<RoomUser[]> {
  const sockets = await io.in(channel).fetchSockets();
  return sockets.map((s) => s.data.user as RoomUser).filter(Boolean);
}

/**
 * Recently finished results. The browser only learns an execution id after
 * the job is queued, so a fast result can arrive before its `watch` — this
 * cache lets `watch` replay it instead of losing it.
 */
const recentResults = new Map<string, ExecResult>();

function rememberResult(result: ExecResult) {
  recentResults.set(result.executionId, result);
  setTimeout(() => recentResults.delete(result.executionId), RESULT_TTL_MS).unref();
}

io.on("connection", (socket) => {
  socket.on("join", async (payload: { roomId?: unknown; user?: Partial<RoomUser> }) => {
    const roomId = payload?.roomId;
    const name = payload?.user?.name;
    const color = payload?.user?.color;
    if (!isValidRoomId(roomId)) return;
    if (typeof name !== "string" || !name.trim() || typeof color !== "string" || !COLOR.test(color)) {
      return;
    }
    if (socket.data.channel) return; // one room per connection

    // TODO(Phase 7.1): take name/color from a verified token, not the client.
    const channel = roomChannel(roomId);
    socket.data.channel = channel;
    socket.data.user = { id: socket.id, name: name.slice(0, 40), color } satisfies RoomUser;
    await socket.join(channel);

    // Send the joiner the current roster, then tell the room about everyone.
    io.to(channel).emit("presence", await presenceList(channel));
  });

  socket.on("cursor", (payload: CursorPayload) => {
    const channel = socket.data.channel as string | undefined;
    const user = socket.data.user as RoomUser | undefined;
    if (!channel || !user || typeof payload !== "object" || payload === null) return;
    // Relay to everyone else in the room (not back to sender).
    socket.to(channel).emit("cursor", {
      user,
      position: payload.position ?? null,
      selection: payload.selection ?? null,
    });
  });

  // Client subscribes to results for a specific execution it kicked off.
  socket.on("watch", (payload: { executionId?: unknown }) => {
    const executionId = payload?.executionId;
    if (typeof executionId !== "string" || !EXECUTION_ID.test(executionId)) return;
    socket.join(execRoom(executionId));

    const finished = recentResults.get(executionId);
    if (finished) socket.emit("execution:result", finished);
  });

  socket.on("disconnecting", () => {
    const channel = socket.data.channel as string | undefined;
    if (!channel) return;
    socket.to(channel).emit("peer-left", { id: socket.id });
    // Recompute presence after this socket has left (next tick).
    setTimeout(async () => {
      io.to(channel).emit("presence", await presenceList(channel));
    }, 0);
  });
});

// --- /worker namespace: the execution worker pushes results here ---
// Authenticated with a shared secret so untrusted clients can't spoof results.
const workerNsp = io.of("/worker");
workerNsp.use((socket, next) => {
  if (socket.handshake.auth?.secret === WORKER_SECRET) return next();
  next(new Error("unauthorized"));
});
workerNsp.on("connection", (socket) => {
  console.log("[socket.io] worker connected");
  socket.on("result", (result: ExecResult) => {
    if (typeof result?.executionId !== "string") return;
    rememberResult(result);
    // Relay to whoever is watching this execution.
    io.to(execRoom(result.executionId)).emit("execution:result", result);
  });
});

httpServer.listen(SOCKET_PORT, () => {
  console.log(`[socket.io] presence/cursor server on http://localhost:${SOCKET_PORT}`);
  console.log(`[cors] allowing origin ${CLIENT_ORIGIN}`);
});
