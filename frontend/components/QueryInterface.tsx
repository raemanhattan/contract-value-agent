"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askAgent, type AskResponse } from "@/lib/api";

const EXAMPLE_QUESTIONS = [
  "Best value QB contracts right now?",
  "Compare Josh Allen and Joe Burrow",
  "Christian McCaffrey's stats last season",
];

export default function QueryInterface() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);

  async function submit(q: string) {
    if (!q.trim() || loading) return;
    setQuestion(q);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await askAgent(q);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-[13px] text-ink-faint">or ask a question in plain English</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="mt-2 flex gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Who are the best-value WR contracts signed in 2025?"
          className="flex-1 rounded-md border border-border-strong bg-surface px-4 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="rounded-md bg-ink px-5 py-2.5 font-display text-[13px] font-semibold uppercase tracking-wide text-bg disabled:opacity-40"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => submit(q)}
            disabled={loading}
            className="rounded-full border border-border-strong px-3 py-1 text-[12px] text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded border border-overpay/30 bg-overpay-bg px-3 py-2 text-[13px] text-overpay">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded border border-border bg-surface-sunken p-4 text-left">
          <div className="answer-markdown text-[14px] leading-relaxed text-ink">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
          </div>

          {result.tool_calls.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <button
                onClick={() => setShowTools((v) => !v)}
                className="font-mono text-[11px] text-ink-faint hover:text-ink-soft"
              >
                {showTools ? "hide" : "show"} {result.tool_calls.length} data lookup
                {result.tool_calls.length === 1 ? "" : "s"} used
              </button>
              {showTools && (
                <div className="mt-2 space-y-2">
                  {result.tool_calls.map((tc, i) => (
                    <details key={i} className="rounded border border-border bg-surface p-2">
                      <summary className="cursor-pointer font-mono text-[12px] text-ink-soft">
                        {tc.tool}({JSON.stringify(tc.arguments)})
                      </summary>
                      <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-ink-faint">
                        {JSON.stringify(tc.result, null, 2)}
                      </pre>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
