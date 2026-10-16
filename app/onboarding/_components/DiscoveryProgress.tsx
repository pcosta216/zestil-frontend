"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DiscoveryItems, RequestIcon, type DiscoveryItem } from "@/components/DiscoveryItems";

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

        {items.length > 0 && <DiscoveryItems items={items} />}

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
