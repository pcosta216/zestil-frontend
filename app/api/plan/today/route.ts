import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PLAN_ENTRY_COLUMNS, rowToMealCard } from "@/lib/plan-card";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dateParam = req.nextUrl.searchParams.get("date");
  const today = dateParam ?? new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("tbl_week_plan_entries")
    .select(PLAN_ENTRY_COLUMNS)
    .eq("account_key", user.id)
    .eq("entry_date", today)
    .order("meal_slot", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = (data ?? []).map(rowToMealCard);
  return NextResponse.json({ entries, date: today });
}
