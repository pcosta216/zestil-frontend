# The three macro exclusion decks — protein / carbs / fat

Status: live · Last verified: 2026-09-25
Component: `app/onboarding/_components/MultiSelect.tsx` (`layout: grid`, `select_all_by_default: true`)
Verify: `scripts/onboarding-seed/verify-one-remaining-renders.mjs`,
`verify-skip-button-rules.mjs`, `verify-macro-source-validation.mjs` (the "Other" box, live
agent), `verify-macro-source-payload.ts` (request shape, mocked),
`probe-macro-source-sections.mjs` (section names) — all under `scripts/onboarding-seed/`;
engine-side, `smoke-test.ts` scenarios H, D, J

`n_protein_exclusion_cards` → `n_carb_exclusion_cards` → `n_fat_exclusion_cards`, consecutive in
`content/onboarding/flow-structure.yaml`. Three structurally identical `multi_select` grids: the
whole macro category starts selected ("I eat this"), the user unticks what they never eat.
Everything below applies to all three; only the table differs.

| | `n_protein_exclusion_cards` | `n_carb_exclusion_cards` | `n_fat_exclusion_cards` |
|---|---|---|---|
| `options_filter.macro_category` | `protein` | `carbs` | `fat` |
| Content row | `node:n_protein_exclusion_cards` (10 options) | `node:n_carb_exclusion_cards` (8) | `node:n_fat_exclusion_cards` (8) |
| `writes_to.excluded` | `dietary.avoided_foods` | `dietary.avoided_foods` | `dietary.avoided_foods` |
| `writes_to.allowed` | `…variety_rules.protein_variety.rotation` | `…variety_rules.carb_variety.rotation` | `…variety_rules.fat_variety.rotation` |
| `other_capture.appends_to` | same as `allowed` | same as `allowed` | same as `allowed` |
| `validation.payload.section` | `protein_source` | `carb_source` | `fat_source` |
| `validation.payload.context` | `{carb_sources, fat_sources}` | `{protein_sources, fat_sources}` | `{protein_sources, carb_sources}` |

(`…` = `meal_planning_preferences`.) All three declare `optional: true`,
`default_if_empty: { allowed: all_options }`, `select_all_by_default: true`, and the same
`options_filter` (`exclude_source: dietary.diet_type.preferred`, `lookup_section:
curated:diet_macro.exclusions`, `disclosure: false`, plus `hard_exclude_sources` for
`dietary.allergies` and `dietary.intolerances`). See `_shared/options-filter.md`.

## Behaviour

- **Opt-out framing.** Every **selectable** tile starts selected; untapping one marks it
  excluded. A filter-disabled tile (`opt.disabled`) never starts selected — it cannot be toggled
  at all, so it must not look like a choice the user made. Selection state is lazily initialised
  once per mount, and `OnboardingFlow`'s ``key={`${node.id}:${item ?? ""}`}`` forces a fresh mount per node, so
  switching decks cannot carry selections across. Smoke-test scenario H: with everything else
  skipped, tapping off only `pork` writes `dietary.avoided_foods = ["pork"]` and leaves the other
  nine in the rotation.
