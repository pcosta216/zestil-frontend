# Shared — `options_filter` (diet + allergy/intolerance option narrowing)

Status: live · Last verified: 2026-09-24
Component: `lib/onboarding/options-filter.ts`
Verify: `scripts/onboarding-seed/smoke-test.ts` scenarios I (hard-exclude union), J (zero
remaining), Q (unknown diet slug), D (one remaining), U (per-cause attribution);
`scripts/onboarding-seed/verify-one-remaining-renders.mjs` (the attribution on screen)

Turns what the user already told us about diets, allergies and intolerances into the set of
option values a later node must not offer as a free choice. Declared per node under
`options_filter` in `content/onboarding/flow-structure.yaml`; used today only by
`n_protein_exclusion_cards`, `n_carb_exclusion_cards`, `n_fat_exclusion_cards` (see
`onboarding/exclusion-decks.md`).

`applyOptionsFilter(filter, rawOptions, disclosureTemplate, memory)` returns
`{ excludedValues, filteredOptions, contributingDiets, exclusionReasons, disclosureText }`. It is
pure-ish: it reads memory and curated content, and never writes. Callers decide what to do with
the result.

## Behaviour

- **Diets INTERSECT.** `exclude_source: dietary.diet_type.preferred` →
  `lookup_section: curated:diet_macro.exclusions` → the `[diet][macro_category].excluded` block.
  The excluded sets of the selected diets are intersected, so only what *every* selected diet
  rules out survives. A selected diet with nothing to say about this macro has an empty
  `excluded`, and intersecting with empty yields empty — **silence neutralizes**, deliberately.
  Rationale lives in `content/onboarding/diet_macro_curated_data.yaml`'s header: several diets
  selected means "draws from multiple styles", not "follows the strictest fusion of all of them".
- **`hard_exclude_sources` UNION.** Each entry is an independent hard constraint, unioned across
  every source and every value inside a source, and unioned again with the diet result. Today:
  `dietary.allergies` → `curated:allergy_macro.exclusions`, and `dietary.intolerances` →
  `curated:intolerance_macro.exclusions`. A nuts allergy stays excluded whether or not an
  unrelated eggs allergy is also reported — an intersection here would let one cancel the other.
  Two sources pointing at the same value is a no-op (it is excluded once). Smoke-test scenario I.
  These tables are the flat `{ [value]: { protein: [], carbs: [], fat: [] } }` shape, not
  `{excluded, allowed}` blocks.
- **Lookups run concurrently.** The diet table and every hard-exclude table are fetched in one
  `Promise.all`; the diet table is fetched only when at least one diet is selected, and a
  hard-exclude source with no values in memory is dropped before fetching.
- **Excluded options are DISABLED, never removed.** The filter itself returns a narrowed
  `filteredOptions` list, but `renderNode` (`lib/onboarding/engine.ts`) keeps the full option
  list and stamps `disabled: true` on anything in `excludedValues`. The user sees the tile, plus
  the node's `exclusion_disclaimer` copy, instead of an option silently vanishing.
  `filteredOptions` is still what the write path and `resolveAllOptions` reason about.
- **Every greying is attributed.** `exclusionReasons` is `{cause, labels}[]` — `"Nuts allergy"` →
  `["Nuts / seeds / avocado"]`, `"Vegetarian, Vegan diets"` → `["Lard", "Tallow (beef fat)"]`.
  `renderNode` passes it to the screen as `node.exclusion_reasons` and `MultiSelect` lists it
  inside the `exclusion_disclaimer` banner. A tile ruled out by two constraints appears under
  both: suppressing the second would make the banner's "tap Back to change those" advice wrong,
  since changing one answer wouldn't free the tile.
  - Diet causes name every contributing diet (the rule is an intersection, so they all excluded
    it) and agree in number — "diet" / "diets".
  - Hard-exclude causes name the specific allergen or intolerance, with the noun from
    `HARD_SOURCE_VOCAB` in `lib/onboarding/options-filter.ts`. That map is keyed on the MEMORY
    PATH, not on a node: the same allergy list greys tiles on three decks, and "Nuts allergy"
    belongs to the allergy field. An unlisted path still attributes, just without the noun.
  - A value with no curated row (free text — "pumpkin") rules nothing out and is never listed as
    a phantom cause.
- **`resolveAllOptions(filteredOptions)`** is the `all_options` keyword in `default_if_empty` —
  always the filtered list, never the node's full static list.
- **Disclosure banner.** Produced only when `filter.disclosure` is true, `excludedValues` is
  non-empty, and the node's content row supplies a `disclosure_template`. `{excluded_labels}` is
  the labels of the excluded options, pulled from `rawOptions`. `{contributing_diets}` is
  **composed in code**, not substituted, because a template string cannot express a conditional
  "and". Three real cases: diet labels only; `"what you told us about your allergies/
  intolerances"` only; both, joined with `and`. Diet labels are resolved from
  `n_diet_style_cards`' own content options, so the banner shows "Vegan", not `vegan`.

## Exceptions & gotchas

**Unknown diet slugs sit out the intersection entirely.** Only diets the curated table actually
has a key for take part (`knownDiets`). An unrecognised slug is an *unknown*, not a diet with no
opinion, and treating the two alike empties the whole intersection: tap Vegan, type "keto diet"
in Other (the validator agent normalises it to `ketogenic`, which is not the curated `keto`), and
red meat becomes selectable for a vegan. This is the one documented exception to
"plain intersection, silence neutralizes", and it is strictly safe — it can only ever keep
exclusions, never add one. Smoke-test scenario Q. See `onboarding/n_diet_style_cards.md` for the
upstream cause.

**`contributingDiets` names causes, not selections.** It is `knownDiets` when the diet
intersection contributed something, and `[]` otherwise. So a custom diet that sat out above is
never named in the banner, and neither is a known diet when every exclusion came from allergies.

**The banner's `"your earlier answers"` branch is unreachable today** — it only fires with a
non-empty `excludedValues` and no contribution from either side. It is a defensive fallback, not
a case to write copy for.

**No node currently sets `disclosure: true`.** All three exclusion decks set `disclosure: false`
(a product decision: the user already knows what they picked), and `node_copy.yaml` carries no
`disclosure_template`. `disclosureText` is therefore always `undefined` in the live flow; the
banner the user actually sees on those screens is `exclusion_disclaimer`, rendered by
`MultiSelect` whenever any option is disabled. The composition code above is live but dormant.

`exclusionReasons` is the separate, always-on mechanism and needs none of that: it is derived
from the answers and the option labels, so it requires no authored template and no DB write. The
split is deliberate — prose frame in content, the facts composed in code.

## Depends on

- Memory: `dietary.diet_type.preferred`, `dietary.allergies`, `dietary.intolerances`
- Curated content: `curated:diet_macro.exclusions` (authored in
  `content/onboarding/diet_macro_curated_data.yaml`), `curated:allergy_macro.exclusions`,
  `curated:intolerance_macro.exclusions`
- Node content: `node:n_diet_style_cards` (diet labels for the banner)

## Writes

Nothing directly. `applyAnswer` unconditionally appends every `excludedValue` to the node's
`writes_to.excluded` (`dietary.avoided_foods`) — even on a skipped visit, since those values were
never offered as tiles and so cannot be part of the submitted answer.

## Decisions

- An unrecognised diet no longer cancels the other diets' exclusions —
  [2026-09-20](../../diary_log/2026-09-20.md#food-filtering)
- Matching typed free-text diets against on-screen options is stage-two work (parked) —
  [2026-09-20](../../diary_log/2026-09-20.md#food-filtering)
