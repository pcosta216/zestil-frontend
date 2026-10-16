"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadPlanningState, onPlanningChanged, type PlanningState } from "@/lib/recipe-planning";

/**
 * Which saved recipes are out of automatic planning (D37), for the Saved tab's card triangles and its
 * "Not in automatic planning" filter. Read whenever the tab is shown, its recipes change, or the rows
 * change elsewhere (the recipe page's switch, the diet alert); chat changes them too, so it's never
 * cached for the session. `state` stays null until the first read succeeds.
 */
export function useRecipePlanning(active: boolean, recipes: unknown) {
  const [state, setState] = useState<PlanningState | null>(null);
  // Reads can overlap (a tab switch while the recipes refresh): only the latest one lands.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const g = ++generation.current;
    try {
      const next = await loadPlanningState();
      if (g === generation.current) setState(next);
    } catch {
      // Silent: the cards keep their last known state (or stay unknown), and the next show reads again.
    }
  }, []);

  useEffect(() => {
    if (active) refresh();
  }, [active, recipes, refresh]);

  useEffect(() => onPlanningChanged(refresh), [refresh]);

  return { state };
}
