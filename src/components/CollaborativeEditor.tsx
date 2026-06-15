"use client";

import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { io, type Socket } from "socket.io-client";
import type { editor as MonacoEditor, IDisposable } from "monaco-editor";
import {
  LANGUAGES,
  type Language,
} from "@/lib/types";
import type { RemoteCursor, RoomUser } from "@/lib/collab";

type Monaco = typeof import("monaco-editor");

// Holder per remote peer: a content widget for the caret/label plus a
// decorations collection for the selection highlight.
interface CursorEntry {
  widget: MonacoEditor.IContentWidget;
  position: { lineNumber: number; column: number };
  decorations: MonacoEditor.IEditorDecorationsCollection;
}

/** Inject (once) the CSS rules needed to tint a selection for a given color. */
const injectedColors = new Set<string>();
function ensureSelectionStyle(color: string) {
  const key = color.replace("#", "");
  if (injectedColors.has(key)) return `collab-sel-${key}`;
  injectedColors.add(key);
  const style = document.createElement("style");
  style.textContent = `.collab-sel-${key}{background-color:${color}33;}`;
  document.head.appendChild(style);
  return `collab-sel-${key}`;
}

export function CollaborativeEditor({
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
  const [language, setLanguage] = useState<Language>("javascript");
  const [peers, setPeers] = useState<RoomUser[]>([]);
  const [synced, setSynced] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const cursorsRef = useRef<Map<string, CursorEntry>>(new Map());
  const ymetaRef = useRef<{ set: (k: string, v: unknown) => void } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  async function handleMount(
    editor: MonacoEditor.IStandaloneCodeEditor,
    monaco: Monaco
  ) {
    // y-* packages touch browser globals, so import them only here (client).
    const Y = await import("yjs");
    const { WebrtcProvider } = await import("y-webrtc");
    const { MonacoBinding } = await import("y-monaco");

    const ydoc = new Y.Doc();
    // Namespace the WebRTC room so different deployments don't collide.
    const provider = new WebrtcProvider(`codewithme-${roomId}`, ydoc, {
      signaling: [signalingUrl],
    });
    provider.on("synced", () => setSynced(true));

    const model = editor.getModel()!;
    const ytext = ydoc.getText("monaco");
    // No awareness passed: text syncs via WebRTC, cursors via Socket.IO.
    const binding = new MonacoBinding(ytext, model, new Set([editor]));

    // --- shared language selection (rides the same Yjs doc) ---
    const ymeta = ydoc.getMap("meta");
    ymetaRef.current = { set: (k, v) => ymeta.set(k, v) };
    const applyLanguage = () => {
      const l = ymeta.get("language") as Language | undefined;
      if (l) setLanguage(l);
    };
    ymeta.observe(applyLanguage);
    if (!ymeta.get("language")) ymeta.set("language", "javascript");
    else applyLanguage();

    // --- Socket.IO: presence + cursors ---
    const socket = io(socketUrl, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("join", { roomId, user });
    });
    socket.on("presence", (list: RoomUser[]) => setPeers(list));
    socket.on("cursor", (rc: RemoteCursor) =>
      upsertRemoteCursor(editor, monaco, rc)
    );
    socket.on("peer-left", ({ id }: { id: string }) => removeRemoteCursor(id));

    // --- broadcast our cursor (throttled to ~30ms) ---
    let pending = false;
    const emitCursor = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        const pos = editor.getPosition();
        const sel = editor.getSelection();
        socket.emit("cursor", {
          position: pos
            ? { lineNumber: pos.lineNumber, column: pos.column }
            : null,
          selection: sel
            ? {
                startLineNumber: sel.startLineNumber,
                startColumn: sel.startColumn,
                endLineNumber: sel.endLineNumber,
                endColumn: sel.endColumn,
              }
            : null,
        });
      }, 30);
    };
    const disposables: IDisposable[] = [
      editor.onDidChangeCursorPosition(emitCursor),
      editor.onDidChangeCursorSelection(emitCursor),
    ];

    cleanupRef.current = () => {
      disposables.forEach((d) => d.dispose());
      cursorsRef.current.forEach((entry) => {
        editor.removeContentWidget(entry.widget);
        entry.decorations.clear();
      });
      cursorsRef.current.clear();
      socket.disconnect();
      binding.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }

  function upsertRemoteCursor(
    editor: MonacoEditor.IStandaloneCodeEditor,
    monaco: Monaco,
    rc: RemoteCursor
  ) {
    if (!rc.position) {
      removeRemoteCursor(rc.user.id);
      return;
    }
    const map = cursorsRef.current;
    let entry = map.get(rc.user.id);

    if (!entry) {
      const dom = document.createElement("div");
      dom.style.width = "2px";
      dom.style.height = "18px";
      dom.style.background = rc.user.color;
      dom.style.position = "relative";

      const label = document.createElement("div");
      label.textContent = rc.user.name;
      label.style.position = "absolute";
      label.style.top = "-16px";
      label.style.left = "0";
      label.style.whiteSpace = "nowrap";
      label.style.fontSize = "10px";
      label.style.lineHeight = "14px";
      label.style.padding = "0 4px";
      label.style.borderRadius = "3px";
      label.style.color = "#fff";
      label.style.background = rc.user.color;
      dom.appendChild(label);

      const holder: CursorEntry = {
        position: rc.position,
        decorations: editor.createDecorationsCollection(),
        widget: {
          getId: () => `collab-cursor-${rc.user.id}`,
          getDomNode: () => dom,
          getPosition: () => ({
            position: holder.position,
            preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
          }),
        },
      };
      entry = holder;
      map.set(rc.user.id, entry);
      editor.addContentWidget(entry.widget);
    }

    entry.position = rc.position;
    editor.layoutContentWidget(entry.widget);

    // Selection highlight (only when there's an actual range selected).
    const s = rc.selection;
    if (
      s &&
      !(s.startLineNumber === s.endLineNumber && s.startColumn === s.endColumn)
    ) {
      const className = ensureSelectionStyle(rc.user.color);
      entry.decorations.set([
        {
          range: new monaco.Range(
            s.startLineNumber,
            s.startColumn,
            s.endLineNumber,
            s.endColumn
          ),
          options: { className },
        },
      ]);
    } else {
      entry.decorations.clear();
    }
  }

  function removeRemoteCursor(id: string) {
    const entry = cursorsRef.current.get(id);
    if (!entry) return;
    entry.decorations.clear();
    // The widget is removed via the editor; we lost the editor ref here, but
    // clearing decorations + dropping the entry is enough — the widget is
    // also cleaned up on unmount. Hide it immediately:
    entry.widget.getDomNode().style.display = "none";
    cursorsRef.current.delete(id);
  }

  function handleLanguageChange(next: Language) {
    setLanguage(next);
    ymetaRef.current?.set("language", next);
  }

  useEffect(() => () => cleanupRef.current?.(), []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#1e1e1e] px-3 py-2">
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value as Language)}
          className="rounded-md border border-white/15 bg-[#2a2a2a] px-2 py-1 text-sm text-white outline-none"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-3">
          <span className="text-xs text-white/40">
            {synced ? "connected" : "connecting…"}
          </span>
          <div className="flex items-center -space-x-1">
            {peers.map((p) => (
              <span
                key={p.id}
                title={p.name}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#1e1e1e] text-[10px] font-bold text-white"
                style={{ background: p.color }}
              >
                {p.name.slice(0, 2).toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          theme="vs-dark"
          language={language}
          onMount={handleMount}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 12 },
          }}
          loading={
            <div className="flex h-full items-center justify-center text-sm text-white/50">
              Loading editor…
            </div>
          }
        />
      </div>
    </div>
  );
}
