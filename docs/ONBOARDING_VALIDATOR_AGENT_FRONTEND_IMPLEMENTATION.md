# Onboarding Validator Agent — Frontend Implementation Guide

_Companion to `ONBOARDING_VALIDATOR_AGENT_DESIGN.md` (backend design/reasoning — the source of truth for verdict semantics and per-section behavior) and `ONBOARDING_VALIDATOR_AGENT_CONTRACT.md` (the frontend-side corrections to that doc's transport/auth claims, and the current-state-vs-target table this document implements). Snapshot: 2026-09-18, written after the backend was actually built and live-smoke-tested against `gemini-2.5-flash` — see the design doc's closing Assembly Notes entry for what that verified._

**Scope note on sourcing:** this repo does not contain `zestil-frontend`, so nothing below is a verified diff against real files — every code block is a target implementation to adapt into whatever currently surrounds `app/api/onboarding/validate-other/route.ts`, `lib/onboarding/validate-other.ts`, `app/onboarding/_components/MultiSelect.tsx`, and `lib/onboarding/engine.ts` (the four files `ONBOARDING_VALIDATOR_AGENT_CONTRACT.md` §5 named). Where something depends on those files' actual current shape, that's flagged explicitly rather than guessed.

---

## 1. What's changing, in one picture

| | Today | Target |
|---|---|---|
| Calls | One `fetch` per split entry, via `Promise.all` | One `fetch` per `other_capture` submission — all split entries in one request |
| Transport | `${AGENT_API_URL}/api/v1/onboarding/validate` + `X-API-Key`/`X-User-Id` | `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-validator-agent` + `Authorization: Bearer <session.access_token>` |
| Response | `{ valid: boolean, message?: string }` | `{ results: [{ entry, verdict, value, label, reason }, ...] }`, same length/order as the request's `entries` |
| Gate | Binary — `valid: false` always shows the same confirm UI | 3-state `verdict` — `flag` and `invalid` both gate identically; only `reason`'s copy differs |
| Write on confirm | Always the raw typed text | The agent's own `value`/`label` when non-null; raw text only when both are `null` |
| Timeout | None (platform default) | Explicit ~8000ms, same fallback shape as a real backend failure |
| Pre-check vs. curated options | Not implemented | New — §4 below |
| Post-normalization dedupe | Not implemented | New — §4 below |

The backend side of this is done: `supabase/functions/onboarding-validator-agent/` is built, type-checked, unit-tested (18/18), and live-verified against 19 cases drawn from its own documented worked examples (17 matched first try; the 2 that didn't were re-run twice more to confirm they were genuine, deterministic model judgment calls, not flukes, and the design doc's examples were corrected to match). `config.toml` has `verify_jwt = true` set from first deploy. What's below is the frontend half.

---

## 2. The contract, now live-verified

### Request — batched, one call per `other_capture` submission

```jsonc
POST ${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-validator-agent
Authorization: Bearer <session.access_token>
Content-Type: application/json

{
  "user_id": "...",
  "section": "dishes",             // one of: cuisine_narrow, dishes, allergies, intolerances, favorite_recipes
  "context": { "parent_sub_cuisine": "thai", "diet_type": ["vegan"] },
  "entries": ["som tam", "beef massaman curry"]   // already comma/semicolon/newline-split client-side
}
```

`context`'s shape is per-section — see `ONBOARDING_VALIDATOR_AGENT_DESIGN.md` §4 for exactly what each of the five sections expects (`allergies` gets `{}`; `cuisine_narrow` gets `{ parent_cuisine }`; `dishes` gets `{ parent_sub_cuisine, diet_type }`; `intolerances` gets `{ allergies }`; `favorite_recipes` gets `{ cuisines, favorite_dishes }`).

### Response

```jsonc
{
  "results": [
    { "entry": "som tam", "verdict": "valid", "value": "som_tam", "label": "Som Tam", "reason": null },
    { "entry": "beef massaman curry", "verdict": "flag", "value": "beef_massaman_curry",
      "label": "Beef Massaman Curry", "reason": "Contains beef — you told us you're vegan. Still want to add it?" }
  ]
}
```

`results` is always the same length and order as `entries` — match by position, not by re-parsing `entry` (though it is echoed back verbatim for sanity-checking).

### Control flow — the part that actually drives your UI

| `verdict` | What it means | What the UI does |
|---|---|---|
| `valid` | Agent agrees with the user | **Nothing.** Accept silently, no confirm step. |
| `flag` | Plausible, but worth a second look | Show `confirm_or_correct` |
| `invalid` | Doesn't look like a real answer for this section | Show `confirm_or_correct` |

`flag` and `invalid` render through the **identical** UI — the same confirm-or-correct component, the same two buttons. Nothing should branch on which of the two it is; the only difference is the tone of `reason`'s copy. Do not build a "soft warning" state and a "hard rejection" state — there is only one non-`valid` UI state.

**`reason` is the text you show — not the node's static fallback message.** The onboarding flow config (`content/onboarding/flow-structure.yaml`, per `ONBOARDING_VALIDATOR_AGENT_CONTRACT.md` §2) still carries a static `on_invalid.message` per node — e.g. "is that a dish, not a cuisine?" for `dishes`. That's the fallback **only** when `reason` comes back `null` (a total-failure or timeout case — see §3). Whenever `reason` is a string, render it as-is; it's already written as a complete, user-facing sentence.

**On confirm, write the agent's own `value`/`label` — never re-derive anything client-side.** This is the one rule that's easy to get subtly wrong: the old behavior ("user confirmed → write what they typed") is *not* what confirm means now. See §5 for exactly what to write per section — it differs for `favorite_recipes`.

### Two guarantees, verified live, that your UI can rely on

- **`allergies` never returns `verdict: "invalid"`.** At most `flag`. Never build an allergies-specific "that's not a real allergen" hard-rejection copy — the backend is deliberately permissive here (a missed allergy is a safety issue; an odd-looking one making it through unconfirmed isn't). Verified across 4 live cases including deliberately weird ones (`"bee stings"` → `valid`, a bare `"197"` → `flag`, never `invalid`).
- **`favorite_recipes` always returns `value: null`**, on every verdict, including `valid`. This section has no slug/enum concept — its target is a recipe `title`, not an array of curated values. If your dedupe or selection-state logic keys off `value` anywhere, it needs a `favorite_recipes` branch that uses `label` instead (see §4). Verified across all 3 live `favorite_recipes` cases.

---

## 3. Timeout — and matching the backend's own failure shape exactly

Wrap the fetch in an explicit timeout (~8000ms recommended — real onboarding round trips in this environment run 1.7–2.5s for plain content reads; an LLM call with `thinkingBudget: 1024` needs real headroom, but still needs to be bounded).

**A client-side timeout must produce the exact same shape the backend produces on its own total failure** — `flag`/`null`/`null`/`null` per entry, never a divergent "just accept it" path. This isn't a suggestion to approximate; here's the backend's own fallback function, verbatim, so both sides stay byte-identical:

```ts
// Mirrors supabase/functions/onboarding-validator-agent/index.ts's totalFailureFallback()
// exactly. `flag` is the only verdict safe to apply uniformly across all five sections —
// `invalid` would violate the allergies guarantee above; `valid` would silently accept
// unvalidated data.
function timeoutFallback(entries: string[]) {
  return entries.map((entry) => ({
    entry, verdict: 'flag' as const, value: null, label: null, reason: null,
  }))
}
```

```ts
async function callValidator(payload: ValidateRequest, timeoutMs = 8000): Promise<{ results: EntryResult[] }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) return { results: timeoutFallback(payload.entries) }
    return await res.json()
  } catch {
    // AbortError (timeout) and any network failure both land here — same fallback either way.
    return { results: timeoutFallback(payload.entries) }
  } finally {
    clearTimeout(timer)
  }
}
```

---

## 4. Two pieces the contract doc left unbuilt — a concrete design for both

`ONBOARDING_VALIDATOR_AGENT_CONTRACT.md` §5 flags these as "not implemented" and points at `ONBOARDING_VALIDATOR_AGENT_DESIGN.md` §7 without further detail. Here's an actual design for both, since they gate whether the backend's own scope assumptions hold.

### 4.1 Pre-check — before calling the validator at all

Design doc §7 item 1: *"If the typed text already matches a known `{value, label}` option, it's a plain selection, not a custom entry — no call to this agent at all."* The screen already has the rendered option list in memory (it's what drew the cards/checkboxes), so this is a pure client-side string match, no network call:

```ts
// Run on each comma/semicolon/newline-split piece BEFORE it goes into the batch.
// Matches on label, case/whitespace-insensitive — that's what the user is visually
// comparing against when they type "thai" and a card already says "Thai".
function matchesExistingOption(
  piece: string,
  renderedOptions: Array<{ value: string; label: string }>,
): { value: string; label: string } | null {
  const normalized = piece.trim().toLowerCase()
  return renderedOptions.find((o) => o.label.trim().toLowerCase() === normalized) ?? null
}

function partitionOtherEntries(
  pieces: string[],
  renderedOptions: Array<{ value: string; label: string }>,
) {
  const directSelections: string[] = []   // values to toggle as if the card was tapped
  const needsValidation: string[] = []    // goes into the batched entries[] request
  for (const piece of pieces) {
    const match = matchesExistingOption(piece, renderedOptions)
    if (match) directSelections.push(match.value)
    else needsValidation.push(piece)
  }
  return { directSelections, needsValidation }
}
```

Apply `directSelections` by toggling those options' selection state directly (same code path a real tap on that card would trigger); send only `needsValidation` to the validator. If `needsValidation` ends up empty, skip the network call entirely.

### 4.2 Post-normalization dedupe — after the validator returns

Design doc §7 item 2: *"After this agent returns a normalized `value`, the caller checks whether that slug already exists in the rendered option list before appending it."* This is what catches "typed 'Thai', agent normalizes to `thai`, which is already a curated card's value" — the pre-check above only catches exact label matches; this catches the case where the *typed* text didn't match anything but the *normalized* slug does.

```ts
// Run per accepted entry (auto-valid, or user-confirmed flag/invalid), AFTER normalization,
// BEFORE writing to memory. Does not apply to favorite_recipes — that section's `value` is
// always null (§2), so there's no slug to dedupe against; use matchesExistingOption() on
// `label` there instead if you want equivalent duplicate protection for recipe titles.
function alreadyCurated(
  value: string,
  renderedOptions: Array<{ value: string; label: string }>,
): boolean {
  return renderedOptions.some((o) => o.value === value)
}
```

If `alreadyCurated` is true, select the existing option instead of appending a redundant custom entry.

**Known, accepted gap (matches the design doc's own §8):** this won't catch a near-duplicate where normalization differs slightly from a curated slug (e.g. `"thai food"` → `thai_food`, curated table already has `thai`). Not worth building a fuzzy-match layer for — same risk tolerance as the comma-split's own known limitation.

---

## 5. `lib/onboarding/engine.ts` — the write path, designed

The contract doc explicitly punted on this ("needs its own design pass, not assumed here"). The core problem: `appendUnique(memory, appends_to, p)` today takes one plain string. The new contract needs a **per-section dispatch**, because `favorite_recipes`' target shape is a recipe object array, not a string array — same exception the design doc's own options contract documents everywhere else in this flow.

```ts
interface EntryResult {
  entry: string
  verdict: 'valid' | 'flag' | 'invalid'
  value: string | null
  label: string | null
  reason: string | null
}

// Every section EXCEPT favorite_recipes: target is a plain slug array
// (dietary.allergies, dietary.intolerances, taste_profile.sub_cuisines,
// taste_profile.favorite_dishes). Per design doc §3 step 2: value is what gets written
// when present — it's already the agent's own normalization, never re-derived here.
// Raw entry text is the fallback ONLY when value is null (pre-tier reject or timeout/
// total-failure — never "user disagreed with a flag", since confirming a flag/invalid
// result still uses that same result's own value when one exists).
function acceptOtherEntry(memory: UserMemory, appendsTo: string, result: EntryResult) {
  const slug = result.value ?? result.entry.trim()
  appendUnique(memory, appendsTo, slug)
}

// favorite_recipes exception (design doc §2/§4.5): value is ALWAYS null for this
// section — there is no slug concept, the target is meal_planning_preferences.
// preferred_recipes[].title. label (or, failing that, the raw entry) becomes the
// title directly; recipe_uuid stays unresolved until n_compile.
function acceptFavoriteRecipeEntry(memory: UserMemory, result: EntryResult) {
  const title = result.label ?? result.entry.trim()
  const preferred = memory.meal_planning_preferences.preferred_recipes
  if (preferred.some((r) => r.title.toLowerCase() === title.toLowerCase())) return
  preferred.push({ title, recipe_uuid: null, has_side: false, sides: [] })
}

export function acceptValidatedEntry(
  memory: UserMemory,
  section: string,
  appendsTo: string,
  result: EntryResult,
) {
  if (section === 'favorite_recipes') acceptFavoriteRecipeEntry(memory, result)
  else acceptOtherEntry(memory, appendsTo, result)
}
```

**Flagged, not resolved — worth confirming before this ships, not guessing at:** `onboarding_flow.yaml`'s own header note says a split custom entry should be "tagged `source: user_custom` individually," but the actual target arrays (per `user_memory_sample_filled-updated.json`) are plain string arrays (`taste_profile.sub_cuisines: ["thai", "indian", "italian"]`) with no field to carry that tag on. I did not invent a schema change (turning a string array into `{value, source}` objects) to make this fit — that's a real decision for whoever owns `user_memory.json`'s schema, not something to resolve silently in `engine.ts`. If `source: user_custom` genuinely needs to be queryable later, it more likely belongs in the flow-position history stack (design doc's §10 in the original design notes) than inline in profile data — but that's a recommendation, not a confirmed answer.

---

## 6. `app/onboarding/_components/MultiSelect.tsx`

Per the contract doc, `checkingOther`'s loading state is already correct and needs no changes — it covers a single batched call exactly as well as it covered per-entry ones. What changes:

- The submit handler batches the split pieces (after the §4.1 pre-check removes direct matches) into one `callValidator` call instead of `Promise.all`-ing one call per piece.
- The confirm/correct UI switches from `if (!result.valid)` to `if (result.verdict !== 'valid')`; render `result.reason ?? node.on_invalid.message` as the copy.
- The confirm button's handler calls `acceptValidatedEntry(memory, section, appendsTo, result)` (§5) — not a raw-text write.
- **What happens on "correct"** (the user retypes instead of confirming) is explicitly left as a frontend-owned decision in the design doc (§3 step 3: *"whether/how a correction re-enters this agent for re-validation is a flow/caller-level decision, not something this agent does or tracks"*). Recommendation: re-run the corrected text through the same validate → §4.1 pre-check → confirm cycle rather than accept it unchecked — consistent with everything else in this flow trusting the validator's judgment, not the user's self-correction, as the final gate. Not implementing that automatically here would mean "correct" behaves differently from "type it right the first time," which is worth avoiding.

---

## 7. Test fixtures — real, live-verified pairs, not invented mocks

Every pair below is an actual response from `gemini-2.5-flash` via the real, shipped prompt, captured 2026-09-18. Use these directly in unit/integration tests rather than hand-writing mock shapes — they cover a `valid`/`flag`/`invalid` case for every section, plus the two guarantees from §2.

```jsonc
// cuisine_narrow, context: { parent_cuisine: "european" }
{ "entry": "Albanian", "verdict": "valid", "value": "albanian", "label": "Albanian", "reason": null }
{ "entry": "Thai", "verdict": "flag", "value": "thai", "label": "Thai",
  "reason": "Thai cuisine is typically considered an Asian cuisine. Do you still want to add it under European?" }
{ "entry": "beef stroganoff", "verdict": "invalid", "value": "beef_stroganoff", "label": "Beef Stroganoff",
  "reason": "This looks like a specific dish, not a cuisine. You can add specific dishes to your favorite recipes." }

// dishes, context: { parent_sub_cuisine: "thai", diet_type: ["vegan"] }
{ "entry": "beef massaman curry", "verdict": "flag", "value": "beef_massaman_curry", "label": "Beef Massaman Curry",
  "reason": "This dish contains beef, but you told us you're vegan. Still want to add it?" }
// dishes, context: { parent_sub_cuisine: "italian", diet_type: [] }
{ "entry": "Italian", "verdict": "invalid", "value": null, "label": null,
  "reason": "That looks like a cuisine name, not a specific dish. Please try entering a dish name instead." }
// dishes, context: { parent_sub_cuisine: "thai", diet_type: ["pescatarian"] }
{ "entry": "pad see ew", "verdict": "valid", "value": "pad_see_ew", "label": "Pad See Ew", "reason": null }

// allergies, context: {} — the never-invalid guarantee
{ "entry": "sesame", "verdict": "valid", "value": "sesame", "label": "Sesame", "reason": null }
{ "entry": "bee stings", "verdict": "valid", "value": "bee_stings", "label": "Bee Stings", "reason": null }
{ "entry": "197", "verdict": "flag", "value": null, "label": null,
  "reason": "This doesn't look like an allergy. Can you clarify?" }

// intolerances, context: { allergies: ["dairy"] }
{ "entry": "hard cheese", "verdict": "flag", "value": "hard_cheese", "label": "Hard Cheese",
  "reason": "You told us you have a dairy allergy, but 'hard cheese' is a dairy product. Should this be on your intolerances list or your allergies list?" }
// intolerances, context: { allergies: ["none"] }
{ "entry": "italian", "verdict": "invalid", "value": "italian", "label": "Italian",
  "reason": "Italian is a cuisine, not a specific food or ingredient you can be intolerant to. Did you mean something else?" }

// favorite_recipes, context: { cuisines: ["thai"], favorite_dishes: [] } — value is ALWAYS null
{ "entry": "massaman", "verdict": "flag", "value": null, "label": "Massaman",
  "reason": "Massaman is a type of curry. Could you tell us the specific dish or ingredients you mean, like 'Chicken Massaman Curry'?" }
// favorite_recipes, context: { cuisines: ["mediterranean"], favorite_dishes: ["hummus"] }
{ "entry": "kqjwbf 2837", "verdict": "invalid", "value": null, "label": null,
  "reason": "This doesn't look like a real dish or recipe." }
```

---

## 8. Rollout

The backend is fully built and independently verified — nothing on that side is blocking. Suggested sequence for the frontend cutover:

1. Point a staging build at the real `onboarding-validator-agent` function (it's already deployed-shape in this repo, `verify_jwt = true`) and run the §7 fixtures' *inputs* through the real live function once more as an integration smoke test, rather than only unit-testing against the captured outputs above.
2. Cut `lib/onboarding/validate-other.ts` over directly — this is a straight replacement, not a parallel-run. The old FastAPI backend (`AGENT_API_URL`) has no reason to keep receiving traffic once the new response shape ships; per `ONBOARDING_VALIDATOR_AGENT_CONTRACT.md`'s own framing, the old caller's defensive `{valid: true, stubbed: true}` fallback would silently no-op forever against the new response shape anyway if both were left running.
3. Watch `tbl_agent_debug_log` (filtered to `agent_name = 'Onboarding Validator Agent'`) for the first real traffic — `AgentLogger.flush` writes one row per request, including the full turn log, so a bad rollout is diagnosable from that table alone without needing to reproduce it locally.
