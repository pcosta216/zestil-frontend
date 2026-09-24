# n_pairing_cards — one screen per sampled dish

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/PairingCards.tsx` · Engine: `lib/onboarding/pairing.ts`, `engine.ts`'s `ensureSampleComputed`
Verify: `scripts/onboarding-seed/smoke-test.ts` scenario L (proportional split, write shape, a
no-opinion answer), scenario K (empty pool → node fully bypassed), scenario A (6 dishes in a
full walkthrough); `scripts/onboarding-seed/verify-pairing-cards.mjs` drives the real screens in
a browser — its trailing whole-node-Skip section is stale, there is no Skip button

A preference-profiling exercise: for a randomly sampled dish, which sides go well with it and
which would you never pair. Two independent checkbox groups over the same four curated options.
Deliberately independent of `taste_profile.favorite_dishes` — this is not "show cards for dishes
you said you like".

## The sample (`sample_from`)

`ensureSampleComputed` runs in `resolveEntry` when the node is entered with `item === undefined`,
i.e. before `repeat_for` reads its list. Wiring:

| field | value |
|---|---|
| `source` | `taste_profile.cuisines` |
| `pool_section` | `curated:pairing.sides` |
| `sample_field` | `meal_planning_preferences.pairing_sample` |
| `source_snapshot_field` | `meal_planning_preferences.pairing_sample_source` |
| `total_sample_size` | 6 |
| `distribution` | `proportional_round_up` |

`computePairingSample` takes `share = ceil(6 / distinct cuisines)` and picks that many dishes at
random from **each** cuisine's own flattened pool (`shuffle().slice()`), never borrowing across
cuisines. Live pool sizes: `african` 19, `asian` 7, `european` 4, `american` 3,
`middle_eastern` 3, `latin_american` 2, `mediterranean` **0**.

**Self-invalidating cache.** The sample is reused for the rest of the session while
`pairing_sample_source` still matches `taste_profile.cuisines` element-for-element; any change
to the cuisine list recomputes both. Neither field is in the memory skeleton, and neither is any
node's `writes_to` — so they are invisible to the history snapshot/revert machinery, which is
precisely why the snapshot comparison exists rather than relying on Back.

**An empty sample bypasses the whole node.** `repeat_for` sees zero items, `resolveEntry` falls
through to `next`, and no history entry is created — the node is skipped, not answered-empty
(scenario K). `mediterranean` alone is exactly that case, and `mediterranean` is
`n_cuisine_broad`'s `default_if_empty`, so skipping the cuisine question skips pairing too.

**`top_up_tool: generate_pairing_cards` is a stub** (`resolvers.ts` tier 2/3 posture). An
under-covered cuisine simply contributes fewer dishes than its share; that is a shortfall, never
an error.

## Behaviour

- **`repeat_for: meal_planning_preferences.pairing_sample`** — an ordinary `repeat_for`
  sequence, just fed by the computed sample instead of a user-populated field. Each dish is its
  own history entry and its own Back step. See [`_shared/repeat-for.md`](../_shared/repeat-for.md).
- **The dish's label is the prompt.** Content stores `prompt: "{dish}"`,
  `preferred_prompt: "Which of these goes well with {dish}?"` and
  `forbidden_prompt: "Which of these would you never pair with {dish}?"`. `renderNode` resolves
  `{dish}` through `findPairingDish(item).main_label` — a node-specific placeholder, separate
  from the generic `{item}`, which would substitute the bare slug.
- **"goes well" renders bold green, "never pair" bold red.** `highlightPhrase` in
  `PairingCards.tsx` wraps the first case-insensitive match (`font-bold text-green-primary` /
  `font-bold text-red-600`). If the admin copy stops containing those exact phrases, the line
  still renders — just unstyled.
- **The same four options render twice,** once per question. Checking a side in one group clears
  it from the other; a side can't be both "goes well" and "never pair".
- **Not optional, and no Skip button at all.** Pairing reactions are data the product needs.
  Declining a *specific* dish is still fine: Continue is never disabled, and an answer with
  nothing checked in either group writes nothing and moves to the next dish.
- **Writes happen per dish, as you go,** already grouped under that dish — never assembled at
  the end. A dish only gets an entry in a list if at least one side was checked in that
  question, so neither array ever holds an empty `sides`.

## Write shape

```
meal_planning_preferences.preferred_pairings / .forbidden_pairings
  [{ main: "<sampled dish value>", sides: [{ title: "<side label>", recipe_uuid: null }] }]
```

`main` is `item` (the bare slug); `title` is the curated option's label. `recipe_uuid` stays
`null` — `resolve_recipe_uuid` isn't built, the same stub posture as `n_favorite_recipes` and
`n_fixed_meals`.

## Exceptions & gotchas

**`total_sample_size` is a target, not a cap.** Rounding up multiplies: four selected cuisines
give `ceil(6/4) = 2` each, so up to **8** screens; five give up to **10**. Only a count that
divides 6 evenly lands on 6.

**`appendUnique` cannot dedupe these entries.** It compares with `Array.includes`, i.e. `===`,
so the `{main, sides}` objects always append. Answering the same dish twice without a rewind
would produce two entries for it. Nothing does that today, because Back reverts the iteration's
own `pre_write_snapshot` before the screen is re-answered.

**`bypassRemainingIterations` is unreachable here.** `advanceFlow` still supports a whole-node
Skip abandoning a `repeat_for` sequence, but it's gated on `structure.optional`, and this node
is not optional — the mechanism is kept as a general one, not a pairing feature.

**A sample value missing from `curated:pairing.sides` degrades silently.** `findPairingDish`
returns `undefined`, so the prompts keep their literal `{dish}` placeholder and no options
render. Only reachable if the cached sample and the curated section disagree — e.g. content
edited mid-session while a sample is still valid against an unchanged cuisine list.

## Depends on

- Content: `node:n_pairing_cards` (three prompts, no options), `curated:pairing.sides`
  (dish labels and their four side options, nested broad cuisine → sub-cuisine → dish)
- `taste_profile.cuisines` — the sample source and its invalidation key

## Writes

- `meal_planning_preferences.preferred_pairings`, `meal_planning_preferences.forbidden_pairings`
- `meal_planning_preferences.pairing_sample`, `meal_planning_preferences.pairing_sample_source` —
  engine-managed cache, written by `ensureSampleComputed`, not by an answer

## Decisions

- A dedicated screen type: one screen per dish, two questions on it — [2026-09-18](../../diary_log/2026-09-18.md#pairing-question)
- The dish list is sampled once and recomputed only if the cuisines change — [2026-09-18](../../diary_log/2026-09-18.md#pairing-question)
- Each dish's answer is saved as you go, grouped under that dish — [2026-09-18](../../diary_log/2026-09-18.md#pairing-question)
- Pairing can't be skipped — [2026-09-18](../../diary_log/2026-09-18.md#pairing-question)
- Swipe cards removed from the app entirely — [2026-09-18](../../diary_log/2026-09-18.md#pairing-question)
