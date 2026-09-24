# n_favorite_recipes — "Name a couple of go-to meals"

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/FreeTextSearch.tsx`
Verify: `scripts/onboarding-seed/verify-favrecipes-review.mjs` (5 passes, incl. the live agent)

Free-text entry of up to 5 recipe titles, staged as chips, all validated in one batch on
Continue. The only fully freeform screen in the flow — everything else offers options.

## Behaviour

- **Type → Add → chip.** Input splits on `,` `;` newline, so "pizza, lasagna" stages two chips
  rather than one nonsense title. Splitting on Add (not at validation time) means the user
  *sees* the split land and `max_items` counts correctly. Case-insensitive dedupe; cap 5.
- **Tapping Add is optional.** Continue folds any un-added draft into the picks first. Typing a
  dish and pressing Continue used to discard it silently — the worst possible outcome on the one
  screen whose whole job is collecting those dishes.
- **Continue requires something to submit.** Disabled when there's neither a chip nor text in the
  box. **Skip is the only "I haven't got any" path.** Continue with nothing staged would produce
  byte-identical memory, next node and history entry to Skip — two controls with one behaviour —
  so it is disabled instead of duplicating it.
- **Validation is one batch on Continue**, never per-Add. Config sits at the node's own
  `validation` key, not inside an `other_capture` block — this node has no options, so its whole
  input is freeform.
- **`search_recipe_db` is a stub** (`resolvers.ts` returns nothing this phase), so there is no
  live search; entry is freeform-only. Wiring search in later changes only how a pick gets its
  `value` (a real `recipe_uuid` instead of null) — the `recipe_picks` shape is unchanged.

## `flag` means rewrite here, not "are you sure?"

This is the one section where a flag is **not** confirmable, and it follows the agent's own
prompt, which defines flag as *"the entry reads as a category rather than a specific recipe … a
friendly, specific nudge toward naming the particular dish meant"*. Approving such an entry as
typed writes back the exact text the agent called too vague.

So a real flag offers only:

- **Rewrite this one** — drops the chip, returns the text to the input for editing.
- **Remove this one.**

The one exception is **our own failure** (timeout, unreachable route), which synthesises a flag
meaning "we couldn't check this" — genuinely confirm-or-correct. It's identified by
`reason === TOTAL_FAILURE_REASON`, built from the same constant on both sides, and gets a
**Yes — keep "…"** button. Without that carve-out, a backend blip would force users to retype
perfectly good entries.

## Compound entries and `split_into`

An entry naming two dishes ("butter chicken and pizza") is flagged, and the agent returns its own
breakdown:

```json
{"entry":"butter chicken and pizza","verdict":"flag","label":"Butter Chicken and Pizza",
 "reason":"You listed two or more distinct dishes. Please list them separately.",
 "split_into":["Butter Chicken","Pizza"]}
```

The row then offers **Add as 2 separate recipes** (one tap, replaces the chip with two) with
**Rewrite instead** beside it. The split **does not auto-submit** — the pieces re-enter
validation as ordinary entries on the next Continue, so each dish gets its own real verdict. In
testing, `Butter Chicken` came back valid and `Pizza` was independently flagged as too generic.
A compound entry with a vague half therefore takes two rounds. That's correct, not a regression.

> **The split is never computed client-side.** "and" is load-bearing in real dish names —
> macaroni and cheese, fish and chips, sweet and sour pork, bangers and mash. Only the model can
> tell a compound entry from a single dish containing the word, and the section prompt tells it
> to default to `valid` when unsure.

`split_into` is optional on the wire. Absent, or shorter than 2 entries, falls back to
rewrite-or-remove. The model currently emits `split_into: null` on non-split results rather than
omitting the key; the `Array.isArray` + length-2 guard handles that.

## Depends on

- Content: `node:n_favorite_recipes`
- Agent section: `favorite_recipes`, `context: {cuisines, favorite_dishes}` — used only to
  interpret short entries, never as a filter
- `max_items: 5`

## Writes

`meal_planning_preferences.preferred_recipes`, each as:

```js
{ title: <the agent's label, or the raw entry>, recipe_uuid: null, has_side: false, sides: [] }
```

`recipe_uuid` stays null until `n_compile` — UUID resolution is a later phase.

`title` is read back downstream: [n_fixed_meals.md](n_fixed_meals.md) offers these titles as
dish badges, so an entry written here as a compound or vague string resurfaces as a badge on
that screen.

`value` is **always null** for this section (no slug concept — the target is a title), so `label`
is the only normalised field that matters. Any dedupe or selection logic keying off `value`
needs a branch here.

**No `memory.other` staging.** That runs from the `other_capture` branch in the engine, and this
node declares `validation` at node level instead, so `other.favorite_recipes` is never populated.

## Decisions

- "Other" validated before submit — [2026-09-17](../../diary_log/2026-09-17.md#other-entry-workflow)
