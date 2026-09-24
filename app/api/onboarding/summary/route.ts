import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/onboarding/summary — the recap rendered on n_summary.
//
// Proxies the Onboarding Summary Agent (a Supabase Edge Function, not in this repo). Same
// posture as app/api/chat/route.ts and lib/onboarding/validate-other.ts: the browser never
// calls the function directly, and the call carries the user's OWN session token, never a
// service-role key.
//
// The bearer token is doubly load-bearing here — past the gateway's verify_jwt, the function
// independently calls auth.getUser() on it and 403s if the subject doesn't match the posted
// user_id. Both halves come from the same verified session below, so they always agree; a 403
// would mean this route's two reads disagreed, which is worth the log line it gets.
const FUNCTION_URL =
  process.env.ONBOARDING_SUMMARY_FUNCTION_URL ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-summary-agent`;

// An LLM call with no streaming, so the whole generation lands in one response. Sized like the
// validator's 20s (measured, see validate-other.ts) with headroom for a longer document, and
// bounded because the screen it blocks is the last one before the profile commits.
const TIMEOUT_MS = 30000;

export interface SummaryResponse {
  summary_markdown?: string;
  error?: string;
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ user_id: user.id }), // the entire contract — no context, no entries
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => null)) as SummaryResponse | null;

    if (!res.ok) {
      // Upstream distinguishes 400/401/403/404/500; the user can do nothing about any of them,
      // so they all surface as the same retryable failure. The distinction is kept in the log,
      // which is where it's actually useful.
      console.error("[onboarding/summary] upstream", res.status, data?.error ?? "(no body)");
      return NextResponse.json({ error: "Couldn't put your summary together" }, { status: 502 });
    }

    // A successful call always carries a non-empty string — the function substitutes its own
    // fallback line rather than returning "" or omitting the field. Treated as a failure if it
    // ever doesn't, so the screen shows its retry affordance instead of an empty card.
    if (typeof data?.summary_markdown !== "string" || data.summary_markdown.trim().length === 0) {
      console.error("[onboarding/summary] 200 with no usable summary_markdown");
      return NextResponse.json({ error: "Couldn't put your summary together" }, { status: 502 });
    }

    return NextResponse.json({ summary_markdown: data.summary_markdown });
  } catch (err) {
    // Network error or AbortError (timeout) — identical handling, identical message.
    console.error("[onboarding/summary]", err);
    return NextResponse.json({ error: "Couldn't put your summary together" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
