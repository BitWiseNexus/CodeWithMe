"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { deleteProblemAction, saveProblemAction } from "@/app/admin/problems/actions";
import { validateProblemInput, type ProblemInput, type ProblemTestInput } from "@/lib/problem-input";
import { LANGUAGES, type Language } from "@/lib/types";

const field =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/20";
const mono = `${field} font-mono text-xs`;
const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60";

export const EMPTY_PROBLEM: ProblemInput = {
  slug: "",
  title: "",
  difficulty: "easy",
  description: "",
  input_format: "",
  output_format: "",
  constraints: "",
  time_limit_ms: 2000,
  comparator: "tokens",
  starter_code: {},
  tests: [{ input: "", expected: "", sample: true }],
};

/** Create (`mode="create"`) or edit an existing problem. */
export function ProblemEditor({ initial, mode }: { initial: ProblemInput; mode: "create" | "update" }) {
  const router = useRouter();
  const [form, setForm] = useState<ProblemInput>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [starterLang, setStarterLang] = useState<Language>("python");
  const [json, setJson] = useState("");
  const [saving, startSaving] = useTransition();

  const set = <K extends keyof ProblemInput>(key: K, value: ProblemInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setTest = (i: number, patch: Partial<ProblemTestInput>) =>
    set("tests", form.tests.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  function importJson() {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
      const tests = parsed.map((t: Record<string, unknown>) => ({
        input: String(t.input ?? ""),
        expected: String(t.expected ?? t.expected_output ?? ""),
        sample: t.sample === true || t.is_sample === true,
      }));
      set("tests", tests);
      setNotice(`Imported ${tests.length} tests — remember to Save.`);
      setErrors([]);
    } catch (e) {
      setErrors([`JSON import failed: ${e instanceof Error ? e.message : String(e)}`]);
    }
  }

  function save() {
    setNotice("");
    // Same validation the server runs, for instant feedback.
    const checked = validateProblemInput(form);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    startSaving(async () => {
      const res = await saveProblemAction(checked.value, mode);
      if (!res.ok) {
        setErrors(res.errors);
        return;
      }
      setErrors([]);
      if (mode === "create") {
        router.push(`/admin/problems/${res.slug}/edit`);
      } else {
        setNotice("Saved. The judge picks up changes within a minute.");
        router.refresh();
      }
    });
  }

  const samples = form.tests.filter((t) => t.sample).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label}>Title</label>
          <input className={field} value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div>
          <label className={label}>Slug (URL) {mode === "update" && "— fixed"}</label>
          <input
            className={field}
            value={form.slug}
            disabled={mode === "update"}
            placeholder="e.g. two-sum"
            onChange={(e) => set("slug", e.target.value.toLowerCase())}
          />
        </div>
        <div>
          <label className={label}>Difficulty</label>
          <select
            className={field}
            value={form.difficulty}
            onChange={(e) => set("difficulty", e.target.value as ProblemInput["difficulty"])}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Time limit (ms)</label>
            <input
              className={field}
              type="number"
              min={500}
              max={10000}
              step={100}
              value={form.time_limit_ms}
              onChange={(e) => set("time_limit_ms", Number(e.target.value))}
            />
          </div>
          <div>
            <label className={label}>Comparator</label>
            <input
              className={field}
              list="comparators"
              value={form.comparator}
              onChange={(e) => set("comparator", e.target.value as ProblemInput["comparator"])}
            />
            <datalist id="comparators">
              <option value="tokens" />
              <option value="exact" />
              <option value="float:1e-6" />
            </datalist>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className={label}>Statement (Markdown)</label>
          <button className="text-xs text-blue-600 hover:underline dark:text-blue-400" onClick={() => setPreview((p) => !p)}>
            {preview ? "Edit" : "Preview"}
          </button>
        </div>
        {preview ? (
          <div className="rounded-md bg-[#1e1e1e] p-4 text-white">
            <Markdown>{form.description || "_(empty)_"}</Markdown>
          </div>
        ) : (
          <textarea
            className={`${mono} h-48`}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(["input_format", "output_format", "constraints"] as const).map((k) => (
          <div key={k}>
            <label className={label}>{k.replace("_", " ")} (Markdown)</label>
            <textarea className={`${mono} h-28`} value={form[k]} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1 flex items-center gap-3">
          <label className={`${label} mb-0`}>Starter code</label>
          {LANGUAGES.map((l) => (
            <button
              key={l.value}
              onClick={() => setStarterLang(l.value)}
              className={`text-xs ${starterLang === l.value ? "font-semibold underline" : "text-black/50 dark:text-white/50"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <textarea
          className={`${mono} h-48`}
          placeholder="Optional. Should read the input and call a function the user fills in."
          value={form.starter_code[starterLang] ?? ""}
          onChange={(e) => set("starter_code", { ...form.starter_code, [starterLang]: e.target.value })}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className={`${label} mb-0`}>
            Tests — {samples} sample, {form.tests.length - samples} hidden
          </label>
          <button
            className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            onClick={() => set("tests", [...form.tests, { input: "", expected: "", sample: false }])}
          >
            + Add test
          </button>
        </div>
        <p className="mb-2 text-xs text-black/50 dark:text-white/50">
          Samples are shown on the problem page and run first; hidden tests are never shown.
        </p>
        <div className="space-y-3">
          {form.tests.map((t, i) => (
            <div key={i} className="rounded-md border border-black/10 p-3 dark:border-white/10">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold">Test {i + 1}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={t.sample} onChange={(e) => setTest(i, { sample: e.target.checked })} />
                    sample
                  </label>
                  <button
                    className="text-red-600 hover:underline dark:text-red-400"
                    onClick={() => set("tests", form.tests.filter((_, j) => j !== i))}
                  >
                    remove
                  </button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <textarea
                  className={`${mono} h-24`}
                  placeholder="stdin"
                  value={t.input}
                  onChange={(e) => setTest(i, { input: e.target.value })}
                />
                <textarea
                  className={`${mono} h-24`}
                  placeholder="expected output"
                  value={t.expected}
                  onChange={(e) => setTest(i, { expected: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-black/60 dark:text-white/60">Replace tests from JSON</summary>
          <textarea
            className={`${mono} mt-2 h-28`}
            placeholder='[{"input": "1 2\n", "expected": "3", "sample": true}, …]'
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          <button
            className="mt-2 rounded-md border border-black/15 px-2 py-1 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            onClick={importJson}
          >
            Import
          </button>
        </details>
      </div>

      {errors.length > 0 && (
        <ul className="list-disc rounded-md bg-red-500/10 p-3 pl-6 text-sm text-red-600 dark:text-red-400">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {notice && <p className="text-sm text-green-700 dark:text-green-400">{notice}</p>}

      <div className="flex items-center justify-between border-t border-black/10 pt-4 dark:border-white/10">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : mode === "create" ? "Create problem" : "Save changes"}
        </button>
        {mode === "update" && (
          <form
            action={deleteProblemAction.bind(null, form.slug)}
            onSubmit={(e) => {
              if (!window.confirm(`Delete "${form.title}" and all its tests? Submissions are kept.`)) e.preventDefault();
            }}
          >
            <button className="text-sm text-red-600 hover:underline dark:text-red-400">Delete problem</button>
          </form>
        )}
      </div>
    </div>
  );
}
