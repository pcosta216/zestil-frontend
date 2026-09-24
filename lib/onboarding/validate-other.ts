import { resolveTemplateRef, type ResolveCtx } from "./resolvers";
import { isValidatorSection, TOTAL_FAILURE_REASON } from "./validator-sections";

// Server-only. Batch-validates one whole other_capture submission (or n_favorite_recipes'
// own freeform entries) against the Onboarding Validator Agent — a separate Supabase Edge
// Function, supabase/functions/onboarding-validator-agent (not in this repo). One HTTP call
// per submission, never one per entry — see ONBOARDING_VALIDATOR_AGENT_CONTRACT.md §2.
//
// Only the 5 sections in validator-sections.ts are in scope for that agent (it 400s on
// anything else, confirmed live) — every other other_capture node (diet_style, cuisine_broad,
// accepted_protein/carbs/fat) never reaches the network here at all; synthesized as all-valid
// locally, same effect as the old "no validation config" fallback.

const FUNCTION_URL =
  process.env.ONBOARDING_VALIDATOR_FUNCTION_URL ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-validator-agent`;

// Was 8000ms, from the implementation doc §3's pre-launch ESTIMATE. Real traffic says that was
// far too tight: measured over 116 logged calls (tbl_agent_debug_log.duration_ms), multi-entry
// batches run median 6045ms / p90 7429ms / max 8546ms, and single entries median 5361ms / p90
// 7089ms. Those are the FUNCTION's own internal times — they exclude network transit in both
// directions — so a call clearing 8000ms end-to-end is routine, not exceptional: 28 of 116 came
// within 1.5s of the old budget and 2 blew it on function time alone. Every one of those aborts
// silently replaced a real verdict batch with synthetic flags, turning the agent's answer
// ("south_beach_diet", "Did you mean South Beach Diet?") into "keep <raw text>" with no
// suggestion — a confirmed user-visible bug, not a theoretical one.
//
// 20s leaves genuine headroom over p90 while still bounding the wait. The cost is a slower
// worst case on a screen that already shows a spinner; the benefit is that a slow-but-successful
// call is no longer thrown away and rewritten as a failure.
//
// The long wait is a deliberate, accepted trade-off (product call, 2026-09-21): this path only
// runs when a user types something freeform that isn't already an option — an edge case they
// opted into — so it's worth waiting for a real verdict rather than degrading to a generic
// "mind confirming?" that teaches them to tap through. Don't trade validation quality back for
// latency here without revisiting that call.
const TIMEOUT_MS = 20000;

export interface ValidatorEntryResult {
  entry: string;
  verdict: "valid" | "flag" | "invalid";
  value: string | null;
  label: string | null;
  reason: string | null;
  // Optional extension, currently only meaningful for favorite_recipes: the agent's breakdown
  // of a compound entry ("butter chicken and pizza" -> ["Butter Chicken", "Pizza"]). Passed
  // straight through to the client, which offers it as a one-tap split (FreeTextSearch.tsx).
  // Declared here so it isn't accidentally dropped by a future narrowing of this shape.
  split_into?: string[] | null;
}

/** Deep-interpolates a validation.payload.context template: "{item}"/"{dietary.x}" -> resolveTemplateRef. */
function resolveContext(context: Record<string, unknown> | undefined, ctx: ResolveCtx): Record<string, unknown> {
  function walk(value: unknown): unknown {
    if (typeof value === "string") return resolveTemplateRef(value, ctx);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  }
  return walk(context ?? {}) as Record<string, unknown>;
}

// `verdict: "flag"` (never "valid") for every failure/timeout/out-of-session case except the
// deliberate "section not in scope" one below — flag is the only verdict safe to apply
// uniformly across every section without violating the allergies never-invalid guarantee, and
// without silently accepting ungrounded data the way a blanket "valid" would. See
// ONBOARDING_VALIDATOR_AGENT_CONTRACT.md §4 / the implementation doc §3.
function syntheticResults(entries: string[], verdict: "valid" | "flag"): ValidatorEntryResult[] {
  // A synthetic `flag` MUST carry a reason — it's the only explanation the user gets, and a null
  // here falls through to the node's static on_invalid_message, which is written for a different
  // failure entirely. `valid` keeps reason null: nothing is shown for it (out-of-scope sections).
  return entries.map((entry) => ({
    entry,
    verdict,
    value: null,
    label: null,
    reason: verdict === "flag" ? TOTAL_FAILURE_REASON : null,
  }));
}

/**
 * Validates a whole batch in one call. Never throws — every failure mode (out-of-scope
 * section, missing session, network error, non-2xx, malformed response, 8s timeout) degrades
 * to a well-formed result array rather than propagating an error to the caller.
 */
export async function validateEntries(
  entries: string[],
  validation: { payload: { section?: unknown; context?: Record<string, unknown> } },
  ctx: ResolveCtx,
  userId: string,
  sessionToken: string | undefined
): Promise<ValidatorEntryResult[]> {
  if (entries.length === 0) return [];

  const section = typeof validation.payload.section === "string" ? validation.payload.section : undefined;
  if (!isValidatorSection(section)) return syntheticResults(entries, "valid"); // out of scope — never call the agent

  if (!sessionToken) return syntheticResults(entries, "flag"); // shouldn't happen (route already checked auth), but don't silently accept

  const context = resolveContext(validation.payload.context, ctx);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ user_id: userId, section, context, entries }),
      signal: controller.signal,
    });
    if (!res.ok) return syntheticResults(entries, "flag");
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.results) || data.results.length !== entries.length) {
      return syntheticResults(entries, "flag");
    }
    return data.results as ValidatorEntryResult[];
  } catch {
    return syntheticResults(entries, "flag"); // network error or AbortError (timeout) — identical fallback
  } finally {
    clearTimeout(timer);
  }
}
