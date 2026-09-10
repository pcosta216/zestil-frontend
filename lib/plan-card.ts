// Shared builder for the meal cards PlanTab renders (WeekdayGrid → WeekdayRecipeCard).
//
// /api/plan/today and /api/plan/week both project tbl_week_plan_entries rows into the same
// client-side MealCard shape, so they must agree field-for-field. They did not: the week route
// omitted is_optimised/original_macros, which silently hid the "✦ optimised" badge in week view
// (the badge only renders when is_optimised is truthy). Keeping one builder — and one column
// list, since is_optimised needs adjusted_snapshot and role needs role — makes that drift
// impossible rather than merely fixed once.

import { currentQtyG, originalQtyG } from "@/lib/entry-quantity";

export const PLAN_ENTRY_COLUMNS =
  "entry_id, entry_date, meal_slot, entry_type, role, macros, agent_suggestion, confirmed, " +
  "notes, serving_multiplier, quantity_g, original_snapshot, adjusted_snapshot";

const NUTRIENT_MAP: Record<string, string> = {
  "Energy":                      "kcal",
  "Carbohydrate, by difference": "carbs",
  "Protein":                     "protein",
  "Total lipid (fat)":           "fat",
  "Total Sugars":                "sugar",
  "Sodium, Na":                  "sodium",
};

function extractRecipeMacros(snapshot: any, servingMultiplier: number): Record<string, number> {
  const servings = Math.max(parseFloat(snapshot?.metadata?.servings_value ?? "1") || 1, 0.001);
  const macros: Record<string, number> = {};
  for (const item of (snapshot?.recipe_totals ?? [])) {
    const key = NUTRIENT_MAP[item.nutrientname ?? ""];
    if (!key) continue;
    const total = parseFloat(item.total_value ?? "0") || 0;
    macros[key] = Math.round((total / servings) * servingMultiplier * 100) / 100;
  }
  return macros;
}

function extractIngredientMacros(snapshot: any, quantityG: number): Record<string, number> {
  const macros: Record<string, number> = {};
  for (const item of (snapshot?.ingredient_nutrients ?? [])) {
    const key = NUTRIENT_MAP[item.nutrient_name ?? ""];
    if (!key) continue;
    const per100g = parseFloat(item.nutrient_value ?? "0") || 0;
    macros[key] = Math.round((per100g / 100) * quantityG * 100) / 100;
  }
  return macros;
}

// Recipe-kind SIDES carry a frozen per-serving macro snapshot (macros_per_serving).
const SCALABLE_MACROS = ["kcal", "protein", "carbs", "fat", "sugar", "sodium"];
function scaleMacros(perServing: any, multiplier: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of SCALABLE_MACROS) {
    if (perServing?.[k] != null) out[k] = Math.round((perServing[k] * multiplier) * 100) / 100;
  }
  return out;
}

export function rowToMealCard(e: any) {
  const isOptimised = !!e.adjusted_snapshot;
  const snap        = e.adjusted_snapshot ?? e.original_snapshot ?? {};
  // Catalog entries (side | snack) carry a curated display_name and a kind. Recipe-kind
  // catalog entries are recipe-shaped (frozen per-serving macros, sized by serving_multiplier).
  const isCatalog       = e.entry_type === "side" || e.entry_type === "snack";
  const catalogKind     = snap.side_kind ?? snap.snack_kind;
  const isRecipeCatalog = isCatalog && catalogKind === "recipe";
  const isRecipeShaped  = e.entry_type === "recipe" || isRecipeCatalog;
  const name        = isCatalog
    ? (snap.display_name ?? snap.metadata?.meal_title ?? snap.meal_title ?? snap.description ?? (e.entry_type === "snack" ? "Snack" : "Side"))
    : e.entry_type === "recipe"
      ? (snap.metadata?.meal_title ?? snap.meal_title ?? "Unknown recipe")
      : (snap.ingredient_name ?? snap.description ?? "Unknown ingredient");

  const m    = e.macros ?? {};
  const mult = parseFloat(e.serving_multiplier ?? "1") || 1;
  // Two different numbers once an entry has been adjusted: original_macros needs the
  // baseline, the card needs what is on the plate now.
  const curQty  = currentQtyG(e);
  const origQty = originalQtyG(e);

  let originalMacros: Record<string, number> | undefined;
  if (isOptimised && e.original_snapshot) {
    originalMacros = isRecipeCatalog
      ? scaleMacros(e.original_snapshot.macros_per_serving, mult)
      : isRecipeShaped
        ? extractRecipeMacros(e.original_snapshot, mult)
        : extractIngredientMacros(e.original_snapshot, origQty);
  }

  const card: any = {
    entry_id:          e.entry_id,
    day:               new Date(e.entry_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" }),
    date:              e.entry_date,
    meal_slot:         e.meal_slot,
    entry_type:        e.entry_type,
    role:              e.role ?? "main",
    name,
    macros: {
      kcal:    Math.round(m.kcal    ?? 0),
      protein: parseFloat((m.protein ?? 0).toFixed(1)),
      carbs:   parseFloat((m.carbs   ?? 0).toFixed(1)),
      fat:     parseFloat((m.fat     ?? 0).toFixed(1)),
      sugar:   parseFloat((m.sugar   ?? 0).toFixed(1)),
      sodium:  Math.round(m.sodium   ?? 0),
    },
    is_optimised:       isOptimised,
    original_macros:    originalMacros,
    confirmed:          e.confirmed ?? true,
    notes:              e.notes ?? null,
    agent_suggestion:   e.agent_suggestion ?? null,
    metadata:           snap,
    recipe_uuid:        snap.recipe_uuid ?? null,
    serving_multiplier: mult,
  };
  if (!isRecipeShaped) {
    card.quantity_g = curQty;
  }
  return card;
}
