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
