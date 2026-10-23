import { createServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import {
  SIGNALING_PATH,
  isValidRoomId,
  roomChannel,
  type CursorPayload,
  type RoomUser,
} from "@/lib/collab";
import { execRoom, type ExecResult } from "@/lib/exec";
import type { SubmissionResult } from "@/lib/judge";
import { realtimeSecret, verifyRealtimeToken, type RealtimeIdentity } from "@/lib/realtime-token";
import { requireWorkerSecret } from "./config";
import { attachSignaling } from "./signaling";

const SOCKET_PORT = Number(process.env.SOCKET_PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";
const WORKER_SECRET = requireWorkerSecret();
const REALTIME_SECRET = (() => {
  try {
    return realtimeSecret();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
})();

/** How long a finished result is kept for late `watch` calls. */
const RESULT_TTL_MS = 60_000;

const JOB_ID = /^[A-Za-z0-9]{1,128}$/;

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CodeWithMe realtime server\n");
});

// --- y-webrtc signaling: same port, own path, token required ---
attachSignaling(httpServer, SIGNALING_PATH, (token) => !!verifyRealtimeToken(token, REALTIME_SECRET));

// --- Socket.IO: presence, cursors, run results and verdicts ---
const io = new SocketIOServer(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
  // Leave other upgrade paths (signaling) alone instead of closing them.
  destroyUpgrade: false,
});

/** Who this socket is — from its verified token. */
const identityOf = (socket: Socket) => socket.data.identity as RealtimeIdentity;

// Every browser connection must present a token from /api/realtime-token.
io.use((socket, next) => {
  const identity = verifyRealtimeToken(socket.handshake.auth?.token, REALTIME_SECRET);
  if (!identity) return next(new Error("unauthorized"));
  socket.data.identity = identity;
  next();
});

async function presenceList(channel: string): Promise<RoomUser[]> {
  const sockets = await io.in(channel).fetchSockets();
  return sockets.map((s) => s.data.user as RoomUser).filter(Boolean);
}

/**
 * Recently finished results (runs and submissions), with their owner. The
 * browser only learns a job id after the job is queued, so a fast result can
 * arrive before its `watch` — this cache lets `watch` replay it.
 */
const recentResults = new Map<string, { event: string; payload: unknown; ownerId: string }>();

/** Sends a finished job's result to its owner's watching sockets only. */
async function deliver(jobId: string, event: string, payload: unknown, ownerId: string) {
  recentResults.set(jobId, { event, payload, ownerId });
  setTimeout(() => recentResults.delete(jobId), RESULT_TTL_MS).unref();
  for (const s of await io.in(execRoom(jobId)).fetchSockets()) {
    if ((s.data.identity as RealtimeIdentity | undefined)?.uid === ownerId) s.emit(event, payload);
  }
}

io.on("connection", (socket) => {
  socket.on("join", async (payload: { roomId?: unknown }) => {
    const roomId = payload?.roomId;
    if (!isValidRoomId(roomId) || socket.data.channel) return; // one room per connection

    // Name and colour come from the verified token, never from the client.
    const { name, color } = identityOf(socket);
    const channel = roomChannel(roomId);
    socket.data.channel = channel;
    socket.data.user = { id: socket.id, name, color } satisfies RoomUser;
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

  // Subscribe to the result of a run or submission. Anyone may watch an id,
  // but results only go to the job's owner (see `deliver`).
  // (The field is called executionId for both; it's just the job id.)
  socket.on("watch", (payload: { executionId?: unknown }) => {
    const jobId = payload?.executionId;
    if (typeof jobId !== "string" || !JOB_ID.test(jobId)) return;
    socket.join(execRoom(jobId));

    const finished = recentResults.get(jobId);
    if (finished && finished.ownerId === identityOf(socket).uid) {
      socket.emit(finished.event, finished.payload);
    }
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
  socket.on("result", (result: ExecResult, ownerId: unknown) => {
    if (typeof result?.executionId !== "string" || typeof ownerId !== "string") return;
    void deliver(result.executionId, "execution:result", result, ownerId);
  });
  socket.on("submission", (result: SubmissionResult, ownerId: unknown) => {
    if (typeof result?.submissionId !== "string" || typeof ownerId !== "string") return;
    void deliver(result.submissionId, "submission:result", result, ownerId);
  });
});

httpServer.listen(SOCKET_PORT, () => {
  console.log(`[realtime] Socket.IO on http://localhost:${SOCKET_PORT}, signaling on ws://localhost:${SOCKET_PORT}${SIGNALING_PATH}`);
  console.log(`[cors] allowing origin ${CLIENT_ORIGIN}`);
});
