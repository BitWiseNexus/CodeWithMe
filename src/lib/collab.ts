export interface RoomUser {
  id: string; // socket id (assigned server-side)
  name: string;
  color: string;
}

export interface CursorPayload {
  position: { lineNumber: number; column: number } | null;
  selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}

/** Message shape broadcast by the Socket.IO server for remote cursors. */
export interface RemoteCursor extends CursorPayload {
  user: RoomUser;
}

const COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
];

/** Deterministically pick a stable color for a given seed (e.g. an email). */
export function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}
