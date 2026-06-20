import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dateParam = req.nextUrl.searchParams.get("date");
  const today = dateParam ?? new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("tbl_week_plan_entries")
    .select("entry_id, entry_date, meal_slot, entry_type, role, macros, agent_suggestion, confirmed, notes, serving_multiplier, quantity_g, original_snapshot, adjusted_snapshot")
    .eq("account_key", user.id)
    .eq("entry_date", today)
    .order("meal_slot", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = (data ?? []).map(rowToMealCard);
  return NextResponse.json({ entries, date: today });
}

function rowToMealCard(e: any) {
  const isOptimised = !!e.adjusted_snapshot;
  const snap        = e.adjusted_snapshot ?? e.original_snapshot ?? {};
  const name        = e.entry_type === "recipe"
    ? (snap.metadata?.meal_title ?? snap.meal_title ?? "Unknown recipe")
    : (snap.ingredient_name ?? snap.description ?? "Unknown ingredient");

  const m    = e.macros ?? {};
  const mult = parseFloat(e.serving_multiplier ?? "1") || 1;
  const qty  = parseFloat(e.quantity_g ?? "0") || 100;

  let originalMacros: Record<string, number> | undefined;
  if (isOptimised && e.original_snapshot) {
    originalMacros = e.entry_type === "recipe"
      ? extractRecipeMacros(e.original_snapshot, mult)
      : extractIngredientMacros(e.original_snapshot, qty);
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
  if (e.entry_type !== "recipe") {
    card.quantity_g = qty;
  }
  return card;
}