- **Filtered options stay on screen, greyed out, and say who ruled them out.** `renderNode`
  marks them `disabled` rather than removing them, and `MultiSelect` renders the
  `exclusion_disclaimer` banner — with `node.exclusion_reasons` listed inside it, one line per
  cause ("Vegan diet: Poultry, Red meat, …" / "Soy allergy: Plant-based / tofu"). The banner
  copy alone can only name the three KINDS of answer that filter these screens, which is how a
  greying gets blamed on the wrong one; the lines name the actual answer. See
  [`../_shared/options-filter.md`](../_shared/options-filter.md). The frame appears whenever any
  option is disabled ("Greyed-out options don't fit your diet, allergy, or intolerance answers.
  Tap Back to change those if you'd like to include one."). Scenario I checks the eggs tile is
  present and `disabled`, not missing. The screen that advice sends people to re-renders with
  its own answer intact — see [`../_shared/back-navigation.md`](../_shared/back-navigation.md).
- **The skip button ("I can eat everything") is disabled the moment anything is filtered out.**
  `disabled={hasDisabledOption}` — the label stays visible and greyed. Claiming to eat everything
  would contradict what filtering already ruled out.
- **The deck always renders, at any remaining-option count.** `checkSkip` returns `skip: false`
  unconditionally for any node with an `options_filter`. One remaining selectable option renders
  normally: it is pre-selected, Continue works immediately. Scenario D and
  `verify-one-remaining-renders.mjs` (vegan + soy + gluten → exactly `lentils_legumes` left).
- **`default_if_empty: { allowed: all_options }` resolves against the FILTERED list.** On a
  skipped answer, `applyAnswer` writes `resolveAllOptions(filterResult.filteredOptions)` to
  `writes_to.allowed`. `applyDefaultIfEmpty` deliberately does nothing for the `all_options`
  keyword — it is resolved by the caller, which is the only place the filtered options are known.
  The history entry is tagged `default_applied`.
- **Write shape.** `values` (what is selected) is the `allowed` set; `excluded` is "every option
  that was actually shown, minus what is selected", computed against the same `options_filter`-
  narrowed list the client rendered. A value not in that list is dropped defensively, so a stale
  client cannot land an allergen as `allowed`. Separately and unconditionally, every
  `options_filter` exclusion is appended to `dietary.avoided_foods` — those were never tiles, so
  they cannot come from the answer.

## Exceptions & gotchas

**The `needsAlternative` dead end.** When nothing selectable remains — because the filter
disabled every option, or because the user untapped every selectable one — there is no valid
answer left. `MultiSelect` then:

- forces `other_capture` open (there is no `other` tile in any of these three fixed option lists,
  so `trigger_value: other` can never be selected the usual way — forcing is the only route in);
- swaps the prompt for `no_options_message` ("None of our usual protein sources fit what you've
  told us — what works for you?"). There is no skip-label equivalent;
- **hides the skip button entirely** (`node.optional && !needsAlternative`) rather than
  relabelling it — any escape hatch here would defeat the point;
- keeps Continue disabled until real text is typed, and blocks the review path from becoming a
  back door (Continue stays disabled if every reviewed entry ends up removed).

The grid itself stays visible throughout; re-selecting a still-selectable tile is also a valid way
out. Scenario J: keto alone excludes all 8 carb categories, the deck still renders all 8 marked
`disabled`, and typing "cassava" lands in `carb_variety.rotation` (plus `other.carb_source`)
instead of silently writing an empty rotation. `verify-skip-button-rules.mjs` covers both the
disabled and the hidden skip button in the browser.

**`needsAlternative` requires `other_capture` to exist.** Without that guard, a
`select_all_by_default` node with no free-text field (`n_active_slots`) would disable Continue
with nothing the user could type to satisfy it. That gate is why the same flag is harmless there.

**The forced free text goes through the validator agent** ([`../_shared/validator-gate.md`](../_shared/validator-gate.md))
— these are the only screens where the user has no choice but to type. "game meat" on the carb
deck returns `invalid` ("Game meat is primarily a protein source…"): no accept-as-typed, Continue
blocked until it's fixed or removed. A dual-macro food (`black beans`) returns `flag` — a one-tap
confirm, never a block.

**Its `context` carries labels, not slugs**, mapped through `{ path, labels_from: <node id> }`
from the other two macros' rotations, because the agent reads them back to the user (a raw
`red_meat` would surface as "Red_meat"); a value with no curated option was typed, and falls back
to a humanised slug. Flow order shows through — the protein deck sends two empty arrays, the fat
deck sends both populated, which is when the cross-macro duplicate check can fire at all.

**Engine-rendered copy is never the swapped copy.** The `no_options_message` swap is
client-side; `renderNode` returns the plain `prompt` and `skip_label` regardless of state. Don't
assert on the engine's output expecting the no-options wording.

**`dietary.avoided_foods` is shared by all three decks** and appended to, not overwritten, so it
mixes protein, carb and fat slugs — a cross-cutting allergy shows up in more than one macro:
gluten hard-excludes `seitan` on protein *and* `bread`/`pasta` on carbs (scenario D).

## Depends on

- `dietary.diet_type.preferred` (from `n_diet_style_cards`), `dietary.allergies`, `dietary.intolerances`
- `lib/onboarding/options-filter.ts` — see `_shared/options-filter.md`
- Content rows above, for `prompt`, `prompt_instructions`, `skip_label`, `no_options_message`,
  `exclusion_disclaimer`, `other_capture.prompt`, `other_capture.on_invalid_message`, `options`

## Writes

- `dietary.avoided_foods` — unselected shown options, plus every `options_filter` exclusion
- `meal_planning_preferences.variety_rules.<macro>_variety.rotation` — the selected (allowed)
  options, or the custom free-text entries when `needsAlternative` forced them
- `other.protein_source` / `other.carb_source` / `other.fat_source` — the custom entries, staged
  under the node's agent section slug (`otherCaptureSection` derives both from the same field)

## Decisions

All four from [2026-09-17](../../diary_log/2026-09-17.md#exclusion-card-redesign-swipe-to-tap-opt-out-framing)
([UI state](../../diary_log/2026-09-17.md#ui-state-management) for the last two):

- Tap grids with opt-out framing (start selected, unselect what you don't eat)
- Always render, at any option count; no silent auto-skip at exactly 1 remaining
- "I can eat everything" is disabled as soon as any option is filtered out
- The skip button is hidden completely when the "Other" field is required
