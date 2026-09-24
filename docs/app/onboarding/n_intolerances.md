# n_intolerances — "…anything you can tolerate a little of, just not a lot?"

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/MultiSelect.tsx` (default list layout) · Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-intolerances-none.mjs` (browser: no Skip button,
symmetric disable/re-enable), `scripts/onboarding-seed/smoke-test.ts` scenario M (option wiring
and the `none` write), scenario I (hard-excludes union with allergies downstream)

Vertical list of common intolerances plus free-text "Other". Feeds the hard-exclude sources on
the three macro decks.

## Behaviour

- **"I don't have any" is a real option, not a skip.** It is `value: none` in
  `curated:intolerance.common` (`id_order: 70`, with `Other` at `80`), wired as the node's
  `exclusive_value`. There is **no Skip button on this screen at all** — the node is not
  `optional`, and `MultiSelect` renders Skip only under `{node.optional && …}`.
- **`require_selection: true`.** Continue stays disabled until something meaningful is picked.
  Same reasoning as `n_allergies`: there is always a valid answer available, so an empty
  submission would be indistinguishable from an unanswered one. Selecting "Other" with an empty
  text box does not count (`meaningfulSelectionCount`).
- **`exclusive_value: none` is symmetric.** Picking it clears and *disables* every other option,
  "Other" included; picking any real intolerance clears and disables it back. Client-side only —
  the two states can never coexist in what gets submitted, so no server check is needed.
- **`none` is written literally.** `dietary.intolerances` ends up as `["none"]`, like any other
  selection. Downstream lookups simply find no `curated:intolerance_macro.exclusions` row for
  it.
- **Options are `always_merge` only, with no `resolution_order`.** The screen shows exactly
  `curated:intolerance.common` — `lactose`, `gluten_sensitivity`, `fructose`, `histamine`,
  `caffeine`, `spicy_food`, `none`, `other` — regardless of what was answered on `n_allergies`.
  The `curated:intolerance.by_allergen` section still exists in content but nothing reads it.
- **"Other" runs the validator gate** — section `intolerances`, context
  `{allergies: "{dietary.allergies}"}`. That path is the canonical reason
  `/api/onboarding/validate-other` resolves context server-side: the client rendering this node
  has no access to it. See [`_shared/validator-gate.md`](../_shared/validator-gate.md).

## Exceptions & gotchas

**`free_text_note_field: dietary.notes` has no UI.** The structure declares it, `applyAnswer`
honours it (`answer.text` → `dietary.notes`), and `collectWriteTargets` snapshots it for Back —
but `MultiSelect` never renders a note input and never sends `text`. Today only scripted answers
write `dietary.notes` (smoke-test scenario A does). The prompt's "(e.g. small amounts of hard
cheese)" currently has no box to type into.

**Both `none` values in the flow are the same string.** `n_allergies` uses `exclusive_value:
none` for "None of these" and this node for "I don't have any". They are separate fields, so
nothing collides, but a grep for `"none"` spans both.

## Depends on

- Content: `node:n_intolerances` (prompt and `other_capture` copy only — the option list is not
  in this row); `curated:intolerance.common` (the whole option list)
- `dietary.allergies` — validator context only, not the option list
- Agent section: `intolerances`

## Writes

- `dietary.intolerances` — selected values (including the literal `none`), plus validated
  "Other" entries (the agent's normalised `value`)
- `other.intolerances` — the same custom entries, staged for the future stage-2 matching pass
- `dietary.notes` — declared, currently unwritable from the UI (see above)

## Downstream

`dietary.intolerances` is a `hard_exclude_source` on all three exclusion decks
(`n_protein_exclusion_cards`, `n_carb_exclusion_cards`, `n_fat_exclusion_cards`) via
`curated:intolerance_macro.exclusions`. Hard-excludes **union** with the allergy source rather
than intersecting — two sources pointing at the same value still exclude it exactly once
(smoke-test scenario I covers a nuts allergy and a peanut-traces intolerance both landing on
`nut_seed_fats`). Excluded options render **disabled, not removed**.

A custom "Other" intolerance has no row in `curated:intolerance_macro.exclusions` and so
excludes nothing — the same known gap described in the validator-gate doc.

## Decisions

- "I don't have any" is an option, not a Skip button — [2026-09-18](../../diary_log/2026-09-18.md#intolerances)
- Intolerance suggestions by allergen removed; only the common list is shown — [2026-09-17](../../diary_log/2026-09-17.md#onboarding-engine-fixes)
- Exclusive-selection symmetry — [2026-09-17](../../diary_log/2026-09-17.md#onboarding-engine-fixes)
- "Other" validated before submit, staged in `memory.other.<section>` — [2026-09-17](../../diary_log/2026-09-17.md#other-entry-workflow)
