"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, X } from "@/lib/icons";

// The last onboarding screen. Replaces the old "You're all set" panel, which handed the user a
// "Go to my plan" button straight into an empty plan — recipe discovery is still running at that
// point, and takes minutes.
//
// Everything here is READ. memory_json.onboarding is written solely by the backend discovery
// job; this polls it and reports. See app/api/onboarding/discovery/route.ts.

const POLL_MS = 10000;
const AUTO_CONTINUE_MS = 15000; // after completion, not from mount
/**
 * Consecutive polls with NO change before a way out is offered — see `stalled` below.
 *
 * 18 x 10s = 3 minutes. Sized off the real cadence rather than guessed: the longest gap measured
 * between two writes within a run is 92s (three runs, 20 writes), so this is ~2x the worst
 * healthy silence. Too low and a slow request offers an escape into the empty plan this screen
 * exists to prevent; too high and a dead job strands someone at the end of onboarding.
 */
const IDLE_POLLS_BEFORE_ESCAPE = 18;

/** One recipe the job kept for a request. */
interface DiscoveryRecipe {
  uuid?: string;
  title?: string;
  saved?: boolean;
}

/** One request the job searched for. Every field but `name` can be absent mid-run. */
interface DiscoveryItem {
  name?: string;
  type?: string; // "fill" marks the top-up bucket ("More recipes for you")
  status?: string;
  error?: string; // only on a failure, e.g. "Explore failed: The operation was aborted due to timeout"
  found?: number;
  saved?: number;
  accepted?: number;
  rejected?: number;
  recipes?: DiscoveryRecipe[];
}

interface OnboardingBlock {
  status?: { time?: string; current?: string }[];
  recipe_discovery?: DiscoveryItem[];
  recipe_discovery_run?: string;
}

/**
 * The newest entry in `status`, which is an append-only log rather than a single value.
 * Sorted by `time` rather than trusting array order — an out-of-order append would otherwise
 * show a finished run as still running, or worse, the reverse.
 */
function currentStatus(block: OnboardingBlock | null): string | undefined {
  const entries = (block?.status ?? []).filter((s) => typeof s?.current === "string");
  if (entries.length === 0) return undefined;
  return [...entries].sort((a, b) => String(a.time ?? "").localeCompare(String(b.time ?? ""))).at(-1)?.current;
}

/**
 * Normalised per-request state.
 *
 * Only "complete" and "failed" have been observed live; "in progress" and "waiting" come from
 * the spec and are unverified, so case and separators are normalised before matching rather
 * than the exact strings being trusted. An unrecognised value reads as waiting — the neutral
 * state, never a false green tick.
 */
