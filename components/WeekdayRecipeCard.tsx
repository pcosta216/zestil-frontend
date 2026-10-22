"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, BookOpenText, Calendar, CalendarOff, Info, Trash2 } from "@/lib/icons";
import { MacroRings } from "@/components/MacroRings";
import { UiBodyBlocks } from "@/components/UiBodyBlocks";
import { ORANGE, Spinner } from "@/components/ui-style";
import { RecipeDetailHero } from "./RecipeDetailHero";
import { loadRecipeById, recipeFromSnapshot } from "@/lib/recipe-snapshot";
import { callEdge } from "@/lib/edge-call";
import { announcePlanningChanged, loadRecipePlanState, planningMessage, rememberAutoPlan, setRecipePlanning } from "@/lib/recipe-planning";
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
  hasSuggestion?:      boolean;
  notes?:              string | null;
  recipeUuid?:         string;
  onDelete?:           () => void;
  stopSuggesting?:     StopSuggesting;
  // A recipe entry can be taken out of (and put back into) automatic planning, as on the recipe page.
  canToggleAutoPlanning?: boolean;
  // The entry's snapshot (the card's `metadata`): View recipe shows it at once, before asking whether the recipe is the user's.
  snapshot?:           Record<string, any> | null;
  onRecipeSaved?:      () => void;
  onFeedback?:         (b: { type: "success" | "error"; message: string }) => void;
}

