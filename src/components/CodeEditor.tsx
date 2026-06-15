"use client";

import Editor from "@monaco-editor/react";
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
}: {
  language: Language;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={MONACO_LANG[language]}
      value={value}
      onChange={(v) => onChange(v ?? "")}
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
