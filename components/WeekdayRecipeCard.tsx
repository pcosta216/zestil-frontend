"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, BookOpenText, Info, Trash2 } from "@/lib/icons";
import { MacroRings } from "@/components/MacroRings";
import { UiBodyBlocks } from "@/components/UiBodyBlocks";
import { ORANGE, Spinner } from "@/components/ui-style";
import { ServingInfo } from "./serving_info";
import { RecipeDetailHero } from "./RecipeDetailHero";
import { callEdge } from "@/lib/edge-call";
import type { StopSuggesting } from "@/lib/stop-suggesting";
import type { UiBody } from "@/lib/ui-body";
import type { RecipeCollection } from "@/lib/supabase/queries";

interface MacroSet {
  kcal:    number;
  protein: number;
  carbs:   number;
  fat:     number;
  sugar:   number;
  sodium:  number;
}

interface Props {
  title:               string;
  subtitle?:           string;
  kcal?:               number;
  macros?:             MacroSet;
  originalMacros?:     MacroSet;
  isOptimised?:        boolean;
  servings_value?:     number;
  serving_multiplier?: number;
  hasSuggestion?:      boolean;
  notes?:              string | null;
  recipeUuid?:         string;
  onDelete?:           () => void;
  stopSuggesting?:     StopSuggesting;
}

