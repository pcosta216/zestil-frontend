# A change of diet

**For:** whoever maintains `zestil-frontend`. **From:** the agents repo, 2026-10-15. **Design:** `docs/AGENT_SPLIT_DESIGN.md` step 7 (D38–D43). **Migrations:** `2026101501_diet_rules.sql`, `2026101503_diet_rows_backfill.sql`, `2026101504_diet_search_progress.sql`, `2026101505_preferences_diet_change.sql`.

## What it is

A user can tell Zestil in chat "I want to adopt a keto diet" (or vegan, vegetarian, low carb…). The Preferences Agent asks whether they mean only that diet or some of its dishes, confirms, saves it, offers new goals and offers to look for 10 new recipes for the diet.

What the diets mean, everywhere (owner, D38):
- **One diet is strict.** Recipes, sides and snacks that don't fit it are kept out of automatic planning. They stay saved, and come back when the diet ends.
- **Several diets are a preference.** Recipes of any of them are fine; nothing is kept out.
- **A diet Zestil can't check yet** (paleo) is a preference only.

The rule applies however the diets change: chat, onboarding, or your profile screen writing `dietary.diet_type.preferred`. A database trigger keeps the kept-out items in step.

## What to build

1. **The search's progress screen.** When a chat reply has `recipe_search`, open a progress screen like the one at the end of onboarding. It reads its own record, never onboarding's (below).
2. **The alert for a new recipe.** When the user saves a recipe while on one diet, and it doesn't fit, ask once it is classified: "This recipe doesn't fit your keto diet. Should it be used in automatic planning?" Until they answer, it is planned (owner: nothing new is kept out by itself).
3. **The same alert for a side or snack added from the app's own screens.** In chat it is already on the added item's card (`docs/UI_BODY_CONTRACT.md` §5.9), and the catalog endpoints answer its buttons.
4. **Why an item is off.** On the recipes' planning switch (D37), show "not keto" when only the diet keeps a recipe out. The sides' and snacks' "Removed" rows from the catalog endpoints already say "· not keto" in their detail.

## How to call it

All of these are Postgres functions, called with the signed-in user's Supabase client (their JWT). `p_account_key` must be the user's own id: any other id is refused.

### 1. The search's progress screen

The chat reply that started a search carries:

```ts
reply.recipe_search   // { diet: 'keto', run: '2026-10-15T09:12:44.120Z', target: 10 }
```

Its progress is in the user's memory, `memory_json.diet_search`:

```ts
const { data } = await supabase.from('tbl_user_memory').select('search:memory_json->diet_search').single()
// data.search: {
//   diet: 'keto', run, status: 'running' | 'complete' | 'failed', started_at, finished_at,
//   items: [{ name: 'Keto recipes', status: 'waiting' | 'in_process' | 'complete' | 'failed', type: 'fill',
//             found, accepted, saved, rejected, failed, recipes: [{ uuid, title, saved }], note, error, updated_at }]
// }
```

The items have the same shape as onboarding's `memory_json.onboarding.recipe_discovery`, so the same screen can render them. Poll until `status` is `complete` or `failed`. A newer search replaces the record (a new `run`). The saved recipes are in the user's recipes as usual. Onboarding's record and the setup check (`mode: 'ensure'`) are not touched.

### 2 and 3. The alert

**Does it fit?** Call this once the item is saved (for a recipe, once its classification is done):

```ts
const { data } = await supabase.rpc('item_fits_diet', {
  p_account_key: user.id,
  p_kind: 'recipe',                  // 'recipe' | 'side' | 'snack'
  p_uuid: recipe.recipe_uuid,        // side_uuid / snack_uuid for the others
})
// data: { ok: true, strict_diet: 'keto', label: 'Keto', fits: false, why: 'not keto',
//         kept_out: false, kept_in: false, ask: true }
// data: { ok: true, strict_diet: null, fits: null, ask: false }   // no strict diet: nothing to ask
```

Show the alert when `ask` is true. `why` is short and readable ("not keto", "41.7 g of net carbs a portion, over 12.5 g", "not classified yet"). `kept_in`: the user already chose to keep it, so don't ask again.

**The answer:**

```ts
const { data } = await supabase.rpc('set_diet_planning', {
  p_account_key: user.id, p_kind: 'recipe', p_uuid: recipe.recipe_uuid,
  p_in_planning: true,               // true: use it in automatic planning; false: keep it out while on the diet
})
// data: { ok: true, kind, uuid, name, strict_diet: 'keto', label: 'Keto', in_planning: true }
```

Either answer is remembered. A yes stays a yes when the diet's list is worked out again, for example after a new carb goal. A no comes back when the diet ends.

### 4. Why a recipe is off

`list_recipes_out_of_planning` (D37) now lists each recipe once, with its reasons:

```ts
// data.recipes: [{ recipe_uuid, meal_title, since, reasons: ['diet:keto'] }]
//   'user'       the user switched it off
//   'diet:keto'  the keto diet keeps it out: show "not keto" (the label: tbl_diet_rules.label, or the diet's name)
```

A recipe can have both reasons. Switching it back on (`set_recipe_planning`, `p_in_planning: true`) brings it back whatever the reason. Doing that while on the diet overrides the diet for that recipe (owner), and Zestil remembers it.

When you read `tbl_user_recipes_exclusions` directly for the switch states, a recipe can now have two rows (a `reason` column). Use the set of `recipe_uuid`s, as before.

## If your profile screen changes diets

Writing `dietary.diet_type.preferred` in the memory still works: a trigger works out what the diet keeps out. To show what a switch would do first, the function the agent uses is available:

```ts
await supabase.rpc('apply_diet', { p_account_key: user.id, p_diet: 'keto', p_mode: 'preview' })
// mode: 'preview' (nothing saved: what only keto would keep out), 'strict', 'add', 'stop'
```

## Nothing else changes

- Onboarding and its screens are unchanged.
- The recipes' switch (D37), the sides and snacks lists, and their Restore work as before. A Restore also overrides the diet for that item.