type RequestState = "complete" | "failed" | "running" | "waiting";
function requestState(status: string | undefined): RequestState {
  const s = String(status ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (s === "complete" || s === "completed") return "complete";
  if (s === "failed" || s === "fail" || s === "error") return "failed";
  if (s === "inprogress" || s === "running" || s === "started") return "running";
  return "waiting";
}

/**
 * The leading marker on a REQUEST row ("pasta carbonara", "risotto").
 *
 * A completed request gets no mark of its own: what it produced is the recipes listed beneath
 * it, and each of those carries its own tick. Marking both would say "done" twice and make a
 * request that completed with nothing look identical to one that found two dishes. The slot is
 * still rendered so every row's name starts at the same x.
 */
function RequestIcon({ state }: { state: RequestState }) {
  if (state === "failed") {
    return (
      <span className="shrink-0 w-5 h-5 rounded-full bg-red-600 flex items-center justify-center" aria-label="failed">
        <X size={13} strokeWidth={3} className="text-white" />
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="shrink-0 w-5 h-5 flex items-center justify-center" aria-label="in progress">
        <LoaderCircle size={18} className="text-green-primary animate-spin" />
      </span>
    );
  }
  if (state === "waiting") {
    return (
      <span className="shrink-0 w-5 h-5 flex items-center justify-center" aria-label="waiting">
        <span className="w-2.5 h-2.5 rounded-full border-2 border-[rgba(0,0,0,0.18)]" />
      </span>
    );
  }
  return <span className="shrink-0 w-5 h-5" aria-hidden="true" />;
}

/** "17 found · 2 saved" — only the parts the job has actually reported. */
function countLine(item: DiscoveryItem): string | null {
  const parts: string[] = [];
  if (typeof item.found === "number") parts.push(`${item.found} found`);
  const saved = item.saved ?? item.accepted;
  if (typeof saved === "number") parts.push(`${saved} saved`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function DiscoveryProgress({ onContinue }: { onContinue: () => void }) {
  const [block, setBlock] = useState<OnboardingBlock | null>(null);
  const [everLoaded, setEverLoaded] = useState(false);
  // Consecutive polls that told us nothing new — a failed request counts, since an expired
  // session or a 500ing route is exactly as stuck as a dead job, and silently retrying forever
  // is the one outcome with no way out.
  const [idlePolls, setIdlePolls] = useState(0);
  const lastSeen = useRef<string | null>(null);
  const inFlight = useRef(false);
  const done = useRef(false); // set the moment we navigate, so no timer fires after

  const status = currentStatus(block);
  const isComplete = status === "recipe_discovery_complete";
  const isFailed = status === "recipe_discovery_failed";
  const finished = isComplete || isFailed;

  const items = block?.recipe_discovery ?? [];
  const stalled = idlePolls >= IDLE_POLLS_BEFORE_ESCAPE;

  const go = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onContinue();
  }, [onContinue]);

  // --- poll ---------------------------------------------------------------------------------
  // One interval, cleared on unmount and as soon as the run finishes. The in-flight guard keeps
  // a slow response from stacking requests behind it; React StrictMode's double-invoke is
  // handled by the cleanup, and a duplicated GET is harmless anyway (this route only reads).
  useEffect(() => {
    if (finished) return;
    let cancelled = false;

    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/onboarding/discovery");
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setIdlePolls((n) => n + 1);
          return;
        }
        const next = (data?.onboarding as OnboardingBlock) ?? null;
        // Compared against the whole block, not just the item count: a run that is working its
        // way through a request updates counts and appends recipes without the list growing.
        const seen = JSON.stringify(next);
        setIdlePolls((n) => (seen === lastSeen.current ? n + 1 : 0));
        lastSeen.current = seen;
        setBlock(next);
      } catch {
        // A dropped poll is not worth surfacing — the next tick retries, and the screen is
        // already showing the last good state. It still counts as silence.
        if (!cancelled) setIdlePolls((n) => n + 1);
      } finally {
        inFlight.current = false;
        if (!cancelled) setEverLoaded(true);
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [finished]);

  // --- auto-continue ------------------------------------------------------------------------
  // Starts from COMPLETION, not from mount, so the countdown is 15s of the finished screen
  // rather than 15s of a run that takes minutes.
  useEffect(() => {
    if (!isComplete) return;
    const id = setTimeout(go, AUTO_CONTINUE_MS);
    return () => clearTimeout(id);
  }, [isComplete, go]);

  const heading = isFailed
    ? "We couldn't finish setting up your recipes"
    : isComplete
      ? "Your recipes are ready"
      : "Finding recipes you'll like";

  const subheading = isFailed
    ? "Your profile is saved. You can head to your plan — we'll keep trying in the background."
    : isComplete
      ? "Here's what we found. Taking you to your plan in a moment…"
      : "This takes a few minutes. You can watch it happen, or wait for the button below.";

  return (
    <div className="min-h-screen bg-warm flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl text-text-main tracking-tight leading-snug mb-1.5">{heading}</h1>
        <p className="text-sm text-text-muted mb-6">{subheading}</p>

        {/* Gated on `!finished` too: a run that fails before writing a single request still
            reaches this branch, and a spinner reading "Getting started…" under "We couldn't
            finish setting up your recipes" contradicts itself. */}
        {items.length === 0 && !finished && (
          <div className="flex items-center gap-3 rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-3.5 mb-6">
            <RequestIcon state={everLoaded ? "running" : "waiting"} />
            <span className="text-sm text-text-muted">
              {stalled ? "Still waiting on the kitchen…" : "Getting started…"}
            </span>
          </div>
        )}

        {items.length === 0 && finished && (
          <p className="text-sm text-text-muted rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-3.5 mb-6">
            No recipes were saved this time.
          </p>
        )}

        {items.length > 0 && (
          <ul className="flex flex-col gap-2 mb-6">
            {items.map((item, i) => {
              const state = requestState(item.status);
              const counts = countLine(item);
              const recipes = (item.recipes ?? []).filter((r) => typeof r.title === "string" && r.title.length > 0);
              return (
                <li
                  key={`${item.name ?? "request"}:${i}`}
                  className="rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-3"
                >
                  {/* The request the job was given — a header for the recipes it produced. */}
                  <div className="flex items-center gap-3">
                    <RequestIcon state={state} />
                    <span className="text-sm text-text-main flex-1 min-w-0 truncate">{item.name ?? "Recipes"}</span>
                    {counts && <span className="text-[11px] text-text-muted shrink-0">{counts}</span>}
                  </div>

                  {/* What matched it. The tick is trailing and belongs to the RECIPE: it marks
                      this dish as found and saved, which is the thing that actually happened. */}
                  {recipes.length > 0 && (
                    <ul className="mt-2 pl-8 flex flex-col gap-1.5">
                      {recipes.map((recipe, r) => (
                        <li key={recipe.uuid ?? `${recipe.title}:${r}`} className="flex items-start gap-2">
                          <span className="text-xs text-text-muted leading-snug flex-1 min-w-0">{recipe.title}</span>
                          {recipe.saved === true && (
                            <span
                              className="shrink-0 w-4 h-4 mt-px rounded-full bg-green-primary flex items-center justify-center"
                              aria-label="saved"
                            >
                              <Check size={10} strokeWidth={3} className="text-white" />
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* The job's own words when it failed — far more use than copy we invent. */}
                  {state === "failed" && (
                    <p className="mt-1.5 pl-8 text-xs text-text-muted leading-snug">
                      {item.error ?? "Nothing usable came back for this one."}
                    </p>
                  )}

                  {/* Completed, but nothing matched. Without this the row is a bare name and
                      reads as still-pending. */}
                  {state === "complete" && recipes.length === 0 && (
                    <p className="mt-1.5 pl-8 text-xs text-text-muted">No matches saved for this one.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={go}
          disabled={!finished}
          className="w-full bg-green-primary text-white rounded-xl py-3 text-sm font-medium hover:bg-green-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to plan
        </button>

        {!finished && stalled && (
          <button
            type="button"
            onClick={go}
            className="w-full text-center text-sm text-text-muted hover:text-text-main transition-colors py-2.5 mt-2"
          >
            Continue without waiting
          </button>
        )}
      </div>
    </div>
  );
}
