// The Onboarding Validator Agent (supabase/functions/onboarding-validator-agent, a separate
// repo) is scoped to exactly these 6 sections — curated data that's inherently non-exhaustive
// by design, where the frontend genuinely needs agent reasoning about something outside the
// curated set. It 400s on anything else, off its OWN hardcoded allowlist — adding a section to
// tbl_agent_configs is not sufficient to make it callable, so re-probe the live function
// (scripts/onboarding-seed/probe-diet-style-section.mjs) before adding a name here.
//
// `diet_styles` (n_diet_style_cards) joined 2026-09-20; note the plural — the function rejects
// `diet_style`, which is what this flow used to send. The remaining out-of-scope other_capture
// nodes (cuisine_broad, accepted_protein, accepted_carbs, accepted_fat) still declare a
// `validation` block (same YAML shape) but never reach the agent — their options are
// closed/small-enough sets that they don't need this kind of clarification; see validate-other.ts.
//
// No dependency on server-only code (content.ts/supabase/server) — safe to import from a
// client component (MultiSelect.tsx/FreeTextSearch.tsx) as well as server code (the API route).
export const VALIDATOR_SECTIONS = new Set([
  "cuisine_narrow",
  "dishes",
  "allergies",
  "intolerances",
  "favorite_recipes",
  "diet_styles",
]);

export function isValidatorSection(section: string | undefined): boolean {
  return section !== undefined && VALIDATOR_SECTIONS.has(section);
}

// Verbatim from the Edge Function's own totalFailureFallback() — copied, not paraphrased, so a
// timeout on our side and a real backend failure are indistinguishable to the user and in logs
// (ONBOARDING_VALIDATOR_AGENT_FRONTEND_IMPLEMENTATION.md §3). Lives here rather than in
// validate-other.ts because the client components need it too and that module is server-only.
//
// The contract guarantees `reason` is non-null on EVERY non-valid verdict, including the
// total-failure case. Ours returned null, so a timed-out batch fell through to the node's static
// on_invalid_message ("...not an allergy or intolerance?") — copy written for a different
// situation entirely, and actively confusing on a screen that has nothing to do with allergies.
export const TOTAL_FAILURE_REASON =
  "We couldn't check this one due to a temporary issue on our end — mind confirming it's correct?";
