import { DAYS_OF_WEEK, type UserMemory, type DayOfWeek, type DayConstraint, type VarietyRotation } from "./types";

function emptyDayConstraint(): DayConstraint {
  return {
    note: null,
    diet_style: null,
    macro_bias: null,
    fixed_meals: [],
    skip_planning: false,
    explorer_trigger: false,
  };
}

function emptyDayConstraints(): Record<DayOfWeek, DayConstraint> {
  return Object.fromEntries(DAYS_OF_WEEK.map((d) => [d, emptyDayConstraint()])) as Record<DayOfWeek, DayConstraint>;
}

function emptyVariety(): VarietyRotation {
  return { rotation: [], min_distinct_sources_per_week: null, max_same_source_consecutive_days: null };
}

/**
 * Fresh copy of the empty user_memory skeleton (schema v1.3), matching
 * user_memory_empty.json plus the two fields the updated design docs added:
 * dietary.health_condition_notes and variety_rules.{carb_variety,fat_variety}
 * (mirroring protein_variety). Returns a new object every call — never share
 * a single module-level instance, since callers mutate it while merging
 * autosaved answers.
 */
export function emptyUserMemory(): UserMemory {
  return {
    version: "1.3",
    last_updated: null,
    profile: {
      biometrics: { gender: null, age: null, height: null, weight: null },
      locale: { units: null, timezone: null, week_start_day: null },
      consent: { accepted: false, accepted_at: null },
      onboarding_completed_at: null,
    },
    taste_profile: { cuisines: [], sub_cuisines: [], favorite_dishes: [] },
    dietary: {
      notes: null,
      health_condition_notes: null,
      allergies: [],
      intolerances: [],
      diet_type: { preferred: [], to_avoid: [] },
      avoided_foods: [],
      preferred_foods: [],
      avoided_ingredients_uuids: [],
    },
    pantry: { current_stock: [], expiring_soon: [], always_available: [] },
    cooking_profile: {
      skill_level: null,
      budget_level: null,
      household_size: null,
      preferred_cooking_days: [],
      day_constraints: emptyDayConstraints(),
    },
    meal_planning_preferences: {
      active_slots: [],
      plan_snacks: false,
      macro_priority: [],
      preferred_recipes: [],
      preferred_pairings: [],
      forbidden_pairings: [],
      goals_source: null,
      batch_cook: { enabled: false, max_portions: null, preferred_day: null },
      slot_kcal_budgets: {
        budgets: { breakfast: null, lunch: null, dinner: null, snack: null },
        slot_kcal_tolerance: { min: null, max: null },
      },
      variety_rules: {
        leftover_friendly: null,
        max_same_recipe_per_week: null,
        protein_variety: emptyVariety(),
        carb_variety: emptyVariety(),
        fat_variety: emptyVariety(),
        daily_composition: { pattern: [], main_meals: [] },
        weekly_diet_pattern: {
          vegan_days: null,
          vegetarian_days: null,
          pescatarian_days: null,
          omnivore_days: null,
        },
      },
      unique_items_per_day: null,
    },
    explorer_handoff: { trigger_when: [], max_new_recipes_per_week: null, preferred_discovery_mode: null },
    planning_history: {
      recent_recipes: [],
      disliked_recently: [],
      last_planned_week: null,
      do_not_repeat_until: [],
    },
    other: {},
  };
}

/**
 * Overlays a stored memory_json onto a fresh skeleton, so every path the schema defines exists
 * with the right SHAPE even when the stored row only covers part of it.
 *
 * Without this, a partial row reaches the engine as-is and `writeScalarOrArray` — which decides
 * append-vs-overwrite by asking whether the CURRENT value is an array — sees `undefined` at a
 * missing path and writes a bare scalar. `dietary.diet_type.preferred` then holds "vegetarian"
 * rather than ["vegetarian"], and the next screen that reads it as a list either throws
 * (options-filter's `.filter`) or, worse, iterates the string's characters and silently applies
 * nothing. Reproduced end to end; see smoke-test.ts scenario W.
 *
 * Rules, in order:
 *  - stored array      -> replaces the skeleton's wholesale (never merged element-wise; a user
 *                         who deselected everything must end up with [], not the default)
 *  - skeleton array, stored scalar -> wrapped as [stored]. Schema conformance, and it repairs a
 *                         row already written the broken way on its next save rather than
 *                         leaving it to throw forever
 *  - both plain objects -> recursed
 *  - anything else      -> stored wins; a key the skeleton has never heard of is kept as-is
 *                         (memory.other.<section> is open-ended by design)
 */
export function mergeIntoSkeleton(stored: unknown): UserMemory {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  function merge(base: unknown, incoming: unknown): unknown {
    if (incoming === undefined) return base;
    if (Array.isArray(base) && !Array.isArray(incoming)) {
      return incoming === null ? base : [incoming];
    }
    if (isPlainObject(base) && isPlainObject(incoming)) {
      const out: Record<string, unknown> = { ...base };
      for (const [k, v] of Object.entries(incoming)) out[k] = merge(base[k], v);
      return out;
    }
    return incoming;
  }

  return merge(emptyUserMemory(), stored) as UserMemory;
}
