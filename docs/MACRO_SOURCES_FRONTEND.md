# Macro-Source Sections (`protein_source` / `carb_source` / `fat_source`) — Frontend Implementation Guide

Companion to [`FRONTEND.md`](./FRONTEND.md) (the whole-agent integration guide — shared plumbing: transport, timeout, the `engine.ts` write path, `MultiSelect.tsx`) and [`CONTRACT.md`](./CONTRACT.md) (transport/auth ground truth). This document is scoped to exactly one feature: the three new "Other" entry validation screens for picking protein, carb, and fat sources during onboarding. Read this if you're building or reviewing that specific screen. Read `FRONTEND.md` for the shared mechanics all nine sections use — this doc doesn't repeat those, only what's specific to these three.

Backend design/reasoning: [`SPEC.md`](./SPEC.md) §4.7. Design decisions and open questions: [`DECISIONS.md`](./DECISIONS.md), 2026-09-24 entry.

**Status as of 2026-09-25: backend built, config not yet confirmed deployed, not yet live-tested from either side.** Treat every example below as a specification, not a confirmed live result — see §8 before you build anything that's costly to change later.

---

## 1. What's being added

Three new `section` values on the existing `onboarding-validator-agent` endpoint — no new endpoint, no new transport, no new auth. If you've already wired up any of the other six sections (`cuisine_narrow`/`dishes`/`allergies`/`intolerances`/`favorite_recipes`/`diet_styles`), this is the same call shape with a new `section` value and a section-specific `context`.

Each screen lets the user type a freeform food/ingredient into an "Other" box for one macro category. This agent checks: is it actually a food, is it a real source of *that* macro, does it contradict something they already picked on one of the other two macro screens, and does it genuinely straddle two macros at once (legumes are both a carb and a protein source) — surfacing that last case as a one-tap confirm, never a hard block.

## 2. Transport & auth — unchanged

Identical to every other section. See CONTRACT.md §1 for the full write-up; the short version:

```
POST ${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-validator-agent
Authorization: Bearer <session.access_token>
Content-Type: application/json
```

Server-side call only — a Next.js API route resolves the session via `supabase.auth.getSession()` and forwards the bearer token; never called directly from the client. `user_id` is spliced into the body server-side, same as `chat`/`optimise`/every other section here.

## 3. Request contract

One call per macro-source "Other" submission — same batching rule as every other section: all comma/semicolon/newline-split entries from one submission go in one request, never one call per entry.

```jsonc
{
  "user_id": "...",
  "section": "protein_source",     // or "carb_source" / "fat_source"
  "context": { "carb_sources": ["white rice"], "fat_sources": [] },
  "entries": ["chicken breast", "black beans"]
}
```

`context` is the one thing that differs across the three sections — each receives the user's already-confirmed items in the *other* two macro categories, never its own:

| `section` | `context` shape |
|---|---|
| `protein_source` | `{ carb_sources: string[], fat_sources: string[] }` |
| `carb_source` | `{ protein_sources: string[], fat_sources: string[] }` |
| `fat_source` | `{ protein_sources: string[], carb_sources: string[] }` |

Both arrays may be empty — send `[]`, not `null` or an omitted key, matching this agent's existing convention everywhere else (e.g. `allergies` always sends `context: {}`, never omits `context`).

**Where do these arrays come from?** The user's own already-confirmed picks on the *other two* macro-source screens — both curated-list selections and previously-accepted "Other" entries (this agent's own past `value`/`label`, or whatever label you display for a curated pick). This is client-side state you're presumably already tracking across the three screens in this onboarding step; send it as-is, no extra server round-trip needed to assemble it.

**`entries` are plain strings** — the freeform text the user typed, already split on comma/semicolon/newline by your existing `splitOtherText` logic (§6 below), same contract as every other section.

## 4. Response contract — unchanged shape, no new fields

Identical to every non-`favorite_recipes` section: `verdict`/`value`/`label`/`reason`, same length and order as `entries`. No `split_into` — that field is `diet_styles`-only.

```jsonc
{
  "results": [
    { "entry": "chicken breast", "verdict": "valid", "value": "chicken_breast", "label": "Chicken Breast", "reason": null },
    { "entry": "black beans", "verdict": "flag", "value": "black_beans", "label": "Black Beans",
      "reason": "Black beans are a source of both protein and carbs — want them counted here, under carbs, or both?" }
  ]
}
```

## 5. Verdict → UI behavior — same rules as every section, worked for this feature specifically

This is the part most worth double-checking, since it's shared logic you may already have built for the other six sections — if so, treat this table as confirmation you don't need anything new, not a new spec to implement.

| Verdict | What it means here | UI |
|---|---|---|
| `valid` | Real, meaningful source of this macro, no conflict with anything already picked. | Silent — no gate. Entry is written immediately using the returned `value`/`label`. |
| `flag` | Real and plausible, but worth a one-tap check — either (a) a genuine dual-macro food (legumes, nuts, full-fat dairy, fatty fish), or (b) the same item is already recorded under one of the other two macros. | Confirm-or-correct: user can accept as typed (writes the returned `value`/`label`) or retype. |
| `invalid` | Not a food at all, or a real food with no meaningful amount of *this* macro — wrong screen entirely. | Correction-required — no accept-as-is option. `reason` will usually name which screen it actually belongs on. |

