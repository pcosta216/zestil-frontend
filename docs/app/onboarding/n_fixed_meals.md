# n_fixed_meals — "Is there any meal that's basically the same every week?"

Status: live · Last verified: 2026-09-22
Component: `app/onboarding/_components/DayMealPicker.tsx` · Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-fixed-meals-dishes.mjs` (dish badges, the Add gate, the
badge→`title` write); `scripts/onboarding-seed/smoke-test.ts` scenario S (the options themselves)
and scenario A (`tuesday fixed_meals` — write shape and `recipe_uuid: null`)

`type: day_meal_picker`, `optional: true`, `repeatable: true`. Builds a local list of
(day, meal slot, dish) entries one at a time, then submits the whole list on Continue. Each entry
is appended to that day's `cooking_profile.day_constraints.<day>.fixed_meals`.

## Behaviour

- **Composer, then list.** A card holds Day pills, Meal pills, Dish pills and a free-text dish
  box. "+ Add this meal" is disabled until the composer holds a day, a meal **and** a dish; it
  pushes a `DayMealEntry` onto local `entries` and resets the composer. Added entries render above
  the card, each with its own Remove. Nothing reaches the server until Continue.
- **The dish has two inputs and they're mutually exclusive.** Picking a badge clears the box,
  typing in the box clears the pick — one field, so the composer can only ever hold one dish.
  `dishLabel = dishPick ?? dish.trim()` is what both the Add gate and the write read.
- **Dish badges are the user's own `preferred_recipes` titles**, resolved by the `dish_name`
  field's `options_source: { from_memory_list: { path, label_field } }` (`lib/onboarding/resolvers.ts`).
  Option value and label are both the title string, because a badge has to write the same thing
  the box would. Anyone who skipped `n_favorite_recipes` gets no badges and no Dish row at all —
  the box is then the only way in.
- **Continue is always enabled**, including with zero entries, and submits
  `{ day_meal_entries: entries }`.
- **Skip is rendered** (the node is `optional`) and submits `{ skipped: true }`.
- **Skip and an empty Continue are equivalent in effect.** The node declares no
  `default_if_empty`, so the skipped branch in `applyAnswer` writes nothing, and an empty
  `day_meal_entries` loop writes nothing either. Both leave every day's `fixed_meals` at `[]`.
- **Day options** come from the shared `content:days_of_week` section — the same list
  `n_week_start` uses.
- **Meal-slot options** come from `options_source: { from_node_options: n_active_slots }`.
  `lib/onboarding/resolvers.ts` resolves that to `n_active_slots`' own content options **plus**
  its `always_include` entries, filtered to the values that actually persisted in
  `meal_planning_preferences.active_slots`. "Snacks" is therefore always offered here, since
  `snack` is force-added upstream; a slot the user unticked is not.
- **Writes are appends, per day.** `writeNodeAnswer` substitutes `{day_of_week}` into
  `cooking_profile.day_constraints.{day_of_week}.fixed_meals` and `appendUnique`s
  `{ title, meal_slot, recipe_uuid }`. Several entries for the same day stack in that day's array.
- **Advances to `n_summary`.**

## Exceptions & gotchas

- **A half-filled composer is discarded silently.** Day and Meal picked but Continue tapped
  without "+ Add this meal" submits without that entry, and no warning is shown. `addEntry` is the
  only path into `entries`.
- **`recipe_uuid` is always `null`.** Nothing populates `DayMealEntry.dish_value`, which is what
  the engine reads for `recipe_uuid` — not the box, and not a badge either: the badges carry
  titles, and their source rows (`preferred_recipes`) hold `recipe_uuid: null` themselves this
  phase. The dish string lands in `title` verbatim. The `type: free_text_search` declaration is
  aspirational; DayMealPicker renders a plain `<input>` with no search.
- **Duplicate entries stack.** `appendUnique` compares with `Array.includes`, which is reference
  equality for the objects written here, so adding the same day/meal/dish twice writes it twice.
  The badges make that easier to do by accident than typing did.
- **`resolve_uuid_via: resolve_recipe_uuid` and `repeatable: true` are declared but unread.**
  Both exist on `FlowNodeStructure` (`lib/onboarding/types.ts`) and nothing in `lib/onboarding/`
  or the components consumes them. The repeat behaviour is the component's local `entries` array,
  not engine-level `repeat_for`; UUID resolution is deferred to the onboarding agent.
- **Back-snapshot covers all seven days.** `collectWriteTargets` expands the `{day_of_week}`
  template across `DAYS_OF_WEEK`, so backing out of this node reverts every day's `fixed_meals`,
  not just the ones that were written. It also **drops any target still holding a `{placeholder}`**,
  this node's raw `writes_to` included: revert `setPath`s every snapshot key, and `setPath`
  creates missing parents, so an unsubstituted path would materialise `"{day_of_week}"` as a real
  key beside monday–sunday. Guarded by smoke-test scenario T and the Back section of
  `scripts/onboarding-seed/verify-fixed-meals-dishes.mjs`.
- **The dish string is not validated.** No `other_capture`, so nothing here goes through the
  Onboarding Validator Agent — any text is accepted as a dish title.

## Depends on

- Content: `node:n_fixed_meals` (`prompt` only) and `content:days_of_week`. The Day/Meal/Dish
  headings are component copy, not content rows.
- `meal_planning_preferences.active_slots` — must already be written, or the meal-slot pill row
  renders empty and no entry can be added
- `meal_planning_preferences.preferred_recipes` — the dish badges. Optional: an empty list hides
  the Dish row rather than blocking the screen ([n_favorite_recipes.md](n_favorite_recipes.md))

## Writes

- `cooking_profile.day_constraints.<day_of_week>.fixed_meals` — appended
  `{ title: <typed text>, meal_slot: <slot value>, recipe_uuid: null }`
