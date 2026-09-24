# Onboarding Validator Agent — Frontend Contract Spec

> **Status: implemented 2026-09-18.** The caller described below is built and verified end-to-end
> against the live `onboarding-validator-agent` edge function (both the silent-`valid` path and
> the `flag` → confirm → write path, on the real deployed function, through the real UI). §5's
> current-state-vs-target table is kept below as the record of what changed; every row in the
> "Target" column now reflects what's actually in the code. The one deliberate deviation from the
> original plan: `favorite_recipes` is wired in `FreeTextSearch.tsx` (its validation config sits
> at the node's own top level, not in an `other_capture` block), not `MultiSelect.tsx`.

_Companion to `ONBOARDING_VALIDATOR_AGENT_DESIGN.md` (the design doc — lives outside this repo). This document does not repeat that doc's per-section validation reasoning (§4) or its model/`tbl_agent_configs` content (§6's actual prompt text), which are correct as written. It exists to nail down, precisely and against this repo's real code, the one seam that doc couldn't verify from its own side: what the frontend caller actually sends, expects back, and requires operationally. Written from `zestil-frontend`, which owns the caller — every claim below is checked against real files in this repo, not assumed from convention._

## Why this doc exists

The design doc's §2 (request/response contract) and §7 (caller responsibilities) describe a caller that does not exist yet in this codebase. The real caller today (`app/api/onboarding/validate-other/route.ts` + `lib/onboarding/validate-other.ts`) implements an older, materially different contract: one HTTP call per entry (not batched), a boolean `valid` response (not a 3-state `verdict`), no `value`/`label` normalization concept at all, and calls an external FastAPI-style backend (`AGENT_API_URL` + `X-API-Key`/`X-User-Id` headers) rather than a Supabase Edge Function. If the backend ships exactly as the design doc's §6 specifies, the current caller's response parsing (`typeof result.valid !== "boolean"`) will treat every real response as malformed and silently fall through to `{valid: true, stubbed: true}` — validation will appear to work while doing nothing, with no visible failure signal.

This doc is the fix for that: an exact spec for the new caller, grounded in this repo's real code and real conventions, so the backend and the frontend rewrite can both be built against the same ground truth instead of each guessing at the other side.

## 1. Transport & auth — corrected from the design doc

The design doc's §5 states the validator agent's `user_id`/auth "matches `explore-agent`'s pattern (called with a service-role key from a trusted backend, never directly from an untrusted client)." **This is inaccurate for this repo.** Checked directly against the two existing Edge-Function-calling routes in this codebase (`app/api/chat/route.ts`, calling `explore-agent`, and `app/api/plan/optimise/route.ts`, calling `optimize-day-agent`) — both use an identical pattern, and neither uses a service-role key:

```ts
const FUNCTION_URL =
  process.env.SOME_FUNCTION_URL ??
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/<function-name>`;

const { data: { user } } = await supabase.auth.getUser();
const { data: { session } } = await supabase.auth.getSession();
// 401 if either is missing

const res = await fetch(FUNCTION_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({ ...body, user_id: user.id }),
});
```

**The validator agent's caller should follow this exact, established pattern** — not introduce a new one — for consistency with every other Edge Function this app already calls, and because there's no service-role precedent for an Edge-Function call anywhere in this codebase to follow instead. Concretely:

- URL: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-validator-agent` (with an optional `ONBOARDING_VALIDATOR_FUNCTION_URL` env override, matching `CHAT_FUNCTION_URL`/`OPTIMISE_FUNCTION_URL`'s own naming convention).
- Auth: `Authorization: Bearer <the calling user's session access_token>`, obtained server-side via `supabase.auth.getSession()` in the Next.js API route — never a service-role key, never called from the client directly.
- `user_id` travels in the body (`{ ...body, user_id: user.id }`), same as `chat`/`optimise` — so the design doc's "logging/debug parity only" framing for `user_id` is fine, just note it arrives the same way every other agent call's `user_id` does, not as a special case.

If the backend's edge function needs to be told to skip Supabase's own automatic JWT verification (a per-function `verify_jwt` setting) because it does its own lighter-weight handling — that's the backend's call, but the frontend will send a real user bearer token regardless, matching precedent. Flag back to this doc's author if the backend actually needs a service-role-only invocation for some reason not visible from the frontend side; don't silently deviate from the two working examples in this repo.

## 2. Request contract

One call per `other_capture` submission — **all comma/semicolon/newline-split entries in one request**, never one call per entry. This matches the design doc's §2 intent exactly; the correction is that the *current* caller doesn't do this yet (§5 below).

```jsonc
POST ${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-validator-agent
Authorization: Bearer <session.access_token>
Content-Type: application/json

{
  "user_id": "...",                    // spliced in server-side, matching chat/optimise
  "section": "dishes",                 // exactly one of the section values the design
                                        // doc's §1/§4 scopes this agent to (5 today —
                                        // cuisine_narrow, dishes, allergies, intolerances,
                                        // favorite_recipes; NOT cuisine_broad/diet_style/
                                        // accepted_protein/accepted_carbs/accepted_fat —
                                        // those use validate_other_entry too but are
                                        // out of scope for this agent, see the design
                                        // doc's scope discussion)
  "context": { "parent_sub_cuisine": "thai", "diet_type": ["vegan"] },
  "entries": ["som tam", "beef massaman curry"]
}
```

`section` and `context` come straight from this node's `other_capture.validation.payload` in `content/onboarding/flow-structure.yaml`, already interpolated server-side (memory-path references like `{item}`/`{dietary.diet_type.preferred}` resolved before the call, exactly as `lib/onboarding/validate-other.ts`'s existing `interpolatePayload` already does — that piece of logic is correct today and carries over unchanged). `entries` is the array already produced by the existing client-side split (`MultiSelect.tsx`'s `splitOtherText`) — that's correct today too and doesn't change.

## 3. Response contract

Unchanged from the design doc's §2 — restated here only for completeness, since it's the one part of §2 that was already correct:

```jsonc
{
  "results": [
    { "entry": "som tam", "verdict": "valid", "value": "som_tam", "label": "Som Tam", "reason": null },
    { "entry": "beef massaman curry", "verdict": "flag", "value": "beef_massaman_curry", "label": "Beef Massaman Curry",
      "reason": "Contains beef — you told us you're vegan. Still want to add it?" }
  ]
}
```

Same length and order as `entries`, matched by position. `favorite_recipes` keeps `value: null` always, per the design doc's §2 exception (no slug concept for a recipe title).

## 4. Timeout & failure-mode requirements — new, not covered by the design doc

The design doc's §5 total-failure fallback (`flag`/`null`/`null`/`null` for every surviving entry, on a network error or unparseable response) is correct and should stay exactly as specified — but the doc never says what the *frontend* should do if the call is simply slow, and today's caller (`callValidateEntry` in `lib/onboarding/validate-other.ts`) has **no explicit timeout at all** — it relies on whatever default the platform's fetch implementation happens to apply, which is not a deliberate, bounded wait.

Requirements for the rewritten caller:

- **Explicit timeout on the fetch call itself** — recommend 8000ms. Reasoning: this session's own onboarding work found plain Supabase content reads already running ~300–500ms each and full `/api/onboarding/answer` round trips landing around 1.7–2.5s in this environment (see the protein/carb/fat latency investigation earlier this session) — an LLM call is a materially heavier operation than either, so the timeout needs real headroom, but it still needs to be bounded so a hung request can't leave the user stuck.
- **A timed-out call is treated identically to the design doc's §5 total-failure fallback** (`flag`/`null`/`null`/`null` per surviving entry, confirm_or_correct with the node's static message) — not a divergent "just accept it" path. Keeping one failure behavior, not two, is simpler to reason about and matches the doc's own reasoning for why `flag` (not `valid` or `invalid`) is the only verdict safe to apply blindly across every in-scope section.
- **Visible loading state during the call is already built and does not need new UI work.** `MultiSelect.tsx` already has a `checkingOther` state wired to the Continue button's `loading` prop (shows "…", disables the button) for the *current*, unbatched validate-other call — the same mechanism covers a single batched call with no changes; it's already correct.

