import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PLAN_ENTRY_COLUMNS, rowToMealCard } from "@/lib/plan-card";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to   = req.nextUrl.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Missing from/to params" }, { status: 400 });

  const { data, error } = await supabase
    .from("tbl_week_plan_entries")
    .select(PLAN_ENTRY_COLUMNS)
    .eq("account_key", user.id)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: true })
    .order("meal_slot",  { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = (data ?? []).map(rowToMealCard);
  return NextResponse.json({ entries });
}