// One planned item: a 40px bar (name, pills, kcal). Tapping it slides the action buttons in at the right end
// of the bar: Info (shows the macro rings and the notes beneath), View recipe (when there is a recipe), stop suggesting
// (for a side or a snack) and Delete, always last so it stays at the same right edge. Each card opens and
// closes on its own.
export function WeekdayRecipeCard({
  title, subtitle, kcal, hasSuggestion, notes,
  servings_value, serving_multiplier,
  recipeUuid, macros, originalMacros, isOptimised,
  onDelete, stopSuggesting,
}: Props) {
  const [open,         setOpen]         = useState(false);
  const [showRings,    setShowRings]    = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [overlayOpen,  setOverlayOpen]  = useState(false);
  const [recipe,       setRecipe]       = useState<RecipeCollection | null>(null);
  const [recipeState,  setRecipeState]  = useState<"idle" | "loading" | "error">("idle");
  const [stopping,     setStopping]     = useState(false);
  const [stopError,    setStopError]    = useState<string | null>(null);
  const [reply,        setReply]        = useState<UiBody | null>(null);

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const displayMacros = (isOptimised && showOriginal && originalMacros) ? originalMacros : macros;
  const displayKcal   = displayMacros?.kcal ?? kcal;
  const noteText      = notes?.trim() || null;

  // The recipe is fetched when View recipe is tapped, not when the card appears: a day plan used to fetch
  // every card's recipe up front just to have it ready.
  function openRecipe() {
    setOverlayOpen(true);
    if (recipe || recipeState === "loading" || !recipeUuid) return;
    setRecipeState("loading");
    fetch(`/api/recipe/${recipeUuid}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (alive.current) { setRecipe(data); setRecipeState("idle"); } })
      .catch(() => { if (alive.current) setRecipeState("error"); });
  }

  async function stopSuggestingNow() {
    if (!stopSuggesting || stopping) return;
    setStopping(true);
    setStopError(null);
    try {
      const { uiBody } = await callEdge(stopSuggesting.action);
      if (!uiBody) throw new Error("empty reply");
      setReply(uiBody);
    } catch {
      setStopError("Something went wrong. Please try again.");
    } finally {
      if (alive.current) setStopping(false);
    }
  }

  const BTN_RED  = "bg-red-500 hover:bg-red-600";
  const BTN_BLUE = "bg-[#23BCFD] hover:bg-[#0ea5d6]";
  const BTN_GREEN = "bg-green-primary hover:bg-green-dark";
  const BTN_GREY = "bg-gray-400 hover:bg-gray-500";

  // Closing the bar also hides the rings, so the next tap opens it as it was first.
  function toggleOpen() { setOpen((v) => !v); setShowRings(false); }

  const cells = [
    ...(displayMacros || noteText ? [{ id: "info", caption: showRings ? "Hide details" : "Show details", icon: <Info size={15} />, tone: BTN_BLUE, onClick: () => setShowRings((v) => !v) }] : []),
    ...(recipeUuid ? [{ id: "recipe", caption: "View recipe", icon: <BookOpenText size={15} />, tone: BTN_GREEN, onClick: openRecipe }] : []),
    ...(stopSuggesting ? [{ id: "stop", caption: stopSuggesting.caption, icon: stopping ? <Spinner size={15} /> : <Ban size={15} />, tone: BTN_GREY, onClick: stopSuggestingNow }] : []),
    { id: "delete", caption: "Remove from plan", icon: <Trash2 size={15} />, tone: BTN_RED, onClick: () => { setOpen(false); setShowRings(false); onDelete?.(); } },
  ];

  return (
    <>
      {overlayOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-warm overflow-hidden">
          <header className="flex items-center justify-between px-5 py-4 border-b border-[rgba(0,0,0,0.07)] flex-shrink-0 bg-warm">
            <button
              onClick={() => setOverlayOpen(false)}
              className="text-sm text-text-muted flex items-center gap-1 hover:text-text-main transition-colors"
            >
              ← Back
            </button>
            <span className="font-display text-base text-text-main">Recipe</span>
            <div className="w-16" />
          </header>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {recipeState === "loading" && (
              <div className="flex items-center justify-center py-20 text-text-muted text-sm">Loading…</div>
            )}
            {recipeState === "error" && (
              <div className="flex items-center justify-center py-20 text-text-muted text-sm">Couldn&apos;t load the recipe.</div>
            )}
            {recipe && <RecipeDetailHero recipe={recipe} asOverlay />}
          </div>
        </div>
      )}

      <div className="w-full bg-white border border-[rgba(0,0,0,0.07)] rounded-lg hover:border-green-border transition-colors overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={toggleOpen}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleOpen(); }
          }}
          className="w-full h-10 pl-3 flex items-center cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-green-border"
        >
          <div className="flex-1 min-w-0 flex flex-col items-start">
            <span className="font-display text-[12px] text-text-main truncate leading-tight w-full">{title}</span>
            {subtitle && (
              <span className="text-[9px] text-text-muted leading-tight">{subtitle}</span>
            )}
          </div>

          {hasSuggestion && !open && (
            <span className="ml-1.5 flex-shrink-0 px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded text-[9px] text-amber-600 whitespace-nowrap">
              suggestion
            </span>
          )}

          {isOptimised && !open && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowOriginal((v) => !v); }}
              className={`ml-1.5 flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] whitespace-nowrap border transition-colors ${
                showOriginal
                  ? "bg-white border-[rgba(0,0,0,0.1)] text-text-muted"
                  : "bg-green-light border-green-border text-green-primary"
              }`}
            >
              {showOriginal ? "original" : "✦ optimised"}
            </button>
          )}

          {serving_multiplier != null && servings_value != null && (
            <span className="ml-1.0 flex-shrink-0">
              <ServingInfo servingMultiplier={serving_multiplier} servingsValue={servings_value} />
            </span>
          )}

          {displayKcal != null && (
            <span className="ml-1.5 flex-shrink-0 w-14 px-2 py-[3px] bg-green-light rounded-full text-[10px] text-green-primary whitespace-nowrap">
              {Math.round(displayKcal)} kcal
            </span>
          )}

          <div
            className="flex h-full flex-shrink-0 overflow-hidden transition-[max-width] duration-200"
            style={{ maxWidth: open ? 6 + 32 * cells.length : 0 }}
          >
            <div className="w-1.5 flex-shrink-0" />
            {cells.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={c.caption}
                title={c.caption}
                tabIndex={open ? 0 : -1}
                disabled={stopping}
                onClick={(e) => { e.stopPropagation(); c.onClick(); }}
                className={`h-full w-8 flex items-center justify-center text-white transition-colors disabled:opacity-60 ${c.tone}`}
              >
                {c.icon}
              </button>
            ))}
          </div>

          <div className={`flex-shrink-0 transition-[width] duration-200 ${open ? "w-0" : "w-3"}`} />
        </div>

        {open && (showRings || stopError || reply) && (
          <div className="mx-3 pt-2.5 pb-2.5 border-t border-[rgba(0,0,0,0.07)] flex flex-col gap-2.5">
            {showRings && displayMacros && <MacroRings macros={displayMacros} />}

            {showRings && noteText && (
              <p className="text-[10px] font-medium text-text-muted whitespace-pre-wrap break-words">{noteText}</p>
            )}

            {stopError && <div className="text-[11px] text-red-500">{stopError}</div>}

            {reply && (
              <div className="pt-2.5 border-t border-[rgba(0,0,0,0.07)] flex flex-col gap-2.5 text-[12px] leading-relaxed text-text-main">
                <UiBodyBlocks uiBody={reply} onChange={(update) => setReply((prev) => (prev ? update(prev) : prev))} dismiss={{ caption: "OK", onClick: () => setReply(null) }} buttonTone={ORANGE} />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
