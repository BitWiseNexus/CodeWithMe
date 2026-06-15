"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

// Editor is browser-only (Yjs / y-webrtc / Monaco), so disable SSR.
const CollaborativeEditor = dynamic(
  () => import("@/components/CollaborativeEditor").then((m) => m.CollaborativeEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-white/50">
        Loading session…
      </div>
    ),
  }
);

export function RoomClient({
  roomId,
  user,
  socketUrl,
  signalingUrl,
}: {
  roomId: string;
  user: { name: string; color: string };
  socketUrl: string;
  signalingUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-screen flex-col bg-[#1e1e1e] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <div className="flex items-center gap-4">
          <Link href="/problems" className="text-sm text-white/70 hover:text-white">
            ← Problems
          </Link>
          <span className="text-sm text-white/50">
            Room <code className="text-white/80">{roomId}</code>
          </span>
        </div>
        <button
          onClick={copyInvite}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500"
        >
          {copied ? "Copied!" : "Copy invite link"}
        </button>
      </header>

      <div className="min-h-0 flex-1">
        <CollaborativeEditor
          roomId={roomId}
          user={user}
          socketUrl={socketUrl}
          signalingUrl={signalingUrl}
        />
      </div>
    </div>
  );
}
