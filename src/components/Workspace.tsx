"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import { saveCode } from "@/app/problems/[slug]/actions";
import { LANGUAGES, STARTER_CODE, type Language } from "@/lib/types";

type SavedCode = Partial<Record<Language, string>>;

export function Workspace({
  problemId,
  initialLanguage,
  savedCode,
}: {
  problemId: string;
  initialLanguage: Language;
  /** Previously saved code keyed by language (from the DB). */
  savedCode: SavedCode;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  // Per-language buffer so switching languages doesn't lose work.
  const [buffers, setBuffers] = useState<Record<Language, string>>(() => ({
    python: savedCode.python ?? STARTER_CODE.python,
    cpp: savedCode.cpp ?? STARTER_CODE.cpp,
    javascript: savedCode.javascript ?? STARTER_CODE.javascript,
  }));

  const [status, setStatus] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const dirtyRef = useRef(false);

  const code = buffers[language];

  const handleChange = useCallback(
    (value: string) => {
      dirtyRef.current = true;
      setBuffers((prev) => ({ ...prev, [language]: value }));
      setStatus("Unsaved changes");
    },
    [language]
  );

  const handleSave = useCallback(() => {
    startTransition(async () => {
      const result = await saveCode({ problemId, language, code });
      if (result.ok) {
        dirtyRef.current = false;
        setStatus(`Saved ${new Date(result.savedAt).toLocaleTimeString()}`);
      } else {
        setStatus(`Error: ${result.error}`);
      }
    });
  }, [problemId, language, code]);

  // Ctrl/Cmd+S to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#1e1e1e] px-3 py-2">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          className="rounded-md border border-white/15 bg-[#2a2a2a] px-2 py-1 text-sm text-white outline-none"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-3">
          <span className="text-xs text-white/50">{status}</span>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <CodeEditor language={language} value={code} onChange={handleChange} />
      </div>
    </div>
  );
}
