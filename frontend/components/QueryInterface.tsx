"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askAgent, type AskResponse } from "@/lib/api";

const EXAMPLE_QUESTIONS = [
  "Is Josh Allen's contract a good value for the Bills?",
  "Who are the best value QB contracts right now?",
  "What were Christian McCaffrey's stats last season?",
  "Compare Josh Allen's and Joe Burrow's contracts.",
];

export default function QueryInterface() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);

  async function submit(q: string) {
    if (!q.trim() || loading) return;
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
    <section className="border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <h2 className="font-display text-xl font-bold uppercase tracking-tight text-ink">
          Ask about a contract
        </h2>
        <p className="mt-1 text-[13px] text-ink-soft">
          Answers cite real numbers looked up from this data — nothing is invented.
        </p>
      </div>

      <div className="px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Is Josh Allen's contract a good value?"
            className="flex-1 rounded border border-border-strong bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="rounded bg-accent px-5 py-2 font-display text-[13px] font-semibold uppercase tracking-wide text-white disabled:opacity-40"
          >
            {loading ? "Thinking…" : "Ask"}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuestion(q);
                submit(q);
              }}
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
          <div className="mt-4 rounded border border-border bg-surface-sunken p-4">
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
    </section>
  );
}
