# Optimiser: Frontend Mount Fix

## What was built

A new `optimize-day-agent` Supabase Edge Function adjusts a day's meal plan entries
to better meet the user's nutritional goals. It operates on two levels:

- **Level 1** — adjusts `serving_multiplier` on `tbl_week_plan_entries`
- **Level 2** — writes a modified recipe JSON to `tbl_week_plan_entries.adjusted_snapshot`
  and updates `tbl_week_plan_entries.macros` to reflect the new values

The planner agent and the `/api/plan/today` route both already select `adjusted_snapshot`
from the DB and use it for display (`adjusted_snapshot ?? original_snapshot`).

## The bug

On mount, `PlanTab.tsx` calls `fetchDayCards` → `GET /api/plan/today?date=…` →
`rowToMealCard()`. That mapper uses the adjusted snapshot for `metadata` and `name`
correctly, but it never sets `is_optimised` or `original_macros` on the card.

As a result:

- `WeekdayRecipeCard` receives `isOptimised={undefined}` → the **"✦ optimised" toggle
  button is hidden** even though `adjusted_snapshot` exists in the DB
- `originalMacros={undefined}` → there is nothing to toggle to

The optimiser button in `WeekdayGrid` triggers a manual run that does the same
`getDayEntries` fetch via the edge function, which correctly returns both fields.
That is why it works after a manual trigger but not on mount.

## Files to change

### 1. `/app/api/plan/today/route.ts`

**Add `is_optimised` and `original_macros` to `rowToMealCard`.**

The `macros` column on the entry already holds the adjusted values (the optimiser
updates it). `original_macros` must be computed from `original_snapshot` using the
same nutrient extraction the planner agent uses.

Replace the `rowToMealCard` function with the version below:

```typescript
const NUTRIENT_MAP: Record<string, string> = {
  "Energy":                      "kcal",
  "Carbohydrate, by difference": "carbs",
  "Protein":                     "protein",
  "Total lipid (fat)":           "fat",
  "Total Sugars":                "sugar",
  "Sodium, Na":                  "sodium",
};

function extractRecipeMacros(
  snapshot: any,
  servingMultiplier: number,
): Record<string, number> {
  const servings = Math.max(
    parseFloat(snapshot?.metadata?.servings_value ?? "1") || 1,
    0.001,
  );
  const macros: Record<string, number> = {};
  for (const item of (snapshot?.recipe_totals ?? [])) {
    const key = NUTRIENT_MAP[item.nutrientname ?? ""];
    if (!key) continue;
    const total = parseFloat(item.total_value ?? "0") || 0;
    macros[key] = Math.round((total / servings) * servingMultiplier * 100) / 100;
  }
  return macros;
}

function extractIngredientMacros(
  snapshot: any,
  quantityG: number,
): Record<string, number> {
  const macros: Record<string, number> = {};
  for (const item of (snapshot?.ingredient_nutrients ?? [])) {
    const key = NUTRIENT_MAP[item.nutrient_name ?? ""];
    if (!key) continue;
    const per100g = parseFloat(item.nutrient_value ?? "0") || 0;
    macros[key] = Math.round((per100g / 100) * quantityG * 100) / 100;
  }
  return macros;
}

function rowToMealCard(e: any) {
  const isOptimised = !!e.adjusted_snapshot;
  const snap = e.adjusted_snapshot ?? e.original_snapshot ?? {};
  const name = e.entry_type === "recipe"
    ? (snap.metadata?.meal_title ?? snap.meal_title ?? "Unknown recipe")
    : (snap.ingredient_name ?? snap.description ?? "Unknown ingredient");

  const m    = e.macros ?? {};
  const mult = parseFloat(e.serving_multiplier ?? "1") || 1;
  const qty  = parseFloat(e.quantity_g ?? "0") || 100;

  // Compute original macros so the toggle has before/after data
  let originalMacros: Record<string, number> | undefined;
  if (isOptimised && e.original_snapshot) {
    originalMacros = e.entry_type === "recipe"
      ? extractRecipeMacros(e.original_snapshot, mult)
      : extractIngredientMacros(e.original_snapshot, qty);
  }

  const card: any = {
    entry_id:          e.entry_id,
    day:               new Date(e.entry_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" }),
    date:              e.entry_date,
    meal_slot:         e.meal_slot,
    entry_type:        e.entry_type,
    name,
    macros: {
      kcal:    Math.round(m.kcal    ?? 0),
      protein: parseFloat((m.protein ?? 0).toFixed(1)),
      carbs:   parseFloat((m.carbs   ?? 0).toFixed(1)),
      fat:     parseFloat((m.fat     ?? 0).toFixed(1)),
      sugar:   parseFloat((m.sugar   ?? 0).toFixed(1)),
      sodium:  Math.round(m.sodium   ?? 0),
    },
    is_optimised:       isOptimised,
    original_macros:    originalMacros,
    confirmed:          e.confirmed ?? true,
    notes:              e.notes ?? null,
    agent_suggestion:   e.agent_suggestion ?? null,
    metadata:           snap,
    recipe_uuid:        snap.recipe_uuid ?? null,
    serving_multiplier: mult,
  };
  if (e.entry_type !== "recipe") {
    card.quantity_g = qty;
  }
  return card;
}
```

No changes needed to the `GET` handler itself — it already selects both
`original_snapshot` and `adjusted_snapshot`.

---

### 2. Verify `MealCard` interface in `PlanTab.tsx`

The interface already has the new fields (added during the optimiser build):

```typescript
interface MealCard {
  // …existing fields…
  original_macros?:  { kcal: number; protein: number; carbs: number; fat: number; sugar: number; sodium: number };
  is_optimised?:     boolean;
}
```

If these are missing, add them.

---

### 3. Verify `WeekdayRecipeCard` receives the new props

In `DayGrids` (inside `PlanTab.tsx`), confirm the card renders with:

```tsx
<WeekdayRecipeCard
  …
  isOptimised={card.is_optimised}
  originalMacros={card.original_macros}
/>
```

These props are already wired — just verify they haven't been accidentally removed.

---

## How the toggle works (for context)

`WeekdayRecipeCard` has:

```typescript
const [showOriginal, setShowOriginal] = useState(false);
const displayMacros = (isOptimised && showOriginal && originalMacros)
  ? originalMacros
  : macros;
const displayKcal = displayMacros?.kcal ?? kcal;
```

When `isOptimised` is `true`, a pill button appears on the card:
- Default: **"✦ optimised"** (green) — shows adjusted macros
- After tap: **"original"** (grey) — shows pre-optimisation macros

The pill only renders when `isOptimised === true`, which is why the mount fix matters.

---

## Test checklist

1. Load the plan tab fresh (hard-refresh, no prior interaction)
2. Confirm a day that has been optimised shows the **"✦ optimised"** badge on its cards
3. Tap the badge — macros should switch to the original values
4. Tap again — macros should return to the optimised values
5. Click **Optimise** on a non-optimised day → badge should appear after completion
6. Hard-refresh again → badge should still be present (mount fix confirmed)
