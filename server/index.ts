import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { startSignalingServer } from "./signaling";

const SOCKET_PORT = Number(process.env.SOCKET_PORT ?? 3001);
const SIGNALING_PORT = Number(process.env.SIGNALING_PORT ?? 4444);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";
const WORKER_SECRET = process.env.WORKER_SECRET ?? "dev-worker-secret";

// --- Types shared with the client (kept in sync with src/lib/collab.ts) ---
interface RoomUser {
  id: string; // socket id
  name: string;
  color: string;
}

interface CursorPayload {
  position: { lineNumber: number; column: number } | null;
  selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}

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

async function presenceList(roomId: string): Promise<RoomUser[]> {
  const sockets = await io.in(roomId).fetchSockets();
  return sockets.map((s) => s.data.user as RoomUser).filter(Boolean);
}

io.on("connection", (socket) => {
  socket.on(
    "join",
    async ({ roomId, user }: { roomId: string; user: Omit<RoomUser, "id"> }) => {
      socket.data.roomId = roomId;
      socket.data.user = { ...user, id: socket.id } satisfies RoomUser;
      await socket.join(roomId);

      // Send the joiner the current roster, then tell the room about everyone.
      io.to(roomId).emit("presence", await presenceList(roomId));
    }
  );

  socket.on("cursor", (payload: CursorPayload) => {
    const roomId = socket.data.roomId as string | undefined;
    const user = socket.data.user as RoomUser | undefined;
    if (!roomId || !user) return;
    // Relay to everyone else in the room (not back to sender).
    socket.to(roomId).emit("cursor", { user, ...payload });
  });

  // Client subscribes to results for a specific execution it kicked off.
  socket.on("watch", ({ executionId }: { executionId: string }) => {
    if (typeof executionId === "string") socket.join(`exec:${executionId}`);
  });

  socket.on("disconnecting", () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    socket.to(roomId).emit("peer-left", { id: socket.id });
    // Recompute presence after this socket has left (next tick).
    setTimeout(async () => {
      io.to(roomId).emit("presence", await presenceList(roomId));
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
  socket.on("result", (payload: { executionId: string }) => {
    if (!payload?.executionId) return;
    // Relay to whoever is watching this execution.
    io.to(`exec:${payload.executionId}`).emit("execution:result", payload);
  });
});

httpServer.listen(SOCKET_PORT, () => {
  console.log(`[socket.io] presence/cursor server on http://localhost:${SOCKET_PORT}`);
  console.log(`[cors] allowing origin ${CLIENT_ORIGIN}`);
});