## 5. What the caller needs to change — current state vs. target

For whoever picks this up, exactly what's already correct and what needs to change in this repo:

| Piece | Current state | Target |
|---|---|---|
| Batching | `lib/onboarding/validate-other.ts`'s `validateEntries` calls `callValidateEntry` once per entry via `Promise.all` | One call per `other_capture` submission, `entries: string[]` in one request body |
| Transport | `${AGENT_API_URL}/api/v1/onboarding/validate` + `X-API-Key`/`X-User-Id` headers (external FastAPI pattern) | `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-validator-agent` + `Authorization: Bearer <session token>` (§1 above) |
| Response parsing | Expects `{ valid: boolean, message?: string }`; `typeof result.valid !== "boolean"` guards against anything else | Parse `{ results: [{ entry, verdict, value, label, reason }] }`, matched by position |
| Gate logic | Binary: anything with `valid: false` shows the same confirm-or-correct UI | 3-state `verdict`; `flag` and `invalid` both gate identically (design doc §3) — the *value* only affects tone/copy via `reason`, never control flow |
| Write path on confirm | Always writes the raw typed text (`engine.ts`: `appendUnique(memory, appends_to, p)` where `p` is the trimmed split piece) — no normalization concept exists | Write the agent's `value`/`label` for that entry when non-null; fall back to raw text only when `value`/`label` are both `null` (design doc §3 step 2) |
| Timeout | None — relies on platform default | Explicit, ~8000ms (§4 above) |
| Pre-check against curated options | Not implemented — nothing checks if typed text already matches a curated `{value,label}` before calling the agent | Add per design doc §7 item 1 |
| Post-normalization dedupe | Not implemented (nothing to dedupe against — no normalization exists yet) | Add per design doc §7 item 2, once normalization lands |
| Comma/semicolon/newline split | Already correct (`MultiSelect.tsx`'s `splitOtherText`, mirrored in `engine.ts`) | No change |

Files this touches: `lib/onboarding/validate-other.ts` (rewrite `callValidateEntry`/`validateEntries` for batching + new transport + new response shape), `app/api/onboarding/validate-other/route.ts` (pass the batch through, add the bearer-token fetch), `app/onboarding/_components/MultiSelect.tsx` (consume `verdict` instead of `valid`, use returned `value`/`label` on confirm instead of always the raw text), `lib/onboarding/engine.ts` (accept a resolved `value`/`label` pair from the client's confirm step instead of re-deriving from raw `other_text` — needs its own design pass, not assumed here).

## 6. Summary of corrections to the original design doc

- §5's auth claim ("service-role key... matches explore-agent's pattern") is wrong for this repo — real pattern is a user session bearer token (§1 above).
- §2/§7 describe a caller that doesn't exist yet — §2's response *shape* is fine as specified; the batching and normalization-on-write behavior need building from scratch (§5 above table).
- §7's three caller responsibilities: only the comma-split (#3) is implemented today; the pre-check (#1) and dedupe (#2) are not built and can't be until normalization exists.
- New requirement not in the original doc at all: an explicit client-side timeout with a defined fallback (§4 above) — the original doc only covers backend-side total failure, not frontend-side slowness.
