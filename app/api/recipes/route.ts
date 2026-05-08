import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRecipes } from "@/lib/supabase/queries";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const recipes = await getRecipes(user.id);
    return NextResponse.json(recipes);
  } catch {
    return NextResponse.json({ error: "Failed to fetch recipes" }, { status: 500 });
  }
}
