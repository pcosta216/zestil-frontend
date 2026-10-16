"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SwitchTrack } from "@/components/ui-style";
import {
  announcePlanningChanged,
  dietReason,
  loadDietLabels,
  loadRecipeReasons,
  onPlanningChanged,
  setRecipePlanning,
} from "@/lib/recipe-planning";

// The recipe page's "Use in automatic planning" switch (D37), and the state behind it. One recipe: read
// when the page opens and whenever the rows change elsewhere (chat, the diet alert); flipped with
// set_recipe_planning.

export type PlanningFeedback = { type: "success" | "error"; message: string };

export function useRecipePlanningSwitch(recipeUuid: string, title: string | null) {
  // Why the recipe is out ('user', 'diet:keto'): [] while it is in planning, null until the first read.
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<PlanningFeedback | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A read that started before a later flip is stale when it lands.
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const g = ++generation.current;
    try {
      const next = await loadRecipeReasons(recipeUuid);
      if (g === generation.current) setReasons(next);
    } catch {
      // Silent: the switch keeps its last state, or stays hidden.
    }
  }, [recipeUuid]);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => onPlanningChanged(reload), [reload]);
  useEffect(() => {
    loadDietLabels().then(setLabels).catch(() => { /* "not keto" falls back to the diet's name */ });
  }, []);
  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  function show(b: PlanningFeedback) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(b);
    bannerTimer.current = setTimeout(() => setBanner(null), 5000);
  }

  // Flips at once, then asks; a refusal or a failure puts it back.
  async function flip() {
    if (!reasons || busy) return;
    const on = reasons.length > 0;
    const before = reasons;
    const diet = dietReason(before, labels);
    generation.current++;
    setReasons(on ? [] : ["user"]);
    setBusy(true);
    try {
      const res = await setRecipePlanning(recipeUuid, on);
      if (!res?.ok) {
        setReasons(before);
        show({ type: "error", message: res?.message ?? "Couldn't change that. Please try again." });
        return;
      }
      const name = res.meal_title ?? title;
      const subject = name ? `"${name}"` : "This recipe";
      show({
        type: "success",
        message: !on
          ? `${subject} won't be used in automatic planning. You can still add it to a day yourself.`
          : diet
            ? `${subject} is back in automatic planning, even though it's ${diet}.`
            : `${subject} is back in automatic planning.`,
      });
      // Read again here (switching on removes the diet's row too) and on the Saved tab.
      announcePlanningChanged();
    } catch {
      setReasons(before);
      show({ type: "error", message: "Couldn't change that. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return {
    ready: reasons !== null,
    on: reasons?.length === 0,
    // "not keto" only when the diet alone keeps the recipe out: the user's own "off" needs no reason.
    why: reasons && reasons.length > 0 && !reasons.includes("user") ? dietReason(reasons, labels) : null,
    busy,
    flip,
    banner,
  };
}

export function PlanningSwitch({ on, why, busy, onFlip, className = "" }: {
  on: boolean;
  why: string | null;
  busy: boolean;
  onFlip: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={why ? `Use in automatic planning (${why})` : "Use in automatic planning"}
      disabled={busy}
      onClick={onFlip}
      className={`flex items-center gap-2 px-3 rounded-xl border border-[rgba(0,0,0,0.08)] bg-white text-sm transition-opacity disabled:opacity-60 ${className}`}
    >
      <span className={why ? "text-amber-700" : "text-text-main"}>
        {why ? why.charAt(0).toUpperCase() + why.slice(1) : "Auto-plan"}
      </span>
      <SwitchTrack on={on} />
    </button>
  );
}
