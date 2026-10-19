"use client";

import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { Language } from "@/lib/types";

const MONACO_LANG: Record<Language, string> = {
  python: "python",
  cpp: "cpp",
  javascript: "javascript",
};

export function CodeEditor({
  language,
  value,
  onChange,
  onRun,
  onSave,
}: {
  language: Language;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter while the editor has focus. */
  onRun?: () => void;
  /** Ctrl/Cmd+S while the editor has focus. */
  onSave?: () => void;
}) {
  // Monaco handles keys itself (Ctrl/Cmd+Enter is its "insert line below")
  // and stops them from reaching window listeners, so shortcuts that must
  // work while typing are registered inside the editor. Refs keep the
  // once-registered commands calling the latest handlers.
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onRunRef.current = onRun;
    onSaveRef.current = onSave;
  }, [onRun, onSave]);

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      onRunRef.current?.()
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      onSaveRef.current?.()
    );
  };

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={MONACO_LANG[language]}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={handleMount}
      options={{
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 4,
        automaticLayout: true,
        padding: { top: 12 },
      }}
      loading={
        <div className="flex h-full items-center justify-center text-sm text-white/50">
          Loading editor…
        </div>
      }
    />
  );
}