The general mechanics (what "confirm-or-correct" vs. "correction-required" actually render, what a retype does, the raw-text fallback on total call failure) are unchanged — see SPEC.md §3 / FRONTEND.md §2. Nothing about this table is macro-source-specific; it's the same three-verdict contract, worked through for this feature's own cases.

## 6. Worked examples

Five request/response pairs, each exercising one branch of this section's logic (SPEC.md §4.7's 5-step check) — useful as fixtures if you're writing tests against a mock before the real endpoint is confirmed live (§8):

**1. Not a food at all → `invalid`**
```jsonc
// request: { section: "protein_source", context: { carb_sources: [], fat_sources: [] }, entries: ["rocks"] }
{ "entry": "rocks", "verdict": "invalid", "value": "rocks", "label": "Rocks",
  "reason": "That's not a food — what's the actual protein source you had in mind?" }
```

**2. Real food, wrong macro entirely → `invalid`**
```jsonc
// request: { section: "carb_source", context: { protein_sources: [], fat_sources: [] }, entries: ["game meat"] }
{ "entry": "game meat", "verdict": "invalid", "value": "game_meat", "label": "Game Meat",
  "reason": "Game meat isn't a meaningful carb source — that belongs under protein sources instead." }
```

**3. Genuine dual-macro food → `flag`, NOT rejected**
```jsonc
// request: { section: "carb_source", context: { protein_sources: [], fat_sources: [] }, entries: ["black beans"] }
{ "entry": "black beans", "verdict": "flag", "value": "black_beans", "label": "Black Beans",
  "reason": "Black beans are a source of both carbs and protein — want them counted here, under protein, or both?" }
```

**4. Same item already recorded under a different macro → `flag`**
```jsonc
// request: { section: "fat_source", context: { protein_sources: ["chicken breast"], carb_sources: [] }, entries: ["chicken breast"] }
{ "entry": "chicken breast", "verdict": "flag", "value": "chicken_breast", "label": "Chicken Breast",
  "reason": "You already added chicken breast as a protein source — did you mean to add it here too, or was this meant for protein?" }
```

**5. Ordinary valid case**
```jsonc
// request: { section: "protein_source", context: { carb_sources: [], fat_sources: [] }, entries: ["salmon"] }
{ "entry": "salmon", "verdict": "valid", "value": "salmon", "label": "Salmon", "reason": null }
```

## 7. Caller responsibilities — unchanged, restated for this feature

Same three obligations SPEC.md §7 puts on every caller for every section — this agent has no DB access and structurally cannot do any of these itself:

1. **Pre-check against the curated option list.** If the typed text already matches a curated protein/carb/fat option shown on that screen, it's a plain selection — skip this agent entirely, no call needed.
2. **Post-normalization dedupe.** Once a normalized `value` comes back, check it isn't already in the curated list *or* already confirmed under this same macro before appending it. (A cross-macro duplicate is what this agent's own `flag` case 4 already catches for you — a same-macro duplicate is still entirely your job, same as every other section.)
3. **Comma/semicolon/newline split.** `entries[]` must already be split before calling — this agent never sees a raw joined string.

## 8. Known gaps — read before treating this as gospel

- **Not live-tested.** Every response in §6 is a prediction from the prompt design, not a confirmed model output — unlike every other section here, which has at least one round of live verification behind it (see DECISIONS.md's entries for `cuisine_narrow`/`diet_styles` for what that process looks like). If production doesn't match §6 exactly, that's the more likely explanation, not a client-side bug — flag it back rather than trying to work around it silently.
- **Section slugs (`protein_source`/`carb_source`/`fat_source`) are not confirmed against `onboarding_flow.yaml`'s own node naming** — this repo doesn't contain that file. Worth knowing before you commit to these exact strings in your routing/interpolation code: this specific question has a documented false start already (DECISIONS.md, 2026-09-18) — `accepted_protein`/`accepted_carbs`/`accepted_fat` were checked against the flow back then and found to have no live `other_capture` wiring at all at that time. Confirm current flow-file state before wiring anything up around these slugs or the guessed `variety_rules.{protein,carb,fat}_variety.rotation` write target (SPEC.md §4.7) — nothing on the backend depends on getting this right, since it's prompt framing only, but your routing code will.
- **No reference-table backstop**, unlike `diet_styles`/`cuisine_narrow` (SPEC.md §8) — the model reasons from its own knowledge on every call, with no code-level correction if it slugs the same food two different ways across two separate calls. Don't build anything (a client-side cache keyed by `value`, say) that assumes byte-identical output for the same food entered twice.
- **Scope note on sourcing**, same caveat as `FRONTEND.md`: this repo doesn't contain `zestil-frontend`, so nothing above is checked against real client files — adapt it to whatever currently surrounds your other-section calling code (`lib/onboarding/validate-other.ts`, `app/onboarding/_components/MultiSelect.tsx`, `lib/onboarding/engine.ts`, per `CONTRACT.md` §5's file list).
