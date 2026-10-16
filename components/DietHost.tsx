"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DiscoveryItems, RequestIcon } from "@/components/DiscoveryItems";
import { X } from "@/lib/icons";
import {
  NOT_CLASSIFIED_WHY,
  fetchDietSearch,
  itemFitsDiet,
  onDietSearch,
  onItemSaved,
  setDietPlanning,
  type DietItemKind,
  type DietSearchRecord,
  type RecipeSearchStart,
} from "@/lib/diet";
import { announcePlanningChanged } from "@/lib/recipe-planning";

// The two screens a diet change adds (docs/FRONTEND_DIET_CHANGE.md), mounted once in AppShell:
//
//   1. The search's progress screen — opens when a chat reply carried `recipe_search`.
//   2. The diet-fit alert — a banner in the save feedback's style that asks, once an item is saved
//      and classified, whether it should be used in automatic planning when it doesn't fit the
//      user's strict diet.
//
// Both are driven by window events (lib/diet.ts) so the chats and the Saved tab only announce
// what happened and never import any of this.

const SEARCH_POLL_MS = 6000;
// A recipe is classified some time after the save returns; item_fits_diet says "not classified
// yet" until then. 24 x 5s = 2 minutes, after which we stop asking rather than poll forever.
const FIT_POLL_MS = 5000;
const FIT_MAX_TRIES = 24;
// The tabs' save banner: 5s on screen plus its 300ms slide-out.
const SAVE_BANNER_MS = 5300;

const NOUN: Record<DietItemKind, string> = { recipe: "recipe", side: "side", snack: "snack" };

interface FitAlert {
  key: string;
  kind: DietItemKind;
  uuid: string;
  diet: string; // lower-case label, "keto"
  why?: string;
}

export function DietHost({ userId, onRecipesChanged }: { userId: string; onRecipesChanged: () => void }) {
  return (
    <>
      <SearchProgress onRecipesChanged={onRecipesChanged} />
      <FitAlerts userId={userId} />
    </>
  );
}

// ── 1. The search's progress screen ────────────────────────────────────────────────────────

