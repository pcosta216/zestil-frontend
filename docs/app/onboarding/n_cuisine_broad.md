# n_cuisine_broad — "Which cuisines do you gravitate toward?"

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/MultiSelect.tsx` (`layout: grid`) · Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-cuisine-broad-gating.mjs` (Continue gating, empty skip);
`scripts/onboarding-seed/smoke-test.ts` scenario B (skip → empty
cuisine list → zero downstream iterations), scenario A (a real pick driving
`n_cuisine_narrow`/`n_dishes`), scenarios K and L (the picked list feeding the pairing sample)

Two-column tap grid of broad cuisine regions. The single most load-bearing answer in the flow:
`taste_profile.cuisines` drives `n_cuisine_narrow`'s iterations, `n_dishes` through them, and
`n_pairing_cards`' sample.

## Behaviour

- **Continue requires a pick; Skip is the "no preference" path.** `require_selection: true`
  keeps Continue disabled until at least one region is selected, so the two controls mean
  different things. `optional: true` keeps Skip available.
- **Skipping records nothing.** There is no `default_if_empty` — `taste_profile.cuisines` stays
  `[]` rather than gaining a cuisine the user never chose. Downstream consumers must read an
  empty list as "no signal"; the `favorite_recipes` validator context already allows for it.
- **An empty cuisine list runs zero downstream iterations.** `n_cuisine_narrow` and `n_dishes`
  have nothing to iterate over, so the flow goes straight to `n_allergies`, and
  `n_pairing_cards`' sample comes out empty and is bypassed too. Skipping this one screen
  therefore removes three screens' worth of flow. See
  [`_shared/repeat-for.md`](../_shared/repeat-for.md).
- **`taste_profile.cuisines` is append-only per submission.** `writeScalarOrArray` →
  `appendUnique` against the array target; the `other` trigger value is filtered out before the
  write, so the placeholder never reaches memory.
- **"Other" never reaches the validator agent.** Section `cuisine_broad` is deliberately out of
  scope — see below.

## The `cuisine_broad` section is out of validator scope

`other_capture` declares the same `validation` block every other node does, but
`lib/onboarding/validator-sections.ts` does not list `cuisine_broad`, so
`validateEntries` short-circuits at `isValidatorSection` and returns
`syntheticResults(entries, "valid")` — verdict `valid`, `value`/`label`/`reason` all `null`. No
network call is made at all.

Downstream effects of that synthesis, all deliberate:

- Nothing is ever flagged or blocked here: `MultiSelect` sorts every result into `accepted`, so
  no review rows render and Continue is never gated.
- With `value === null`, `applyAnswer` writes `r.entry.trim()` — the **raw typed text**, not a
  normalised slug. The same raw text is staged at `other.cuisine_broad`.

The reason is scope, not cost: the agent exists for lists that are deliberately non-exhaustive
and need reasoning about something outside the curated set. A closed set of world regions isn't
that. The Edge Function also keeps its own hardcoded allowlist and 400s on unknown sections, so
adding `cuisine_broad` here would not make it callable. See
[`_shared/validator-gate.md`](../_shared/validator-gate.md).

## Exceptions & gotchas

**The live content row has no `other` tile, so the free-text box can't be opened.**
`node:n_cuisine_broad` in `tbl_onboarding_content` lists exactly six options — `asian`,
`latin_american`, `middle_eastern`, `african`, `european`, `american`. `MultiSelect` opens the
`other_capture` field only when the trigger option is selected, or via `needsAlternative`, which
applies solely to `select_all_by_default` decks. Neither can happen here. The `other_capture`
block, and everything above about the out-of-scope section, is wiring that only becomes
reachable if an `other` option is added back to that row.
`content/onboarding/node_copy.yaml:93` still lists `mediterranean` and `other`; the DB row is
what renders (`render-node.ts` reads options from content only).

**`mediterranean` is not an offered tile either, and nothing else writes it.** With no
`default_if_empty` on this node, there is no path that puts `mediterranean` into
`taste_profile.cuisines` at all, so `curated:cuisine.sub_cuisines.mediterranean` is unreachable
from onboarding. (It remains a valid option on `n_diet_style_cards`, which is a different field
— `dietary.diet_type.preferred` — and keeps its own default.)

**`skip_if: "item == 'other'"` on `n_cuisine_narrow` is defensive.** `writeNodeAnswer` already
strips the trigger value, so `other` shouldn't reach `taste_profile.cuisines` in the first
place.

## Depends on

- Content: `node:n_cuisine_broad` (`tbl_onboarding_content`) — prompt, `prompt_instructions`,
  options, `other_capture` copy. No `options_source`, so the row is the whole list.

## Writes

- `taste_profile.cuisines` — the selected values, and nothing at all when skipped
- `other.cuisine_broad` — raw custom entries, staged (unreachable while no `other` tile exists)

## Downstream

- `n_cuisine_narrow`'s `repeat_for` (and `n_dishes` transitively, through `sub_cuisines`)
- `n_pairing_cards`' `sample_from.source`. The sample is keyed to a snapshot of this exact list,
  so changing the answer on a rewind recomputes the pairing dishes.

## Decisions

- Cuisine is a tap grid, not swipe cards — [2026-09-16](../../diary_log/2026-09-16.md#onboarding-content-cuisine-and-diet-style)
- The validator agent covers only the five deliberately-incomplete lists — [2026-09-18](../../diary_log/2026-09-18.md#entry-checking-agent)
- "Other" entries staged in `memory.other.<section>` — [2026-09-17](../../diary_log/2026-09-17.md#other-entry-workflow)
