import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRecipe } from "@/lib/supabase/queries";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const recipe = await getRecipe(uuid, user.id);
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(recipe);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("tbl_collections_line")
    .delete()
    .eq("recipe_uuid", uuid)
    .eq("account_key", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
