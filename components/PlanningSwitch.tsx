"use client";

import { useEffect, useRef, useState } from "react";
import { SwitchTrack } from "@/components/ui-style";
import { announcePlanningChanged, dietReason, setRecipePlanning } from "@/lib/recipe-planning";

// The recipe page's "Use in automatic planning" switch (D37), and the state behind it. The state comes
// with the recipe (viw_user_collection_set's auto_plan and auto_reason), so the switch shows at once and
// reads nothing; flipped with set_recipe_planning.

export type PlanningFeedback = { type: "success" | "error"; message: string };

export function useRecipePlanningSwitch(
  recipeUuid: string,
  title: string | null,
  autoPlan: boolean | null,
  autoReason: string | null,
) {
  // null: the view gave no value, so there's no switch.
  const [on, setOn] = useState<boolean | null>(autoPlan);
  // "not keto" while only the diet keeps the recipe out: the user's own "off" needs no reason.
  const [why, setWhy] = useState<string | null>(autoPlan === false ? dietReason(autoReason) : null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<PlanningFeedback | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  function show(b: PlanningFeedback) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(b);
    bannerTimer.current = setTimeout(() => setBanner(null), 5000);
  }

  // Flips at once, then asks; a refusal or a failure puts it back.
  async function flip() {
    if (on === null || busy) return;
    const next = !on;
    const before = { on, why };
    setOn(next);
    setWhy(null);
    setBusy(true);
    try {
      const res = await setRecipePlanning(recipeUuid, next);
      if (!res?.ok) {
        setOn(before.on);
        setWhy(before.why);
        show({ type: "error", message: res?.message ?? "Couldn't change that. Please try again." });
        return;
      }
      const name = res.meal_title ?? title;
      const subject = name ? `"${name}"` : "This recipe";
      show({
        type: "success",
        message: !next
          ? `${subject} won't be used in automatic planning. You can still add it to a day yourself.`
          : before.why
            ? `${subject} is back in automatic planning, even though it's ${before.why}.`
            : `${subject} is back in automatic planning.`,
      });
      // The Saved tab's triangles read auto_plan again.
      announcePlanningChanged();
    } catch {
      setOn(before.on);
      setWhy(before.why);
      show({ type: "error", message: "Couldn't change that. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return { ready: on !== null, on: on === true, why, busy, flip, banner };
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
