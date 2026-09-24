# The three macro exclusion decks — protein / carbs / fat

Status: live · Last verified: 2026-09-24
Component: `app/onboarding/_components/MultiSelect.tsx` (`layout: grid`, `select_all_by_default: true`)
Verify: `scripts/onboarding-seed/verify-one-remaining-renders.mjs`,
`scripts/onboarding-seed/verify-skip-button-rules.mjs`; engine-side, covered by
`scripts/onboarding-seed/smoke-test.ts` scenarios H, D, J

`n_protein_exclusion_cards` → `n_carb_exclusion_cards` → `n_fat_exclusion_cards`, consecutive in
`content/onboarding/flow-structure.yaml`. Three structurally identical `multi_select` grids: the
whole macro category starts selected ("I eat this"), and the user unticks what they never eat.
Everything below applies to all three; only the table differs.

| | `n_protein_exclusion_cards` | `n_carb_exclusion_cards` | `n_fat_exclusion_cards` |
|---|---|---|---|
| `options_filter.macro_category` | `protein` | `carbs` | `fat` |
| Content row | `node:n_protein_exclusion_cards` (10 options) | `node:n_carb_exclusion_cards` (8) | `node:n_fat_exclusion_cards` (8) |
| `writes_to.excluded` | `dietary.avoided_foods` | `dietary.avoided_foods` | `dietary.avoided_foods` |
| `writes_to.allowed` | `…variety_rules.protein_variety.rotation` | `…variety_rules.carb_variety.rotation` | `…variety_rules.fat_variety.rotation` |
| `other_capture.appends_to` | same as `allowed` | same as `allowed` | same as `allowed` |
| `validation.payload.section` | `accepted_protein` | `accepted_carbs` | `accepted_fat` |

(`…` = `meal_planning_preferences`.) All three declare `optional: true`,
`default_if_empty: { allowed: all_options }`, `select_all_by_default: true`, and the same
`options_filter` (`exclude_source: dietary.diet_type.preferred`,
`lookup_section: curated:diet_macro.exclusions`, `disclosure: false`, plus `hard_exclude_sources`
for `dietary.allergies` and `dietary.intolerances`). See `_shared/options-filter.md`.

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
  present and `disabled`, not missing.
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
`disabled`, and typing "cassava" lands in `carb_variety.rotation` (plus `other.accepted_carbs`)
instead of silently writing an empty rotation. `verify-skip-button-rules.mjs` covers both the
disabled and the hidden skip button in the browser.

**`needsAlternative` requires `other_capture` to exist.** Without that guard, a
`select_all_by_default` node with no free-text field (`n_active_slots`) would disable Continue
with nothing the user could type to satisfy it. That gate is why the same flag is harmless there.

**The forced free text is not actually checked by the validator agent.** `accepted_protein`,
`accepted_carbs` and `accepted_fat` are outside `VALIDATOR_SECTIONS`, so `validateEntries`
synthesises an all-valid result locally and no network call happens — the `validation` block in
YAML notwithstanding. See `_shared/validator-gate.md`.

**Engine-rendered copy is never the swapped copy.** The `no_options_message` swap is
client-side; `renderNode` returns the plain `prompt` and `skip_label` regardless of state. Don't
assert on the engine's output expecting the no-options wording.

**`dietary.avoided_foods` is shared by all three decks** and appended to, not overwritten, so it
mixes protein, carb and fat slugs. A cross-cutting allergy shows up in more than one macro:
gluten hard-excludes `seitan` on protein *and* `bread`/`pasta` on carbs (scenario D).

## Depends on

- `dietary.diet_type.preferred` (from `n_diet_style_cards`), `dietary.allergies`,
  `dietary.intolerances`
- `lib/onboarding/options-filter.ts` — see `_shared/options-filter.md`
- Content rows above, for `prompt`, `prompt_instructions`, `skip_label`, `no_options_message`,
  `exclusion_disclaimer`, `other_capture.prompt`, `other_capture.on_invalid_message`, `options`

## Writes

- `dietary.avoided_foods` — unselected shown options, plus every `options_filter` exclusion
- `meal_planning_preferences.variety_rules.<macro>_variety.rotation` — the selected (allowed)
  options, or the custom free-text entries when `needsAlternative` forced them
- `other.accepted_protein` / `other.accepted_carbs` / `other.accepted_fat` — the custom entries,
  staged

## Decisions

- Tap grids with opt-out framing (start selected, unselect what you don't eat) —
  [2026-09-17](../../diary_log/2026-09-17.md#exclusion-card-redesign-swipe-to-tap-opt-out-framing)
- Always render, at any option count; no silent auto-skip at exactly 1 remaining —
  [2026-09-17](../../diary_log/2026-09-17.md#exclusion-card-redesign-swipe-to-tap-opt-out-framing)
- "I can eat everything" is disabled as soon as any option is filtered out —
  [2026-09-17](../../diary_log/2026-09-17.md#ui-state-management)
- The skip button is hidden completely when the "Other" field is required —
  [2026-09-17](../../diary_log/2026-09-17.md#ui-state-management)
