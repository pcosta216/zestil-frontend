import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadUserMemory, commitUserMemory } from "@/lib/onboarding/server-memory";

// POST /api/onboarding/commit — n_compile, the terminal authoritative pass.
// Every prior answer was already autosaved incrementally by /answer; this
// just stamps completion and clears flow_position. Full UUID resolution
// (resolve_recipe_uuid/create_recipe_stub/queue_recipe_for_catalog_review)
// is deferred to the onboarding agent — not built this phase, see the plan.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { memory } = await loadUserMemory(user.id);
    const finalMemory = await commitUserMemory(user.id, memory);
    return NextResponse.json({ done: true, memory: finalMemory });
  } catch (err) {
    console.error("[onboarding/commit]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to commit" }, { status: 500 });
  }
}
