import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("tbl_week_plan_entries")
    .select("entry_id, entry_date, meal_slot, entry_type, macros, agent_suggestion, confirmed, notes, serving_multiplier, quantity_g, original_snapshot, adjusted_snapshot")
    .eq("account_key", user.id)
    .eq("entry_date", today)
    .order("meal_slot", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = (data ?? []).map(rowToMealCard);
  return NextResponse.json({ entries, date: today });
}

function rowToMealCard(e: any) {
  const snap = e.adjusted_snapshot ?? e.original_snapshot ?? {};
  const name = e.entry_type === "recipe"
    ? (snap.metadata?.meal_title ?? snap.meal_title ?? "Unknown recipe")
    : (snap.ingredient_name ?? snap.description ?? "Unknown ingredient");

  const m = e.macros ?? {};
  const card: any = {
    entry_id:          e.entry_id,
    day:               new Date(e.entry_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" }),
    date:              e.entry_date,
    meal_slot:         e.meal_slot,
    entry_type:        e.entry_type,
    name,
    macros: {
      kcal:    Math.round(m.kcal    ?? 0),
      protein: parseFloat((m.protein ?? 0).toFixed(1)),
      carbs:   parseFloat((m.carbs   ?? 0).toFixed(1)),
      fat:     parseFloat((m.fat     ?? 0).toFixed(1)),
      sugar:   parseFloat((m.sugar   ?? 0).toFixed(1)),
      sodium:  Math.round(m.sodium   ?? 0),
    },
    confirmed:          e.confirmed ?? true,
    notes:              e.notes ?? null,
    agent_suggestion:   e.agent_suggestion ?? null,
    metadata:           snap,
    serving_multiplier: parseFloat(e.serving_multiplier ?? "1") || 1,
  };
  if (e.entry_type !== "recipe") {
    card.quantity_g = parseFloat(e.quantity_g ?? "0") || 0;
  }
  return card;
}
