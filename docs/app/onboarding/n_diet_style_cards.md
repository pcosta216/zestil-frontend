# n_diet_style_cards — "Which eating style best describes you?"

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/MultiSelect.tsx` (`layout: grid`)
Verify: `scripts/onboarding-seed/verify-diet-styles-validation.mjs`, `scripts/onboarding-seed/verify-mixed-entry-review.mjs`

Tap-to-select grid of eating styles, plus free-text "Other". What's selected here drives the
diet-implied exclusions on the three macro decks downstream.

## Behaviour

- **Records only what's picked.** `writes_to: dietary.diet_type.preferred`. The node
  deliberately does **not** write `dietary.diet_type.to_avoid`. "Everything not tapped =
  to_avoid" was considered and rejected: it turns indifference (never having had an opinion on
  Keto) into an explicit avoidance claim, a materially stronger signal, and risks over-filtering
  if `to_avoid` is ever used to exclude recipes. It stays empty — already the correct
  "no restriction" default.
- **"No specific style" is `exclusive_value: balanced_no_specific_style`, symmetric** — clears
  and disables everything else, and is cleared back by any real pick.
- **Skippable.** `optional: true` with `default_if_empty: mediterranean`. The default is
  **terminal, not cascading**: it satisfies this node only and does not make downstream
  `repeat_for` behave as though the user chose Mediterranean. Tracked as `default_applied` on
  the history entry.
- **"Other" runs the validator gate**, `section: diet_styles` (**plural** — the Edge Function's
  allowlist rejects `diet_style`, which is what this node used to send), `context: {}`.
- **`flag` here is a normal "are you sure?"** — approving keeps the entry, using the agent's
  `value`/`label`. Unlike `n_favorite_recipes`, where a flag means "rewrite it".

## Exceptions & gotchas

**The agent's slugs don't match the curated option values.** `"keto diet"` normalises to
`ketogenic`, but the curated option is `keto`; `"paleo"` → `paleolithic` vs curated `paleo`.
Consequences:

- Typing `keto` exactly matches the **Keto** tile's *label*, so the pre-check turns it into a
  plain selection and never calls the agent. Memory gets `keto`.
- Typing `keto diet` doesn't match any label, so it goes to the agent and lands as `ketogenic` —
  a custom entry sitting alongside the curated vocabulary.

So two users who mean the same thing can end up with different values, and only the tile-matching
one gets diet-implied exclusions. This is the deferred stage-2 matching problem; don't paper over
it with an alias table.

**A custom diet slug must not neutralise real exclusions.** `applyOptionsFilter` intersects
`excluded` across every entry in `dietary.diet_type.preferred`, and an unknown slug used to
contribute an empty set — emptying the intersection and cancelling every tapped diet's
exclusions. Tap Vegan, type "keto diet", and red meat became selectable for a vegan.

`lib/onboarding/options-filter.ts` now narrows the intersection to diets the curated table
actually knows. An unknown slug sits out entirely: it can only ever keep exclusions, never add
one. This is a deliberate exception to the documented "plain intersection, silence neutralizes"
rule — that rule is about curated diets with genuinely nothing to say about a macro, which is
real signal; a custom free-text diet carries none. Guarded by smoke-test scenario Q.

## Depends on

- Content: `node:n_diet_style_cards` — options `mediterranean`, `paleo`, `vegetarian`, `vegan`,
  `pescatarian`, `keto`, `other`, `balanced_no_specific_style`
- Agent section: `diet_styles`

## Writes

- `dietary.diet_type.preferred` — curated values, plus validated "Other" entries
- `other.diet_styles` — the custom entries, staged

## Downstream

`dietary.diet_type.preferred` is the `exclude_source` for all three exclusion decks, resolved
through `curated:diet_macro.exclusions`. Diet exclusions **intersect** across selected diets
(silence neutralises) — the opposite of allergies/intolerances, which union. Selecting Vegan and
Mediterranean yields only what *both* exclude.

The disclosure banner names the contributing diets, and lists only **known** ones — a custom diet
that sat out the intersection didn't cause any of the exclusions and isn't named.

## Decisions

- Tap grid, not swipe cards; only "preferred" recorded —
  [2026-09-16](../../diary_log/2026-09-16.md#onboarding-content-cuisine-and-diet-style)
- "No specific style" clears and disables everything else —
  [2026-09-16](../../diary_log/2026-09-16.md#onboarding-content-cuisine-and-diet-style)
