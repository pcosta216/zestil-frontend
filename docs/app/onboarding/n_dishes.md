# n_dishes — "And any dishes from {item} you already love?"

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/MultiSelect.tsx` (default list layout) · Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-invalid-no-override.mjs` (the `invalid` hard-block, via
this node), `scripts/onboarding-seed/smoke-test.ts` scenario A (`n_dishes[thai_cuisine]` and
`n_dishes[indian_cuisine]` answered as separate iterations), scenario B (zero iterations)

One screen per sub-cuisine picked on `n_cuisine_narrow`, offering that sub-cuisine's signature
dishes. Last node in the cuisine → sub-cuisine → dish chain.

## Behaviour

- **`repeat_for: taste_profile.sub_cuisines`** — one iteration per sub-cuisine, each with its
  own history entry. Zero iterations whenever the chain above produced nothing, including the
  `n_cuisine_broad` skip case. See [`_shared/repeat-for.md`](../_shared/repeat-for.md).
- **Options come from `curated:cuisine.dishes`, keyed by `{item}`.** Every one of the 25
  sub-cuisine values reachable from `curated:cuisine.sub_cuisines` has a row there, so the
  curated tier always resolves today. Each row ends with its own `Other` option.
- **Tiers 2 and 3 are stubs** — `get_signature_dishes` and `web_search_dishes` return `[]`
  (`resolvers.ts` skips `type: tool` tiers).
- **Soft ask.** Not `optional`, no `require_selection`: no Skip button renders, Continue stays
  enabled, and an empty submission writes nothing.
- **`skip_if: "item == 'other'"`** advances to the next sub-cuisine; defensive, since the
  trigger value is stripped before `taste_profile.sub_cuisines` is written.
- **"Other" runs the validator gate** — section `dishes`, context
  `{parent_sub_cuisine: "{item}", diet_type: "{dietary.diet_type.preferred}"}`. The diet path
  is why this must be resolved server-side in `/api/onboarding/validate-other` rather than by the
  client. See [`_shared/validator-gate.md`](../_shared/validator-gate.md).
- **`invalid` is hard-blocked, with no accept-as-typed.** This is the section
  `verify-invalid-no-override.mjs` exercises: "Italian" typed as a dish under the Italian
  sub-cuisine comes back `invalid` ("that's a cuisine, not a dish") and can only be edited or
  removed.

## Exceptions & gotchas

**The `infer` write fires on every iteration, unconditionally.**
`explorer_handoff.preferred_discovery_mode` is set to `"similar_to_favorites"` in `applyAnswer`'s
`infer` loop, which runs regardless of whether anything was selected — so it lands even on a
screen the user Continued straight past. Conversely, if the node runs zero iterations the field
stays at its skeleton default of `null`, i.e. "no discovery mode recorded", not a false.

**`{item}` interpolates the raw slug.** The prompt renders as "And any dishes from
classic_american you already love?". Same mechanism as `n_cuisine_narrow` —
`engine.interpolate` substitutes the bare value, and only `prompt` and `other_capture.prompt`
are interpolated at all.

**`taste_profile.favorite_dishes` is flat across every iteration,** with no record of which
sub-cuisine each dish came from.

## Depends on

- `taste_profile.sub_cuisines` (the iteration source)
- Content: `node:n_dishes` — prompt and `other_capture` copy only; it carries no options
- Curated: `curated:cuisine.dishes`, keyed by sub-cuisine
- Agent section: `dishes`, with `dietary.diet_type.preferred` read from server-side memory

## Writes

- `taste_profile.favorite_dishes` — curated values plus validated "Other" entries
- `other.dishes` — the same custom entries, staged
- `explorer_handoff.preferred_discovery_mode` — literal `"similar_to_favorites"` (`infer`)

## Downstream

`taste_profile.favorite_dishes` feeds `n_favorite_recipes`' validator context
(`{cuisines, favorite_dishes}`) and `search_recipe_db`'s args. It does **not** feed
`n_pairing_cards`, which samples from `taste_profile.cuisines` independently.

## Decisions

- Rejected entries can't be forced through; only flagged ones offer "continue anyway" — [2026-09-19](../../diary_log/2026-09-19.md#entry-checking)
- "Other" validated before submit, staged in `memory.other.<section>` — [2026-09-17](../../diary_log/2026-09-17.md#other-entry-workflow)
