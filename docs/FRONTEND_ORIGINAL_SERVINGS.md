# Original servings on a changed entry

**For:** whoever maintains `zestil-frontend`. **From:** the agents repo, 2026-10-22. **Design:** `docs/optimize-day-agent/DECISIONS.md`, 2026-10-21. **Backend code:** `supabase/functions/_shared/entry-quantity.ts` (`originalMultiplier`, `withOriginalMultiplier`), mirrored in `app/planner_macros.py`. **Functions:** `optimize-day-agent`, the shared agents (`scripts/deploy-agents.sh`) and Flask, not deployed yet. No migration.

This doc was written from `Zestil_agent`; the frontend file names below come from earlier audits and weren't checked against the current frontend code.

## The bug

When the optimizer or the user changes the servings of an entry, the card's "original" toggle shows the same macros as the current ones.

- **Affected:** entries sized in servings. That means a recipe (`entry_type: 'recipe'`), or a side, snack or breakfast item whose snapshot kind is `'recipe'` (`side_kind`, `snack_kind` or `breakfast_kind`).
- **Not affected:** foods sized in grams. They already keep `adjusted_snapshot.original_qty_g` (`lib/entry-quantity.ts`).

**Cause:** a serving change stored nothing about the servings before it. `serving_multiplier` held the new value and `adjusted_snapshot` was a plain copy of the snapshot, so the original macros could only be worked out at the current servings.

## What the backend now stores

```ts
serving_multiplier                     // the servings on the plate now (meaning unchanged)
adjusted_snapshot.original_multiplier  // the servings before the FIRST change: a number, written once, never overwritten
```

Every serving change writes it: the optimizer, the planner's `set_entry_amount` ("make it 2 servings") and `accept_suggestion`, and Flask's `apply_plan_suggestion`. A row changed before the backend deploy has no `original_multiplier`.

## What to change

1. **Add the reader to `lib/entry-quantity.ts`,** next to the `original_qty_g` one. If the file already has a "positive number or null" helper, use it instead of the inline one:

   ```ts
   // The servings originally planned: the baseline for the original macros.
   // No stamp means never changed, or changed before 2026-10-21; the column is all there is.
   export function originalMultiplier(entry: any): number {
     const positive = (v: unknown) => { const n = parseFloat(String(v ?? '')); return isFinite(n) && n > 0 ? n : null }
     return positive(entry?.adjusted_snapshot?.original_multiplier) ?? positive(entry?.serving_multiplier) ?? 1
   }
   ```

2. **Use it wherever the app works out an entry's original macros.** That's most likely `app/api/plan/today/route.ts`; grep for `original_snapshot` to find every place. For an entry sized in servings, compute from `original_snapshot` at `originalMultiplier(entry)`, not at `serving_multiplier`:
   - **a recipe:** each `recipe_totals[].total_value` ÷ `metadata.servings_value` × `originalMultiplier(entry)`;
   - **a recipe-kind side, snack or breakfast item:** `macros_per_serving` × `originalMultiplier(entry)`.

   Leave the rest as it is. Current macros stay the `macros` column (or are worked out at `serving_multiplier`). Foods sized in grams stay per 100 g × `originalQtyG(entry)` ÷ 100.

3. **If the app saves a serving change itself** (for example a servings stepper that updates `tbl_week_plan_entries` directly), store the baseline the same way, or the user's own change loses it:

   ```ts
   export function withOriginalMultiplier(entry: any, snapshotBase: any): Record<string, any> {
     return { ...(snapshotBase ?? {}), original_multiplier: originalMultiplier(entry) }
   }

   // entry = the row as read before the change
   update({
     serving_multiplier: next,
     macros,
     adjusted_snapshot: withOriginalMultiplier(entry, entry.adjusted_snapshot ?? entry.original_snapshot),
   })
   ```

   If serving changes go through the backend (chat, accepting a suggestion), there's nothing to do here.

Wherever the app shows an `original_macros` it got from the backend (the planner's day entries), the backend fix covers it once deployed. This doc is only about the app's own calculation.

## Deploy order

Either order is safe. Until the backend is deployed, no row has `original_multiplier`, so the reader falls back to `serving_multiplier` and the toggle shows what it shows today.

## Rows changed before the backend deploy

Their original servings were never stored and can't be recovered. They keep showing original = current. If one of them is changed again, the servings from just before that change become its original.

## Check

| Entry | Servings before | Changed to | Current kcal | Original kcal |
|---|---|---|---|---|
| Recipe-kind snack, `macros_per_serving.kcal: 200` | 1 | 1.5 | 300 | 200 (today: 300) |
| Recipe, `recipe_totals` Energy 2000, `servings_value: 4` | 1 | 1.5 | 750 | 500 (today: 750) |
| The same recipe, changed again | 1.5 | 2 | 1000 | 500: the first baseline stays |

On the app, after the backend deploy:
1. **A serving change shows its original.** Run Optimize Day on a day where it changes the servings of a recipe or a recipe-kind snack, or ask in chat "make the protein shake 2 servings". The row's `adjusted_snapshot.original_multiplier` holds the old servings, and the card's original toggle shows the macros at those servings.
2. **An entry changed before the deploy** shows original = current, with no error.
3. **A food sized in grams** has the same toggle as before.
