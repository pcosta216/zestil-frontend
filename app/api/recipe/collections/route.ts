import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { recipe_uuid, collection_ids } = await req.json().catch(() => ({}));
  if (!recipe_uuid || !Array.isArray(collection_ids) || collection_ids.length === 0) {
    return NextResponse.json({ error: "recipe_uuid and collection_ids required" }, { status: 400 });
  }

  const rows = (collection_ids as number[]).map((id) => ({
    collection_id: id,
    recipe_uuid,
    account_key:   user.id,
  }));

  const { error } = await supabase.from("tbl_collections_line").upsert(rows, { onConflict: "collection_id,recipe_uuid" });
  if (error) {
    console.error("[recipe/collections] supabase error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok", inserted: rows.length });
}
