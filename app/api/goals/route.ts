import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// meal_slots/week_start_day used to come from tbl_user_goals.preferences.
// Per the single-source-of-truth decision, onboarding is now the only
// writer of those two — they live in tbl_user_memory.memory_json
// (meal_planning_preferences.active_slots / profile.locale.week_start_day)
// instead. macro_goals stays on tbl_user_goals (untouched by onboarding).
// Response shape is unchanged on purpose — PlanTab.tsx needs no edits.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [goalsResult, memoryResult] = await Promise.all([
    supabase.from("tbl_user_goals").select("macro_goals").eq("account_key", user.id).single(),
    supabase.from("tbl_user_memory").select("memory_json").eq("account_key", user.id).single(),
  ]);

  if (goalsResult.error) {
    console.error("[goals]", goalsResult.error);
    return NextResponse.json({ error: goalsResult.error.message }, { status: 500 });
  }
  if (memoryResult.error) {
    console.error("[goals] memory", memoryResult.error);
    return NextResponse.json({ error: memoryResult.error.message }, { status: 500 });
  }

  const memory = memoryResult.data?.memory_json ?? {};

  return NextResponse.json({
    macro_goals: goalsResult.data?.macro_goals ?? {},
    preferences: {
      meal_slots: memory.meal_planning_preferences?.active_slots ?? [],
      week_start_day: memory.profile?.locale?.week_start_day ?? null,
    },
  });
}
