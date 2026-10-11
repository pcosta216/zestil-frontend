"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, BookOpenText, Trash2 } from "@/lib/icons";
import { MacroRings } from "@/components/MacroRings";
import { UiBodyBlocks } from "@/components/UiBodyBlocks";
import { BLUE, CELL_TALL, GREY, GROUP_COLS, RED, Spinner } from "@/components/ui-style";
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
  recipeUuid?:         string;
  onDelete?:           () => void;
  stopSuggesting?:     StopSuggesting;
}

// One planned item: a 40px bar (name, pills, kcal) that expands in place on tap, the way the snack and side
// rows do. Open, it shows the macro rings and the actions: Delete, View recipe (only when there is a recipe)
// and, for a side or a snack, stop suggesting it. Each card opens and closes on its own.
export function WeekdayRecipeCard({
  title, subtitle, kcal, hasSuggestion,
  servings_value, serving_multiplier,
  recipeUuid, macros, originalMacros, isOptimised,
  onDelete, stopSuggesting,
}: Props) {
  const [open,         setOpen]         = useState(false);
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

  const cells = [
    { id: "delete", caption: "Delete", icon: <Trash2 size={14} />, tone: RED, onClick: () => { setOpen(false); onDelete?.(); } },
    ...(recipeUuid ? [{ id: "recipe", caption: "View recipe", icon: <BookOpenText size={14} />, tone: BLUE, onClick: openRecipe }] : []),
    ...(stopSuggesting ? [{ id: "stop", caption: stopSuggesting.caption, icon: stopping ? <Spinner size={14} /> : <Ban size={14} />, tone: GREY, onClick: stopSuggestingNow }] : []),
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
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen((v) => !v); }
          }}
          className="w-full h-10 pl-3 flex items-center cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-green-border"
        >
          <div className="flex-1 min-w-0 flex flex-col items-start">
            <span className="font-display text-[12px] text-text-main truncate leading-tight w-full">{title}</span>
            {subtitle && (
              <span className="text-[9px] text-text-muted leading-tight">{subtitle}</span>
            )}
          </div>

          {hasSuggestion && (
            <span className="ml-1.5 flex-shrink-0 px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded text-[9px] text-amber-600 whitespace-nowrap">
              suggestion
            </span>
          )}

          {isOptimised && (
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

          <div className="w-3 flex-shrink-0" />
        </div>

        {open && (
          <div className="mx-3 pt-2.5 pb-2.5 border-t border-[rgba(0,0,0,0.07)] flex flex-col gap-2.5">
            {displayMacros && <MacroRings macros={displayMacros} />}

            <div className={`grid gap-1.5 ${GROUP_COLS[cells.length] ?? "grid-cols-3"}`}>
              {cells.map((c) => (
                <button key={c.id} type="button" disabled={stopping} onClick={c.onClick} className={`${CELL_TALL} ${c.tone}`}>
                  {c.icon}
                  {c.caption}
                </button>
              ))}
            </div>

            {stopError && <div className="text-[11px] text-red-500">{stopError}</div>}

            {reply && (
              <div className="pt-2.5 border-t border-[rgba(0,0,0,0.07)] flex flex-col gap-2.5 text-[12px] leading-relaxed text-text-main">
                <UiBodyBlocks uiBody={reply} onChange={(update) => setReply((prev) => (prev ? update(prev) : prev))} />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
