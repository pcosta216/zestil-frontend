# Breakfast from a list

**For:** whoever maintains `zestil-frontend`. **From:** the agents repo, 2026-10-18. **Design:** `docs/planner-agent/BREAKFAST_CATALOG.md` (step 8, D45–D60). **Migrations:** `2026101701`–`06`, `2026101810`, `2026101811` (applied); `2026101812`, `2026101813` (the Breakfast Agent, to apply). **Functions:** `breakfasts-catalog` (new), `breakfast-agent` (new) and the other agents (`scripts/deploy-agents.sh`), `optimize-day-agent`.

## What it is

- **Breakfast becomes a list,** like My snacks. Zestil's items, which every user sees, and the user's own. An item is a recipe or a food: Oats 50 g, a boiled egg, Greek yogurt 150 g.
- **The planner composes each breakfast from the list:** as many items as reach breakfast's share of the day's calories (at most 6), the user's own first. Until now a breakfast was one recipe.
- **On the plan,** a recipe item is a recipe entry, as today. A food item is a new entry type, `breakfast`.

## What to build

1. **Plan entries of type `breakfast`.** Show them like a snack food entry (below). **This one is needed as soon as the planner is deployed.** Until then, food items Zestil plans are on the plan and count in the day's totals, but don't show.
2. **Several items at breakfast.** Every breakfast item has role `main`. Show them all; don't assume one main per meal.
3. **The My breakfasts screen,** like My snacks, from `breakfasts-catalog`. Add `breakfasts-catalog` to the endpoint allowlist (`docs/UI_BODY_CONTRACT.md` §4.1, §5.10).
4. **The diet alert for an item added on that screen,** as for sides and snacks (`docs/FRONTEND_DIET_CHANGE.md`, item 3), with kind `breakfast`.
5. **The Breakfast collection is protected,** like Snacks: the database refuses a rename, delete or move. A recipe added to it joins My breakfasts, and one taken out leaves; it works both ways.
6. **The chat** (with the Breakfast Agent): "add Greek yogurt to my breakfasts", "remove the oats from my breakfasts", "what breakfasts do I have". The replies carry `ui_body` blocks like the snacks' (`docs/UI_BODY_CONTRACT.md` §5.2–§5.6, §5.10), calling `breakfasts-catalog`: the added item with an Undo, a removal with an Undo, a new default with an Undo, the Auto switch, and the choice when several items match. Once item 3 adds the endpoint to the allowlist, nothing else is needed.

## The `breakfast` entry

The row in `tbl_week_plan_entries`:

```ts
{
  entry_type: 'breakfast', meal_slot: 'breakfast', role: 'main',
  source_uuid: '<breakfast_uuid>',                 // the list item
  quantity_g: 50,                                  // the amount on the plate, in grams
  macros: { kcal, protein, carbs, fat, sugar, sodium },   // at quantity_g
  original_snapshot: {
    breakfast_uuid: '…', breakfast_kind: 'ingredient', display_name: 'Oats', category: 'cereal',
    divisible: true,                               // false: a whole unit (an egg, a pot)
    ingredient_nutrients: [ /* per 100 g */ ], cooking_assumptions: { /* … */ },
    default_portion_g: 50, category_min_g: 30, category_max_g: 100,   // for the optimizer; the app can ignore them
  },
  adjusted_snapshot: null,                         // set once the optimizer or the user changes the amount
}
```

In a reply's `meal_cards` (and `get_week_plan`) it's the same card as a snack food's: `entry_type: 'breakfast'`, `name` (the item's `display_name`), `quantity_g`, `macros`, `metadata` (the snapshot).

**Compared with a snack entry:** the type is `breakfast`, and the snapshot has `breakfast_kind` and `breakfast_uuid` in place of `snack_kind` and `snack_uuid`, plus the three amounts. Everything else is the same.

## My breakfasts

As My snacks (`docs/UI_BODY_CONTRACT.md` §5.6), on `breakfasts-catalog`, with `breakfast_uuid` (§5.10):
- **The screen:** `POST breakfasts-catalog { action: 'list', view: 'cards' }`. It returns the `ui_body`: a section per category; rows with Remove · Info · Edit · Auto; a Removed section. The rows' buttons call the endpoint themselves.
- **Adding:**
  - a recipe: `{ action: 'add_recipe', recipe_uuid }`;
  - a food: `{ action: 'add_ingredient', fdcid_uuid, hint?, display_name? }`. A food takes a few seconds: a model call works out its nutrition, as for snacks.
- **The account** is the JWT's, as on the other catalog endpoints.

## The diet alert

```ts
const { data } = await supabase.rpc('item_fits_diet', { p_account_key: user.id, p_kind: 'breakfast', p_uuid: item.breakfast_uuid })
// Show the alert when data.ask is true; answer with
// POST breakfasts-catalog { action: 'diet_planning', breakfast_uuid, in_planning: true | false }
```
