"use client";

import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { LANGUAGES, type Language } from "@/lib/types";

export function CodeEditor({
  language,
  value,
  onChange,
  onRun,
  onSubmit,
  onSave,
}: {
  language: Language;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter while the editor has focus. */
  onRun?: () => void;
  /** Ctrl/Cmd+Shift+Enter while the editor has focus. */
  onSubmit?: () => void;
  /** Ctrl/Cmd+S while the editor has focus. */
  onSave?: () => void;
}) {
  // Monaco handles keys itself (Ctrl/Cmd+Enter is its "insert line below")
  // and stops them from reaching window listeners, so shortcuts that must
  // work while typing are registered inside the editor. Refs keep the
  // once-registered commands calling the latest handlers.
  const onRunRef = useRef(onRun);
  const onSubmitRef = useRef(onSubmit);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onRunRef.current = onRun;
    onSubmitRef.current = onSubmit;
    onSaveRef.current = onSave;
  }, [onRun, onSubmit, onSave]);

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      onRunRef.current?.()
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () =>
      onSubmitRef.current?.()
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      onSaveRef.current?.()
    );
  };

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={LANGUAGES.find((l) => l.value === language)?.monaco ?? language}
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
