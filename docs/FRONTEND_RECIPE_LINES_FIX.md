# Frontend fix needed: ingredient quantities don't reflect `serving_multiplier`

**For:** whoever has access to the `zestil-frontend` repo (not present in this workspace — this
doc was written from `Zestil_agent` and cannot verify current line numbers there; treat file:line
citations below as pointers from prior audits, not guarantees).

**Companion backend fix, already shipped (2026-09-06):** the identical bug, on the backend, in
`Zestil_agent/supabase/functions/_shared/recipe-lines.ts`. That file is the reference
implementation to port — read it before writing new frontend code, don't reinvent the algorithm.

---

## The bug

A recipe-shaped plan entry's `original_snapshot`/`adjusted_snapshot` JSONB carries `recipe_lines`:
an array of per-ingredient lines (`ingredient_qty`, `ingredient_unit`, `ingredient_text`,
`nutrients[]`). These quantities are **always stored at the recipe's native yield** — the whole
batch that produces `metadata.servings_value` servings — and are **never** rescaled when
`serving_multiplier` changes (this is deliberate on the backend; see "Why this is correct" below).

If the frontend reads `recipe_lines[].ingredient_qty` and displays it next to
`serving_multiplier` — e.g. an ingredient list on a recipe card — without doing this scaling
itself, the ingredient amounts shown are wrong whenever `serving_multiplier != 1`:

- A 4-serving soup recipe has `recipe_lines` for the *whole pot* (`servings_value: 4`). At
  `serving_multiplier: 1` (the default "1 serving" selection), the card should show **1/4** of
  each line's stored quantity — not the full-pot amount.
  Optimizer runs
  (`POST /api/plan/optimise` → `handleOptimise` in `PlanTab.tsx`, per `docs/AGENT_INVENTORY.md`
  and `docs/OPTIMIZER_AGENT.md`) can also change `serving_multiplier` directly (e.g. to `1.5`),
  which the ingredient list must reflect too.

## Where this most likely needs fixing

Two files are named across this repo's prior (line-cited, but unverified this session) audits as
the frontend's own independent implementation of this exact card-building logic — **not** a
passthrough of the Supabase Edge Functions' tool responses:

- **`app/api/plan/today/route.ts`** — computes `is_optimised = !!adjusted_snapshot` itself
  (around line 67 per `docs/OPTIMIZER_AGENT.md`), and reads quantity/snapshot fields per-entry
  (around lines 84, 121). This route almost certainly has its own
  `snap = adjusted_snapshot ?? original_snapshot`-style logic, independently of the backend
  `zestil-agent`/`planner-agent` functions already fixed. If it forwards `recipe_lines` to the
  client at all, this is where to apply the fix.
- **`components/WeekdayRecipeCard.tsx`** — renders the card; line ~90 already has a toggle
  between current and original **aggregate** macros:
  ```tsx
  const displayMacros = (isOptimised && showOriginal && originalMacros) ? originalMacros : macros;
  ```
  and line ~370 area handles the optimised toggle UI. **Not confirmed:** whether this component
  (or a child/detail view) also renders a per-ingredient list from `recipe_lines`. Check this
  first — if the card only ever shows the recipe title + aggregate macros (no ingredient
  breakdown), there may be nothing to fix here at all, and the bug is scoped to wherever a
  per-ingredient list *is* rendered (a recipe detail page/modal, a shopping-list feature, etc.).

**First step, regardless of the above:** `grep -rn "recipe_lines" zestil-frontend/` to find every
actual consumer — don't assume the two files above are exhaustive. Also check
`lib/entry-quantity.ts` — that file already exists as this repo's frontend mirror of the
`quantity_g`/`original_qty_g` convention (`_shared/entry-quantity.ts` on the backend); a new
sibling `lib/recipe-lines.ts` following the same mirroring pattern is the natural home for the
ported fix.

## The fix: port this exact function

From `Zestil_agent/supabase/functions/_shared/recipe-lines.ts` (TypeScript — should port with
minimal changes):

```ts
function nativeServingsValue(snapshot: any): number {
  // Mirrors macrosFromRecipe's servings computation exactly, so a displayed quantity and its
  // displayed macros are always scaled by the same factor.
  return Math.max(parseFloat(snapshot?.metadata?.servings_value ?? '1') || 1, 0.001)
}

export function scaledRecipeLines(snapshot: any, servingMultiplier: number): any[] {
  const lines = snapshot?.recipe_lines
  if (!Array.isArray(lines)) return []

  const mult   = isFinite(servingMultiplier) && servingMultiplier > 0 ? servingMultiplier : 1
  const factor = mult / nativeServingsValue(snapshot)

  return lines.map((line: any) => ({
    ...line,
    ingredient_qty: Math.round((parseFloat(line.ingredient_qty) || 0) * factor * 100) / 100,
    nutrients: (line.nutrients ?? []).map((n: any) => ({
      ...n,
      value: Math.round((n.value ?? 0) * factor * 100) / 100,
    })),
  }))
}
```

**Call it wherever `recipe_lines` is about to be rendered**, passing the entry's current
`serving_multiplier` (default `1` if absent) and the snapshot actually in use
(`adjusted_snapshot ?? original_snapshot`). Do **not** call it before persisting anything —
this must stay a render-time-only transform (see below).

### Worked example, to sanity-check your port

4-serving recipe, `recipe_lines` has one line: `ingredient_qty: 400` (the whole pot).

| `serving_multiplier` | factor (`mult ÷ 4`) | displayed `ingredient_qty` |
|---|---|---|
| `1` (default "1 serving") | 0.25 | 100 |
| `1.5` | 0.375 | 150 |
| `2` | 0.5 | 200 |

If your current code shows `400` regardless of `serving_multiplier`, or shows
`400 × serving_multiplier` (e.g. `600` at `1.5`, instead of `150`) — both are the bug this fixes.
The second form is an easy mistake: skipping the `÷ servings_value` step overstates every
multi-serving recipe (it's only a no-op for `servings_value = 1` single-serving recipes).

## Why this is correct (don't "simplify" it later)

`recipe_lines`/`recipe_totals` must stay at native yield **in the data**, forever — every macro
calculation in the whole system (backend and, presumably, here) uses
`recipe_totals ÷ servings_value × serving_multiplier`. If a future change bakes
`serving_multiplier` into the stored `recipe_lines` instead of scaling at render time, it will
double-count the multiplier the next time aggregate macros are computed from the same data. The
scaling belongs **only** at the point of display — never written back, never sent as an update.

## Non-goals

- Don't touch the existing `displayMacros`/`isOptimised`/`originalMacros` toggle logic in
  `WeekdayRecipeCard.tsx` — that's aggregate-macros-only and is already correct per the backend
  fix shipped 2026-09-05 (`adjusted_snapshot` is now stamped on every serving change).
- Don't change how `serving_multiplier` itself is computed or persisted — this is purely a
  read/render transform of `recipe_lines` for display.

## Verification

1. Confirm whether an ingredient list is rendered anywhere from a plan entry's `recipe_lines` at
   all (per the "not confirmed" note above) — if not, this fix may not be needed on this repo
   right now; document that and stop.
2. If it is: add a multi-serving recipe to a day's plan, use the optimizer (or any UI action) to
   set `serving_multiplier` to something other than `1`, and confirm the displayed ingredient
   quantities divide/multiply consistently with the worked example above and with the card's
   displayed aggregate macros.
3. Confirm nothing writes the scaled values back to the API (network tab: no `PATCH`/`PUT` firing
   from the render path).
