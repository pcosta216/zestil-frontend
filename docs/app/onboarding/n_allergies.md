# n_allergies — "Any allergies we should know about?"

Status: live · Last verified: 2026-09-23
Component: `app/onboarding/_components/MultiSelect.tsx` · Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-allergy-edit-loop.mjs` (the confirm-gate edit revert),
`scripts/onboarding-seed/smoke-test.ts` scenarios I (hard-exclude union) and O (edit rewind),
`scripts/onboarding-seed/verify-back-recalls-answers.mjs` (what a re-entered screen shows)

Multi-select of common allergens, plus free-text "Other". Feeds a confirmation gate
(`n_allergy_confirm`) and then hard-excludes matching foods from the three exclusion decks
downstream.

**Position is load-bearing.** This runs straight after `n_goal`, ahead of eating styles, cuisines
and dishes — so every later screen has the hard constraints in hand and can filter against them.
Anything that wants to narrow what it offers by allergy or intolerance depends on that ordering;
`n_goal.next` and `n_health_condition_note.next` both point here.

## Behaviour

- **No skip button.** The node isn't `optional`, and `require_selection: true` keeps Continue
  disabled until something is picked. There is always a meaningful answer available — a real
  allergen, or "None of these" — so an empty submission would be indistinguishable from an
  unanswered one.
- **"None of these" is `exclusive_value: none`, symmetric.** Picking it clears and *disables*
  every other option; picking any real allergen clears and disables it back. The two states can
  never coexist in what gets submitted, with no server-side check needed.
- **"Other" runs the validator gate** (`section: allergies`, `context: {}`). See
  [`_shared/validator-gate.md`](../_shared/validator-gate.md).
- **`invalid` is hard-blocked here like everywhere else.** This section *can* return `invalid`
  now (for entries naming nothing usable — "computer", "chair", a person's name). It previously
  could not, and the frontend's block was a no-op. A carve-out downgrading `invalid` → `flag`
  here, as a hedge against wrongly rejecting a genuine allergy, was considered and rejected;
  the rule is uniform.
- **Non-food allergens are `flag`, not `invalid`.** Latex, pollen, insect stings, nickel,
  penicillin — real but unusual, so never auto-accepted and never forced into a rewrite loop.
  Don't build logic treating a non-food allergen as blocked.
- **Always advances to `n_allergy_confirm`**, including on "None of these".

## The confirm gate and its edit branch

`n_allergy_confirm` (`type: confirm_edit`, `editable_fields: [dietary.allergies]`) restates the
list and offers confirm or edit. Data is written on **this screen's** Continue, not on the
gate's confirm — the gate is a read-back of what's already in memory.

"Something's missing or wrong" branches back to `n_allergies`, and that branch is **a rewind,
not a forward move**: `applyAnswer` calls `revertAndTruncateFrom`, which reverts every snapshot
newest-first and truncates the history stack. Without it, re-answering appended on top and the
value the user came back to *remove* survived — `["nuts"]` then correcting to `["dairy"]` left
both.

Going Back from `n_intolerances` skips the gate and lands on `n_allergies` itself — a
confirmation screen isn't a question you can answer differently.

Either way in, the screen re-renders with the answer still on it: the tapped allergies selected,
and any typed entry listed under the free-text field as a removable row. The write is reverted
but the *draft* is not, which is what makes correcting a list possible — see
[`../_shared/back-navigation.md`](../_shared/back-navigation.md).

## Depends on

- Content: `node:n_allergies`, `node:n_allergy_confirm` (`tbl_onboarding_content`, ~60s TTL cache)
- Agent section: `allergies`

## Writes

- `dietary.allergies` — curated values from selection, plus validated "Other" entries
  (the agent's normalised `value`, not the raw typed text)
- `other.allergies` — the same custom entries, staged for the future stage-2 matching pass

## Downstream

`dietary.allergies` is a `hard_exclude_source` on all three exclusion decks
(`n_protein_exclusion_cards`, `n_carb_exclusion_cards`, `n_fat_exclusion_cards`) via
`curated:allergy_macro.exclusions`. Hard-excludes **union** across sources — unlike diet
exclusions, which intersect — because each is an independent constraint that must never be
neutralised by another. Excluded options render **disabled, not removed**, so the user can see
why something is unavailable.

A custom "Other" allergen won't appear in `curated:allergy_macro.exclusions` and so excludes
nothing downstream. Same known gap as everywhere else — see the validator-gate doc.

## Decisions

- Allergies require a selection (no empty submit) — [2026-09-17](../../diary_log/2026-09-17.md#selection-requirements)
- Exclusive-selection symmetry — [2026-09-17](../../diary_log/2026-09-17.md#onboarding-engine-fixes)
- Back skips confirm_edit gates — [2026-09-17](../../diary_log/2026-09-17.md#onboarding-engine-fixes)
- "Other" validated before submit — [2026-09-17](../../diary_log/2026-09-17.md#other-entry-workflow)
- Staging in `memory.other.<section>` — [2026-09-17](../../diary_log/2026-09-17.md#other-entry-workflow)
