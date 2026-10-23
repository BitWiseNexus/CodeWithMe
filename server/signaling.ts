import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

/**
 * Minimal y-webrtc signaling server.
 *
 * y-webrtc peers don't send text through here — they only use this to discover
 * each other and exchange WebRTC connection offers. The protocol is a simple
 * topic-based pub/sub relay: clients subscribe to topics (room names) and any
 * `publish` message is forwarded to every *other* subscriber of that topic.
 *
 * This mirrors the reference server in `y-webrtc/bin/server.js` so we don't
 * depend on the (often-down) public signaling servers. It shares the realtime
 * server's HTTP port (one public port to deploy), on its own path, and only
 * accepts connections that carry a valid token (`?token=…`).
 */
type SignalMessage = {
  type: "subscribe" | "unsubscribe" | "publish" | "ping" | "pong";
  topics?: string[];
  topic?: string;
  [key: string]: unknown;
};

const PING_TIMEOUT = 30_000;

export function attachSignaling(
  server: Server,
  path: string,
  authorize: (token: string | null) => boolean
) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) return; // e.g. /socket.io/ — Socket.IO's upgrade
    if (!authorize(url.searchParams.get("token"))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  // topic -> set of subscribed sockets
  const topics = new Map<string, Set<WebSocket>>();

  const send = (conn: WebSocket, message: SignalMessage) => {
    if (conn.readyState === WebSocket.CONNECTING || conn.readyState === WebSocket.OPEN) {
      conn.send(JSON.stringify(message));
    }
  };

  wss.on("connection", (conn) => {
    const subscribedTopics = new Set<string>();
    let closed = false;
    let pongReceived = true;

    const pingInterval = setInterval(() => {
      if (!pongReceived) {
        conn.close();
        clearInterval(pingInterval);
      } else {
        pongReceived = false;
        try {
          conn.ping();
        } catch {
          conn.close();
        }
      }
    }, PING_TIMEOUT);

    conn.on("pong", () => {
      pongReceived = true;
    });

    conn.on("close", () => {
      subscribedTopics.forEach((topicName) => {
        const subs = topics.get(topicName);
        subs?.delete(conn);
        if (subs && subs.size === 0) topics.delete(topicName);
      });
      subscribedTopics.clear();
      closed = true;
      clearInterval(pingInterval);
    });

    conn.on("message", (data) => {
      let message: SignalMessage;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (closed || !message?.type) return;

      switch (message.type) {
        case "subscribe":
          (message.topics ?? []).forEach((topicName) => {
            if (typeof topicName !== "string") return;
            let subs = topics.get(topicName);
            if (!subs) {
              subs = new Set();
              topics.set(topicName, subs);
            }
            subs.add(conn);
            subscribedTopics.add(topicName);
          });
          break;
        case "unsubscribe":
          (message.topics ?? []).forEach((topicName) => {
            topics.get(topicName)?.delete(conn);
            subscribedTopics.delete(topicName);
          });
          break;
        case "publish":
          if (message.topic) {
            const receivers = topics.get(message.topic);
            receivers?.forEach((receiver) => {
              if (receiver !== conn) send(receiver, message);
            });
          }
          break;
        case "ping":
          send(conn, { type: "pong" });
          break;
      }
    });
  });

  return wss;
}
