import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCollection, getCollections } from "@/lib/supabase/queries";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json().catch(() => ({}));
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return NextResponse.json({ error: "name required" }, { status: 400 });

  try {
    const existing = await getCollections(user.id);
    if (existing.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      return NextResponse.json({ error: "A collection with that name already exists" }, { status: 409 });
    }
    return NextResponse.json(await createCollection(user.id, trimmed));
  } catch (e) {
    console.error("[recipe/collections/create] supabase error:", e);
    return NextResponse.json({ error: "Failed to create collection" }, { status: 500 });
  }
}
