"use client";

import { useState } from "react";
import { PrimaryButton, Prompt, ScreenShell, SkipButton, type NodeScreenProps } from "./shared";
import type { DayMealEntry } from "@/lib/onboarding/types";

// n_fixed_meals — repeatable: add one (day, meal, dish) at a time, remove
// any, then Continue. day_of_week comes from content:days_of_week;
// meal_slot comes from n_active_slots' own options + always_include,
// filtered to whichever slots were actually picked (see resolvers.ts'
// from_node_options — both resolved server-side into node.fields already).
export function DayMealPicker({ node, showBack, submitting, onAnswer, onBack }: NodeScreenProps) {
  const [day, setDay] = useState<string | undefined>();
  const [slot, setSlot] = useState<string | undefined>();
  const [dish, setDish] = useState("");
  const [dishPick, setDishPick] = useState<string | undefined>();
  const [entries, setEntries] = useState<DayMealEntry[]>([]);

  const dayField = node.fields?.find((f) => f.name === "day_of_week");
  const slotField = node.fields?.find((f) => f.name === "meal_slot");
  // The dishes named back at n_favorite_recipes (resolvers.ts' from_memory_list). Empty for
  // anyone who skipped that screen, in which case the whole row is hidden and the box below is
  // the only way in — the badges are a shortcut, never a requirement.
  const dishField = node.fields?.find((f) => f.name === "dish_name");
  const dishOptions = dishField?.options ?? [];

  // A badge and the box are two inputs for ONE field, so only one of them can be armed at a
  // time — picking clears what was typed, typing clears the pick. Without that the composer
  // could hold two different dishes with no way to tell which "+ Add this meal" would use.
  const dishLabel = dishPick ?? dish.trim();

  const addEntry = () => {
    if (!day || !slot || !dishLabel) return;
    setEntries((e) => [...e, { day_of_week: day as DayMealEntry["day_of_week"], meal_slot: slot, dish_label: dishLabel }]);
    setDay(undefined);
    setSlot(undefined);
    setDish("");
    setDishPick(undefined);
  };
  const removeEntry = (i: number) => setEntries((e) => e.filter((_, idx) => idx !== i));

  const pill = (selected: boolean) =>
    `px-3 py-1.5 rounded-full text-xs border transition-colors ${
      selected ? "bg-green-light border-green-border text-text-main" : "bg-white border-[rgba(0,0,0,0.1)] text-text-muted"
    }`;

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} />

      {entries.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          {entries.map((e, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-2.5 text-sm">
              <span className="text-text-main capitalize">
                {e.day_of_week} · {e.meal_slot} · {e.dish_label}
              </span>
              <button type="button" onClick={() => removeEntry(i)} className="text-text-muted hover:text-text-main text-xs">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[rgba(0,0,0,0.08)] bg-white p-4 mb-4">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Day</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {(dayField?.options ?? []).map((opt) => (
            <button key={String(opt.value)} type="button" onClick={() => setDay(String(opt.value))} className={pill(day === opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Meal</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {(slotField?.options ?? []).map((opt) => (
            <button key={String(opt.value)} type="button" onClick={() => setSlot(String(opt.value))} className={pill(slot === opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
        {dishOptions.length > 0 && (
          <>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Dish</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {dishOptions.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    setDishPick(String(opt.value));
                    setDish("");
                  }}
                  className={pill(dishPick === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
        <input
          value={dish}
          onChange={(e) => {
            setDish(e.target.value);
            setDishPick(undefined);
          }}
          placeholder={dishOptions.length > 0 ? "…or type another dish" : "e.g. Pizza"}
          className="w-full bg-white border border-[rgba(0,0,0,0.1)] rounded-xl px-4 py-3 text-sm text-text-main outline-none focus:border-green-mid transition-colors mb-3"
        />
        <button
          type="button"
          onClick={addEntry}
          disabled={!day || !slot || !dishLabel}
          className="w-full text-center text-sm text-green-primary disabled:opacity-40 disabled:text-text-muted py-2"
        >
          + Add this meal
        </button>
      </div>

      <PrimaryButton onClick={() => onAnswer({ day_meal_entries: entries })} loading={submitting}>
        Continue
      </PrimaryButton>
      {node.optional && <SkipButton onClick={() => onAnswer({ skipped: true })} label={node.skip_label} loading={submitting} />}
    </ScreenShell>
  );
}