// One planned item: a 40px bar (name, pills, kcal). Tapping it slides the action buttons in at the right end
// of the bar: Info (shows the macro rings and the notes beneath), View recipe (when there is a recipe), stop
// suggesting (for a side or a snack), stop auto planning (for a recipe) and Delete, always last so it stays
// at the same right edge. Each card opens and closes on its own.
export function WeekdayRecipeCard({
  title, subtitle, kcal, hasSuggestion, notes,
  recipeUuid, macros, originalMacros, isOptimised,
  onDelete, stopSuggesting, canToggleAutoPlanning, onFeedback, snapshot, onRecipeSaved,
}: Props) {
  const [open,         setOpen]         = useState(false);
  const [showRings,    setShowRings]    = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [overlayOpen,  setOverlayOpen]  = useState(false);
  const [recipe,       setRecipe]       = useState<RecipeCollection | null>(null);
  const [recipeState,  setRecipeState]  = useState<"idle" | "loading" | "error" | "gone">("idle");
  // Whether the recipe is one of the user's, once the lookup answered (null: not yet). A recipe saved from the
  // overlay is also the user's, from then on.
  const [recipeIsMine, setRecipeIsMine] = useState<boolean | null>(null);
  const [savedHere,    setSavedHere]    = useState(false);
  const recipeLookup = useRef(false);
  const [stopping,     setStopping]     = useState(false);
  const [stopError,    setStopError]    = useState<string | null>(null);
  const [reply,        setReply]        = useState<UiBody | null>(null);
  // The recipe's automatic-planning state, read when the card is first opened (null: not known yet, taken as on).
  const [planOn,       setPlanOn]       = useState<boolean | null>(null);
  const [planWhy,      setPlanWhy]      = useState<string | null>(null);
  const [planBusy,     setPlanBusy]     = useState(false);
  const planRead = useRef(false);

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const displayMacros = (isOptimised && showOriginal && originalMacros) ? originalMacros : macros;
  const displayKcal   = displayMacros?.kcal ?? kcal;
  const noteText      = notes?.trim() || null;

  // View recipe opens the recipe the entry's snapshot names (`recipe_uuid`, UI_BODY_CONTRACT §5.11): a recipe
  // entry, or a snack or side that is a recipe. Read when tapped, never when the card appears:
  // - the user's recipes (`/api/recipe/{id}`): a hit is the live recipe with its collections, and that's all;
  // - otherwise the recipe itself, by its id (`loadRecipeById`), whether or not the user has it. A snack or
  //   side carries only the id, so this read starts at once. A recipe entry's snapshot is the whole recipe and
  //   shows at once, and the read is made only once the user's recipes said no, to tell whether the recipe
  //   still exists: then the page offers Save.
  // A recipe that no longer exists gets the entry's name and macros and says so.
  function openRecipe() {
    setOverlayOpen(true);
    if (recipeLookup.current || !recipeUuid) return;
    recipeLookup.current = true;
    const uuid = recipeUuid;
    const fromSnapshot = recipeFromSnapshot(snapshot, title, uuid);
    if (fromSnapshot) setRecipe(fromSnapshot);
    else setRecipeState("loading");
    const readById = () => loadRecipeById(uuid, title).catch(() => undefined); // undefined: the read failed
    const byIdEarly = fromSnapshot ? null : readById();
    fetch(`/api/recipe/${uuid}`)
      // undefined: the read failed, so whether it is the user's is not known.
      .then(async (res): Promise<RecipeCollection | null | undefined> => (res.ok ? res.json() : res.status === 404 ? null : undefined))
      .catch(() => undefined)
      .then(async (live) => {
        if (!alive.current) return;
        if (live) {
          setRecipe(live);
          setRecipeIsMine(true);
          setRecipeState("idle");
          return;
        }
        const any = byIdEarly ? await byIdEarly : live === null ? await readById() : undefined;
        if (!alive.current) return;
        if (any) {
          setRecipe(any);
          setRecipeIsMine(live === null ? false : null);
          setRecipeState("idle");
        } else if (any === null) {
          setRecipe(null);
          setRecipeState("gone");
        } else if (fromSnapshot) {
          // The snapshot stays. Not the user's, and the read by id failed: still offer Save.
          if (live === null) setRecipeIsMine(false);
        } else {
          setRecipeState("error");
        }
        if (live === undefined || any === undefined) recipeLookup.current = false; // the next open asks again
      });
  }

  useEffect(() => {
    if (!open || !canToggleAutoPlanning || !recipeUuid || planRead.current) return;
    planRead.current = true;
    loadRecipePlanState(recipeUuid)
      .then((s) => { if (alive.current && s.autoPlan !== null) { setPlanOn(s.autoPlan); setPlanWhy(s.why); } })
      .catch(() => { planRead.current = false; });
  }, [open, canToggleAutoPlanning, recipeUuid]);

  // The recipe page's switch (components/PlanningSwitch.tsx), by the same call and the same words: flips the
  // recipe in or out of automatic planning, then tells the Saved tab.
  async function flipAutoPlanning() {
    if (!recipeUuid || planBusy) return;
    const next = !(planOn ?? true);
    const dietWhy = planWhy;
    setPlanBusy(true);
    try {
      const res = await setRecipePlanning(recipeUuid, next);
      if (!res?.ok) {
        onFeedback?.({ type: "error", message: res?.message ?? "Couldn't change that. Please try again." });
        return;
      }
      setPlanOn(next);
      setPlanWhy(null);
      onFeedback?.({ type: "success", message: planningMessage(res.meal_title ?? title, next, dietWhy) });
      rememberAutoPlan(recipeUuid, next);
      announcePlanningChanged();
    } catch {
      onFeedback?.({ type: "error", message: "Couldn't change that. Please try again." });
    } finally {
      if (alive.current) setPlanBusy(false);
    }
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
    ...(canToggleAutoPlanning && recipeUuid ? [{
      id: "autoplan",
      caption: planOn === false ? "Use in auto planning" : "Stop auto planning",
      icon: planBusy ? <Spinner size={15} /> : planOn === false ? <Calendar size={15} /> : <CalendarOff size={15} />,
      tone: BTN_GREY,
      onClick: flipAutoPlanning,
    }] : []),
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
            {recipeState === "gone" && (
              <div className="px-5 py-8 flex flex-col items-center gap-4 text-center">
                <div className="font-display text-xl text-text-main">{title}</div>
                {displayMacros && <div className="w-full"><MacroRings macros={displayMacros} /></div>}
                <p className="text-sm text-text-muted">This recipe is no longer available.</p>
              </div>
            )}
            {recipe && (
              <RecipeDetailHero
                key={recipeIsMine === null ? "checking" : recipeIsMine ? "mine" : "not-mine"}
                recipe={recipe}
                asOverlay
                saved={recipeIsMine === null ? null : recipeIsMine || savedHere}
                onSaved={() => { setSavedHere(true); onRecipeSaved?.(); }}
              />
            )}
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
                disabled={stopping || planBusy}
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
