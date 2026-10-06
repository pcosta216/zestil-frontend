import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PROFILE_AGENT_URL =
  process.env.USER_PROFILE_FUNCTION_URL ??
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/user-profile-agent`;

type SetupStatus = "pending" | "running" | "complete" | "failed";

// POST /api/recipe-setup — the on-load recipe setup check (ONBOARDING_CONTRACT §4).
//
// Reads tbl_recipe_setup; when the row is missing or not `complete`, asks user-profile-agent to
// finish the job (mode "ensure") without waiting for the run. Safe to call on every load: the
// agent never starts two runs. `complete` is final, so we stop calling the agent once it is.
//
// Only runs for users who have been through the summary screen. Mid-onboarding users have no
// recipe_setup row yet and must not get a run started for a half-filled profile.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { data: setup, error } = await supabase
      .from("tbl_recipe_setup")
      .select("status")
      .eq("account_key", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (setup?.status === "complete") return NextResponse.json({ status: "complete" satisfies SetupStatus });

    // Onboarding finished = the app marked it complete, or the summary agent already started a
    // discovery run for this user.
    const { data: mem, error: memErr } = await supabase
      .from("tbl_user_memory")
      .select("onboarding:memory_json->onboarding")
      .eq("account_key", user.id)
      .maybeSingle();
    if (memErr) throw new Error(memErr.message);
    const onboarding = (mem as { onboarding?: { status?: { current?: string }[]; recipe_discovery_run?: string } } | null)?.onboarding;
    const finished =
      !!onboarding?.recipe_discovery_run ||
      (onboarding?.status ?? []).some((s) => s.current === "complete");
    if (!finished) return NextResponse.json({ status: "skipped" });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return NextResponse.json({ error: "No session token" }, { status: 401 });

    const res = await fetch(PROFILE_AGENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ user_id: user.id, mode: "ensure" }),
    });
    const body = await res.json().catch(() => null) as { status?: SetupStatus } | null;
    if (!res.ok && res.status !== 202) {
      console.error("[recipe-setup] agent", res.status, body);
      return NextResponse.json({ status: "failed" satisfies SetupStatus });
    }
    return NextResponse.json({ status: body?.status ?? "pending" });
  } catch (err) {
    console.error("[recipe-setup]", err);
    return NextResponse.json({ error: "Couldn't check recipe setup" }, { status: 500 });
  }
}