function SearchProgress({ onRecipesChanged }: { onRecipesChanged: () => void }) {
  const [search, setSearch] = useState<RecipeSearchStart | null>(null);
  const [record, setRecord] = useState<DietSearchRecord | null>(null);
  const [everLoaded, setEverLoaded] = useState(false);
  const refreshed = useRef<string | null>(null);

  // A newer search replaces the record and the screen: start over for it.
  useEffect(
    () =>
      onDietSearch((s) => {
        setSearch(s);
        setRecord(null);
        setEverLoaded(false);
      }),
    [],
  );

  // The record is only trusted once it belongs to this search or a newer one. Until the agent
  // writes the new run, memory still holds the previous search, whose "complete" would otherwise
  // end this one before it began.
  const current = search && record?.run && record.run >= search.run ? record : null;
  const status = current?.status;
  const finished = status === "complete" || status === "failed";

  const run = search?.run;
  useEffect(() => {
    if (!run || finished) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchDietSearch();
        if (!cancelled) setRecord(next);
      } catch {
        // A dropped poll is not worth surfacing: the next tick retries and the screen keeps the last good state.
      } finally {
        if (!cancelled) setEverLoaded(true);
      }
    };
    tick();
    const id = setInterval(tick, SEARCH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [run, finished]);

  // The saved recipes are in the user's recipes as usual: pick them up once, when the search ends.
  useEffect(() => {
    if (status === "complete" && current?.run && refreshed.current !== current.run) {
      refreshed.current = current.run;
      onRecipesChanged();
    }
  }, [status, current?.run, onRecipesChanged]);

  const close = useCallback(() => setSearch(null), []);

  if (!search) return null;

  const items = current?.items ?? [];
  const diet = current?.diet ?? search.diet;
  const heading =
    status === "failed"
      ? "We couldn't finish the search"
      : status === "complete"
        ? "Your new recipes are ready"
        : `Finding ${diet} recipes`;
  const subheading =
    status === "failed"
      ? "Anything we already found is saved. You can close this and ask again."
      : status === "complete"
        ? "They're saved with your recipes."
        : `Looking for ${search.target} new recipes. This takes a few minutes — you can close this and keep chatting.`;

  return (
    <div className="fixed inset-0 z-50 bg-warm overflow-y-auto flex items-start justify-center px-4 py-10" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl text-text-main tracking-tight leading-snug mb-1.5">{heading}</h1>
        <p className="text-sm text-text-muted mb-6">{subheading}</p>

        {items.length === 0 && !finished && (
          <div className="flex items-center gap-3 rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-3.5 mb-6">
            <RequestIcon state={everLoaded ? "running" : "waiting"} />
            <span className="text-sm text-text-muted">Getting started…</span>
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
          onClick={close}
          className="w-full bg-green-primary text-white rounded-xl py-3 text-sm font-medium hover:bg-green-dark transition-colors"
        >
          {finished ? "Done" : "Close and keep chatting"}
        </button>
      </div>
    </div>
  );
}

// ── 2. The diet-fit alert ──────────────────────────────────────────────────────────────────
//
// A banner like the save feedback's, but it stays until the user answers or dismisses it. Until
// they answer, the item is planned, so dismissing it costs nothing.

function FitAlerts({ userId }: { userId: string }) {
  const [queue, setQueue] = useState<FitAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // True while the tab's own "Recipe added" banner holds the same spot: this one waits for it.
  const [quiet, setQuiet] = useState(false);
  const watching = useRef(new Set<string>());
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const off = onItemSaved(({ kind, uuid }) => {
      setQuiet(true);
      if (quietTimer.current) clearTimeout(quietTimer.current);
      quietTimer.current = setTimeout(() => setQuiet(false), SAVE_BANNER_MS);

      const key = `${kind}:${uuid}`;
      if (watching.current.has(key)) return;
      watching.current.add(key);

      (async () => {
        try {
          for (let attempt = 0; attempt < FIT_MAX_TRIES && !cancelled; attempt++) {
            const fit = await itemFitsDiet(userId, kind, uuid);
            // No strict diet, or already decided: nothing to ask.
            if (!fit.ok || !fit.strict_diet) return;
            if (fit.why !== NOT_CLASSIFIED_WHY) {
              if (fit.ask && !fit.kept_in) {
                const diet = (fit.label ?? fit.strict_diet).toLowerCase();
                setQueue((q) => (q.some((a) => a.key === key) ? q : [...q, { key, kind, uuid, diet, why: fit.why }]));
              }
              return;
            }
            await new Promise((r) => setTimeout(r, FIT_POLL_MS));
          }
        } catch {
          // Silent: until the user answers the item stays planned, so a missed question costs nothing.
        } finally {
          watching.current.delete(key);
        }
      })();
    });
    return () => {
      cancelled = true;
      off();
      if (quietTimer.current) clearTimeout(quietTimer.current);
    };
  }, [userId]);

  const alert = queue[0] ?? null;
  // What the banner shows, kept after the last alert leaves so the text doesn't vanish mid-slide.
  const [view, setView] = useState<FitAlert | null>(null);
  useEffect(() => {
    if (alert) setView(alert);
  }, [alert]);
  const shown = !!alert && !quiet;

  async function answer(inPlanning: boolean) {
    if (busy || !alert) return;
    setBusy(true);
    setError(false);
    try {
      await setDietPlanning(userId, alert.kind, alert.uuid, inPlanning);
      setQueue((q) => q.filter((a) => a.key !== alert.key));
      // The Saved tab's switch shows the same rows.
      if (alert.kind === "recipe") announcePlanningChanged();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    setError(false);
    setQueue((q) => q.slice(1));
  }

  return <FitBanner view={view} shown={shown} busy={busy} error={error} onAnswer={answer} onDismiss={dismiss} />;
}

/**
 * The banner itself: the same place, motion and look as the tabs' save banner. z-40 keeps it under
 * theirs (z-50 / z-[60]), so a new save's feedback shows on top and this one is still there when it goes.
 */
export function FitBanner({ view, shown, busy, error, onAnswer, onDismiss }: {
  view: Pick<FitAlert, "kind" | "diet" | "why"> | null;
  shown: boolean;
  busy: boolean;
  error: boolean;
  onAnswer: (inPlanning: boolean) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      inert={!shown}
      role="alertdialog"
      aria-label="Diet check"
      className={`fixed bottom-4 left-4 right-4 z-40 transition-all duration-300 ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-[120%] opacity-0 pointer-events-none"}`}
    >
      {view && (
        <div className="rounded-2xl px-4 py-3 text-[13px] font-medium text-white shadow-lg bg-blue-500">
          <div className="flex items-start gap-3">
            <p className="flex-1 min-w-0 leading-snug">
              This {NOUN[view.kind]} doesn&apos;t fit your {view.diet} diet. Should it be used in automatic planning?
            </p>
            <button
              type="button"
              aria-label="Decide later"
              disabled={busy}
              onClick={onDismiss}
              className="shrink-0 -mr-1 p-0.5 text-white/80 hover:text-white transition-colors disabled:opacity-60"
            >
              <X size={16} />
            </button>
          </div>
          {/* The reason, unless it only repeats the sentence above ("not keto"). */}
          {view.why && view.why.toLowerCase() !== `not ${view.diet}` && (
            <p className="text-[12px] font-normal text-white/80 mt-0.5">{view.why}</p>
          )}
          {error && <p className="text-[12px] mt-1">Couldn&apos;t save that. Please try again.</p>}
          <div className="flex gap-2 mt-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onAnswer(true)}
              className="rounded-full bg-white text-blue-600 px-3.5 py-1.5 text-[12px] font-medium hover:bg-white/90 transition-colors disabled:opacity-60"
            >
              Yes, use it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAnswer(false)}
              className="rounded-full border border-white/70 text-white px-3.5 py-1.5 text-[12px] font-medium hover:bg-white/10 transition-colors disabled:opacity-60"
            >
              No, keep it out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
