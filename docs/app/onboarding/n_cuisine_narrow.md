# n_cuisine_narrow — "Nice — within {item}, anything specific?"

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/MultiSelect.tsx` (default list layout) · Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-cuisine-table-source.mjs` (options and labels from
`tbl_cuisines_onboarding`); `scripts/onboarding-seed/smoke-test.ts` scenario A
(`n_cuisine_narrow[asia_oceania]` answered as its own iteration) and scenario B (zero iterations after
a defaulted `n_cuisine_broad`)

One screen per broad cuisine the user picked, offering that cuisine's sub-cuisines. Vertical
option list plus free-text "Other".

## Behaviour

- **`repeat_for: taste_profile.cuisines`** — one iteration per selected cuisine, each with its
  own history entry and its own Back step. Zero iterations when `n_cuisine_broad` fell through
  to `default_if_empty`. See [`_shared/repeat-for.md`](../_shared/repeat-for.md).
- **Options are resolved per iteration** from `curated:cuisine.sub_cuisines`, keyed by `{item}`
  (`resolution_order` tier 1). Every broad cuisine in the curated table carries an `Other`
  option of its own, which is what opens the free-text field.
- **Tiers 2 and 3 are stubs.** `get_sub_cuisines` and `web_search_cuisines` return `[]` —
  `resolvers.ts` skips `type: tool` tiers outright. A cuisine with no curated row renders an
  empty list, not a fallback lookup.
- **Soft ask: no Skip button, no required selection.** The node is neither `optional` nor
  `require_selection`, so `MultiSelect` renders no Skip and leaves Continue enabled. Submitting
  nothing is valid and writes nothing — see `MultiSelect.tsx`'s header note on repeat_for-scoped
  nodes.
- **`skip_if: "item == 'other'"`** skips to the next cuisine rather than out of the node. It's
  defensive: `writeNodeAnswer` already filters the `other` trigger value out of
  `taste_profile.cuisines`.
- **"Other" runs the validator gate** — section `cuisine_narrow`, context
  `{parent_cuisine: "{item}"}`, resolved server-side by `/api/onboarding/validate-other` from the
  `item` the client posts. `flag` is a normal "are you sure?"; `invalid` is hard-blocked. See
  [`_shared/validator-gate.md`](../_shared/validator-gate.md).

## Exceptions & gotchas

**`{item}` interpolates the raw slug, not a label.** `engine.interpolate` substitutes the bare
value, so the prompt renders as "Nice — within latin_american, anything specific?" for every
multi-word cuisine. `n_pairing_cards` avoids this only because it has its own `{dish}`
placeholder resolved through `findPairingDish`; there is no equivalent here.

**`other_capture.on_invalid_message` is not interpolated at all.** `renderNode` interpolates
`other_capture.prompt` only, so the stored copy ("…is that really within {item}?") would render
with a literal `{item}`. It is only ever shown as a fallback for a null `result.reason`, which
the validator contract says should be unreachable.

**`taste_profile.sub_cuisines` is one flat array across every iteration.** Nothing records which
parent cuisine a sub-cuisine came from. `n_dishes` iterates that flat list, and the
parent-cuisine relationship survives only inside `curated:cuisine.sub_cuisines`.

## Depends on

- Content: `node:n_cuisine_broad`'s answer (the iteration source); `node:n_cuisine_narrow`
  (prompt and `other_capture` copy only — it carries no options)
- Curated: `curated:cuisine.sub_cuisines`, keyed by broad cuisine
- Agent section: `cuisine_narrow`

## Writes

- `taste_profile.sub_cuisines` — curated values from every iteration, plus validated "Other"
  entries (the agent's normalised `value`)
- `other.cuisine_narrow` — the same custom entries, staged for the future stage-2 matching pass

## Downstream

`taste_profile.sub_cuisines` is `n_dishes`' `repeat_for` target, so each sub-cuisine picked here
becomes one dish screen.

## Decisions

- "Other" validated before submit, per comma-split piece — [2026-09-17](../../diary_log/2026-09-17.md#other-entry-workflow)
- Staging in `memory.other.<section>` — [2026-09-17](../../diary_log/2026-09-17.md#other-entry-workflow)
- Rejected entries can't be forced through; only flagged ones — [2026-09-19](../../diary_log/2026-09-19.md#entry-checking)
