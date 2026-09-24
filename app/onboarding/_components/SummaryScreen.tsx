"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { PrimaryButton, Prompt, ScreenShell, SmallButton, type NodeScreenProps } from "./shared";

// n_summary — the recap of everything onboarding captured, written by the Onboarding Summary
// Agent rather than assembled client-side. The whole screen body is the markdown that comes
// back from POST /api/onboarding/summary (which proxies the Edge Function); nothing here reads
// memory, so the agent alone decides which sections appear and in what order.
//
// The node's `prompt` content row is deliberately NOT rendered: the document supplies its own
// `## ` headings, and a second heading above them reads as a duplicate.
//
// Continue is never blocked on the summary. This is the last screen before n_compile commits
// the profile, so a failing recap must not be able to strand someone one tap from finishing —
// every failure path leaves the CTA live and offers a retry alongside it.
export function SummaryScreen({ showBack, submitting, onAnswer, onBack }: NodeScreenProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [attempt, setAttempt] = useState(0);

  // One generation per attempt, and it survives React StrictMode's dev-mode double-invoke.
  // The obvious shapes both fail here: an `inFlight` ref makes the second invoke bail while the
  // first invoke's result is already discarded by its own cleanup (the screen then sits on the
  // skeleton forever — observed, not theorised), and no guard at all bills two LLM calls per
  // mount. Caching the PROMISE per attempt gives both invocations the same result to subscribe
  // to, so exactly one request goes out and whichever subscriber is still live renders it.
  const pending = useRef<Promise<{ markdown: string } | { failed: true }> | null>(null);
  const startedFor = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (startedFor.current !== attempt) {
      startedFor.current = attempt;
      pending.current = loadSummary();
    }
    setLoading(true);
    setFailed(false);
    pending.current!.then((result) => {
      if (cancelled) return;
      if ("markdown" in result) setMarkdown(result.markdown);
      else setFailed(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text="Here's what we've got" />

      <div className="rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-3.5 mb-6 min-h-[8rem]">
        {loading && <SummarySkeleton />}

        {/* .chat-markdown (globals.css) is the app's one tuned markdown style — headings, list
            markers, tight spacing. Shared rather than duplicated; it isn't chat-specific. */}
        {!loading && markdown && (
          <div className="chat-markdown">
            <Markdown remarkPlugins={[remarkBreaks]}>{markdown}</Markdown>
          </div>
        )}

        {!loading && failed && (
          <div className="flex flex-col items-start gap-2.5">
            <p className="text-sm text-text-muted leading-relaxed">
              We couldn&apos;t put your recap together just now. Everything you told us is saved — you can carry on.
            </p>
            <SmallButton onClick={() => setAttempt((n) => n + 1)}>Try again</SmallButton>
          </div>
        )}
      </div>

      <PrimaryButton onClick={() => onAnswer({})} loading={submitting}>
        Let&apos;s start planning
      </PrimaryButton>
    </ScreenShell>
  );
}

/** Never rejects — the caller subscribes to this promise twice and treats both outcomes alike. */
async function loadSummary(): Promise<{ markdown: string } | { failed: true }> {
  try {
    const res = await fetch("/api/onboarding/summary", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || typeof data?.summary_markdown !== "string") return { failed: true };
    return { markdown: data.summary_markdown };
  } catch {
    return { failed: true };
  }
}

// Placeholder lines rather than a spinner: this wait is seconds long and ends in a block of
// text, so showing its shape is less jarring than swapping a spinner for a full document.
function SummarySkeleton() {
  return (
    <div className="animate-pulse space-y-2.5" aria-label="Loading your summary">
      <div className="h-3 w-2/5 rounded bg-black/10" />
      <div className="h-2.5 w-full rounded bg-black/[0.06]" />
      <div className="h-2.5 w-4/5 rounded bg-black/[0.06]" />
      <div className="h-3 w-1/3 rounded bg-black/10 mt-4" />
      <div className="h-2.5 w-full rounded bg-black/[0.06]" />
      <div className="h-2.5 w-3/5 rounded bg-black/[0.06]" />
    </div>
  );
}
