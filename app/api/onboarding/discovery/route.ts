import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/onboarding/discovery — the recipe-discovery progress block, polled by
// DiscoveryProgress.tsx on the last onboarding screen.
//
// Read-only, and read-only by design: memory_json.onboarding is written entirely by the backend
// discovery job. Nothing in this repo creates or updates it — grepped lib/ and app/ — so this
// route must never write, or it would race the job it is reporting on.
//
// Selects the JSON sub-path rather than the whole memory_json: this is polled every 10s for the
// length of a run (measured 3-7 minutes against real accounts, so ~42 requests), and a completed
// profile blob is far larger than the progress block inside it.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { data, error } = await supabase
      .from("tbl_user_memory")
      .select("onboarding:memory_json->onboarding")
      .eq("account_key", user.id)
      .single();

    if (error) throw new Error(error.message);
    // `null` is a real, expected answer, not an error: the job may not have written anything
    // yet. The client distinguishes "nothing yet" from "failed" and must not be told they are
    // the same thing — see DiscoveryProgress's stalled handling.
    return NextResponse.json({ onboarding: (data as { onboarding?: unknown } | null)?.onboarding ?? null });
  } catch (err) {
    console.error("[onboarding/discovery]", err);
    return NextResponse.json({ error: "Couldn't read discovery progress" }, { status: 500 });
  }
}
