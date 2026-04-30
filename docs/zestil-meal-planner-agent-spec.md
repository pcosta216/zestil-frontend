# Zestil — Meal Planner Agent
## Week Plan Schema + Agent Prompt + Backend Implementation

> **Agent instructions:** This document covers the meal planner feature end to end.
> Implement Section 1 (SQL) first, then Section 2 (backend), then Section 3 (prompt).
> Do not skip steps. All SQL runs in the Supabase SQL editor.
> All Python runs in the existing FastAPI backend on Railway.
>
> **Stack:** Supabase · FastAPI on Railway · Gemini 2.5 Flash
> **Existing functions:**
> - `get_recipe_json_by_uuid(recipe_uuid uuid)` → full recipe JSON including nutrients
> - `get_item_info_json_by_uuid(p_fdcid_uuid uuid)` → ingredient JSON including portions and nutrients

---

## 0. Data Contracts

### Nutrient name mapping
The agent and backend must map raw nutrient names from the DB to user-facing macro names:

| DB `nutrientname` | Macro key | Unit | Type |
|---|---|---|---|
| `Energy` (kcal) | `kcal` | kcal | target |
| `Carbohydrate, by difference` | `carbs` | g | target |
| `Protein` | `protein` | g | target |
| `Total lipid (fat)` | `fat` | g | target |
| `Total Sugars` | `sugar` | g | **upper limit** |
| `Sodium, Na` | `sodium` | mg | **upper limit** |

> **Important:** Sugar and sodium are upper limits, not targets. The agent reasons about
> them differently — "do not exceed" vs "try to reach". Salt in `user_goals` is stored
> as sodium in mg (default 2300mg = FDA daily limit).

### User goals mapping

| `user_goals` column | Macro key | Default |
|---|---|---|
| `kcal` | `kcal` | 2050 |
| `carbohydrates` | `carbs` | 270g |
| `protein` | `protein` | 130g |
| `lipid` | `fat` | 50g |
| `sugar` | `sugar` | 300g (upper limit) |
| `salt` | `sodium` | 2300mg (upper limit) |

---

## 1. Database Schema

### 1.1 Add preferences JSONB to user_goals

```sql
alter table user_goals
  add column if not exists preferences jsonb default '{}';

-- preferences structure:
-- {
--   "meal_slots":       ["breakfast","lunch","dinner","snack"],  -- active slots
--   "planning_style":  "macro_strict" | "macro_flexible" | "suggestions_only",
--   "show_macros":     true,
--   "default_servings": 2,
--   "dietary_flags":   ["gluten-free", "dairy-free"],           -- from knowledge graph
--   "avoided_ingredients": ["uuid1", "uuid2"]
-- }
```

### 1.2 Week plan table

```sql
create table public.tbl_week_plan (
  plan_id          uuid primary key default gen_random_uuid(),
  account_key      text not null,
  week_start_date  date not null,
  -- Always the Monday of the week. Compute with:
  -- date_trunc('week', target_date::timestamp)::date
  status           text not null default 'active'
                   check (status in ('active', 'archived')),
  notes            text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),

  unique (account_key, week_start_date)
);

create index on public.tbl_week_plan (account_key, week_start_date desc);
```

### 1.3 Week plan entries table

```sql
create table public.tbl_week_plan_entries (
  entry_id           uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references public.tbl_week_plan(plan_id) on delete cascade,
  account_key        text not null,

  -- When and what meal slot
  entry_date         date not null,
  meal_slot          text not null
                     check (meal_slot in ('breakfast','lunch','dinner','snack')),

  -- What the user is eating
  entry_type         text not null check (entry_type in ('recipe','ingredient')),

  -- Source reference (for re-fetching if needed)
  source_uuid        uuid not null,
  -- recipe entries:     tbl_recipe_data_header.recipe_uuid
  -- ingredient entries: tbl_ingredients_master_core.fdcid_uuid

  -- Snapshot at time of planning (never changes after creation)
  original_snapshot  jsonb not null,
  -- Full output of get_recipe_json_by_uuid() or get_item_info_json_by_uuid()
  -- This is the immutable baseline. Edits go to adjusted_snapshot.

  -- Agent or user modified version (null if no changes made)
  adjusted_snapshot  jsonb,
  -- Same structure as original_snapshot with modifications applied.
  -- For recipes: may have different serving_multiplier applied to nutrients.
  -- For ingredients: may have different quantity_g.

  -- Quantity controls
  serving_multiplier numeric(6,3) default 1.0,
  -- For recipe entries: 1.0 = as-is, 0.5 = half recipe, 2.0 = double
  -- Applied to all nutrient values when computing daily macros.

  quantity_g         numeric(8,2),
  -- For ingredient entries only. Null for recipe entries.
  -- Macros computed as: (quantity_g / 100) * nutrient_per_100g

  -- Computed macros per entry (per serving_multiplier or quantity_g)
  -- Stored for fast daily/weekly aggregation without re-computing
  macros             jsonb not null default '{}',
  -- {
  --   "kcal":    728.68,
  --   "carbs":   96.14,
  --   "protein": 26.31,
  --   "fat":     23.73,
  --   "sugar":   0.14,
  --   "sodium":  1010.59
  -- }

  -- Pending agent suggestion awaiting user confirmation
  agent_suggestion   jsonb,
  -- {
  --   "type": "serving_change" | "ingredient_swap" | "quantity_change",
  --   "description": "Reduce to 1 serving to stay within your fat goal",
  --   "proposed_multiplier": 0.5,          -- for serving_change
  --   "proposed_quantity_g": 150,           -- for quantity_change
  --   "proposed_snapshot": {...},           -- for ingredient_swap
  --   "macro_impact": {
  --     "kcal":   { "before": 728, "after": 364, "delta": -364 },
  --     "fat":    { "before": 23.7, "after": 11.9, "delta": -11.8 },
  --     "carbs":  { "before": 96.1, "after": 48.1, "delta": -48.0 },
  --     "protein":{ "before": 26.3, "after": 13.2, "delta": -13.1 },
  --     "sodium": { "before": 1010, "after": 505,  "delta": -505 }
  --   },
  --   "suggested_at": "2026-04-28T10:00:00Z",
  --   "status": "pending" | "accepted" | "rejected"
  -- }

  confirmed          boolean default true,
  -- false only when agent_suggestion.status = 'pending'
  -- flips to true when user accepts or rejects

  notes              text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index on public.tbl_week_plan_entries (plan_id, entry_date, meal_slot);
create index on public.tbl_week_plan_entries (account_key, entry_date);
create index on public.tbl_week_plan_entries (plan_id, entry_date);
```

### 1.4 Updated_at triggers

```sql
create or replace function handle_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger tbl_week_plan_updated_at
  before update on public.tbl_week_plan
  for each row execute procedure handle_updated_at();

create trigger tbl_week_plan_entries_updated_at
  before update on public.tbl_week_plan_entries
  for each row execute procedure handle_updated_at();
```

### 1.5 RLS policies

```sql
alter table public.tbl_week_plan         enable row level security;
alter table public.tbl_week_plan_entries enable row level security;

create policy "Users manage own week plans"
  on public.tbl_week_plan for all
  using (account_key = auth.uid()::text);

create policy "Users manage own week plan entries"
  on public.tbl_week_plan_entries for all
  using (account_key = auth.uid()::text);
```

### 1.6 Supabase RPC — daily macro summary

```sql
-- Returns macro totals and remaining budget for a given day.
-- Called by the agent before every planning suggestion.
create or replace function get_daily_macro_summary(
  p_account_key text,
  p_date        date
)
returns json language sql stable as $$
  with goals as (
    select kcal, carbohydrates as carbs, protein, lipid as fat,
           sugar, salt as sodium
    from user_goals
    where account_key = p_account_key
    limit 1
  ),
  day_totals as (
    select
      coalesce(sum((macros->>'kcal')::numeric),    0) as kcal,
      coalesce(sum((macros->>'carbs')::numeric),   0) as carbs,
      coalesce(sum((macros->>'protein')::numeric), 0) as protein,
      coalesce(sum((macros->>'fat')::numeric),     0) as fat,
      coalesce(sum((macros->>'sugar')::numeric),   0) as sugar,
      coalesce(sum((macros->>'sodium')::numeric),  0) as sodium
    from tbl_week_plan_entries
    where account_key = p_account_key
      and entry_date  = p_date
      and confirmed   = true
  )
  select json_build_object(
    'date',    p_date,
    'totals',  json_build_object(
      'kcal',    dt.kcal,
      'carbs',   dt.carbs,
      'protein', dt.protein,
      'fat',     dt.fat,
      'sugar',   dt.sugar,
      'sodium',  dt.sodium
    ),
    'goals',   json_build_object(
      'kcal',    g.kcal,
      'carbs',   g.carbs,
      'protein', g.protein,
      'fat',     g.fat,
      'sugar',   g.sugar,
      'sodium',  g.sodium
    ),
    'remaining', json_build_object(
      'kcal',    g.kcal    - dt.kcal,
      'carbs',   g.carbs   - dt.carbs,
      'protein', g.protein - dt.protein,
      'fat',     g.fat     - dt.fat,
      'sugar',   g.sugar   - dt.sugar,    -- negative = over limit
      'sodium',  g.sodium  - dt.sodium    -- negative = over limit
    ),
    'limits_exceeded', json_build_object(
      'sugar',  dt.sugar  > g.sugar,
      'sodium', dt.sodium > g.sodium
    )
  )
  from day_totals dt, goals g;
$$;
```

### 1.7 Supabase RPC — week macro summary

```sql
-- Returns day-by-day macro breakdown for the full week.
-- Used for weekly overview and agent weekly planning context.
create or replace function get_week_macro_summary(
  p_account_key    text,
  p_week_start_date date
)
returns json language sql stable as $$
  with goals as (
    select kcal, carbohydrates as carbs, protein, lipid as fat,
           sugar, salt as sodium
    from user_goals
    where account_key = p_account_key
    limit 1
  ),
  week_days as (
    select generate_series(p_week_start_date, p_week_start_date + 6, '1 day'::interval)::date as day
  ),
  day_totals as (
    select
      entry_date,
      meal_slot,
      sum((macros->>'kcal')::numeric)    as kcal,
      sum((macros->>'carbs')::numeric)   as carbs,
      sum((macros->>'protein')::numeric) as protein,
      sum((macros->>'fat')::numeric)     as fat,
      sum((macros->>'sugar')::numeric)   as sugar,
      sum((macros->>'sodium')::numeric)  as sodium
    from tbl_week_plan_entries
    where account_key = p_account_key
      and entry_date between p_week_start_date and p_week_start_date + 6
      and confirmed = true
    group by entry_date, meal_slot
  )
  select json_build_object(
    'week_start', p_week_start_date,
    'goals',      row_to_json(g),
    'days',       json_agg(
      json_build_object(
        'date',     wd.day,
        'totals',   json_build_object(
          'kcal',    coalesce(sum(dt.kcal),    0),
          'carbs',   coalesce(sum(dt.carbs),   0),
          'protein', coalesce(sum(dt.protein), 0),
          'fat',     coalesce(sum(dt.fat),     0),
          'sugar',   coalesce(sum(dt.sugar),   0),
          'sodium',  coalesce(sum(dt.sodium),  0)
        ),
        'remaining', json_build_object(
          'kcal',    g.kcal    - coalesce(sum(dt.kcal),    0),
          'carbs',   g.carbs   - coalesce(sum(dt.carbs),   0),
          'protein', g.protein - coalesce(sum(dt.protein), 0),
          'fat',     g.fat     - coalesce(sum(dt.fat),     0),
          'sugar',   g.sugar   - coalesce(sum(dt.sugar),   0),
          'sodium',  g.sodium  - coalesce(sum(dt.sodium),  0)
        ),
        'limits_exceeded', json_build_object(
          'sugar',  coalesce(sum(dt.sugar),  0) > g.sugar,
          'sodium', coalesce(sum(dt.sodium), 0) > g.sodium
        ),
        'by_slot',  json_object_agg(
          coalesce(dt.meal_slot, 'none'),
          json_build_object(
            'kcal',    coalesce(dt.kcal,    0),
            'carbs',   coalesce(dt.carbs,   0),
            'protein', coalesce(dt.protein, 0),
            'fat',     coalesce(dt.fat,     0)
          )
        )
      ) order by wd.day
    )
  )
  from week_days wd
  left join day_totals dt on dt.entry_date = wd.day
  cross join goals g
  group by g.kcal, g.carbs, g.protein, g.fat, g.sugar, g.sodium;
$$;
```

---

## 2. Backend Implementation

### 2.1 `backend/planner_macros.py`

Macro computation helpers. Called before writing any entry to the DB.

```python
# Nutrient name → macro key mapping
NUTRIENT_MAP = {
    "Energy":                      "kcal",
    "Carbohydrate, by difference":  "carbs",
    "Protein":                      "protein",
    "Total lipid (fat)":            "fat",
    "Total Sugars":                 "sugar",
    "Sodium, Na":                   "sodium",
}

# Which macros are upper limits (not targets)
UPPER_LIMITS = {"sugar", "sodium"}


def extract_macros_from_recipe(recipe_json: dict, serving_multiplier: float = 1.0) -> dict:
    """
    Extract and scale macros from get_recipe_json_by_uuid() output.
    recipe_totals contains whole-recipe nutrient values.
    Divides by servings_value to get per-serving, then applies multiplier.
    """
    servings = recipe_json.get("metadata", {}).get("servings_value", 1) or 1
    totals   = recipe_json.get("recipe_totals", [])

    macros: dict[str, float] = {}
    for item in totals:
        key = NUTRIENT_MAP.get(item["nutrientname"])
        if not key:
            continue
        macros[key] = round(
            (float(item.get("total_value", 0)) / servings) * serving_multiplier, 2
        )

    return macros


def extract_macros_from_ingredient(ingredient_json: dict, quantity_g: float) -> dict:
    """
    Extract macros from get_item_info_json_by_uuid() output.
    All nutrient values are per 100g. Scale by quantity_g.
    """
    nutrients = ingredient_json.get("ingredient_nutrients", [])
    macros: dict[str, float] = {}

    for item in nutrients:
        key = NUTRIENT_MAP.get(item["nutrient_name"])
        if not key:
            continue
        per_100g = float(item.get("nutrient_value", 0))
        macros[key] = round((per_100g / 100) * quantity_g, 2)

    return macros


def compute_macro_impact(before: dict, after: dict) -> dict:
    """
    Compute before/after/delta for each macro.
    Used to populate agent_suggestion.macro_impact.
    """
    all_keys = set(before) | set(after)
    return {
        key: {
            "before": before.get(key, 0),
            "after":  after.get(key, 0),
            "delta":  round(after.get(key, 0) - before.get(key, 0), 2)
        }
        for key in all_keys
    }


def check_limits(macros: dict, goals: dict) -> dict:
    """
    Returns which upper-limit macros are exceeded.
    """
    return {
        "sugar_exceeded":  macros.get("sugar",  0) > goals.get("sugar",  300),
        "sodium_exceeded": macros.get("sodium", 0) > goals.get("sodium", 2300),
    }


def format_macro_summary(totals: dict, goals: dict, remaining: dict) -> str:
    """
    Format a compact macro status string for injection into the agent prompt.
    Example:
      Kcal: 728 / 2050 (1322 remaining)
      Carbs: 96g / 270g | Protein: 26g / 130g | Fat: 24g / 50g
      ⚠️ Sodium: 1011mg / 2300mg limit
    """
    lines = []
    lines.append(
        f"Kcal: {totals.get('kcal',0):.0f} / {goals.get('kcal',2050)} "
        f"({remaining.get('kcal',0):.0f} remaining)"
    )
    lines.append(
        f"Carbs: {totals.get('carbs',0):.1f}g / {goals.get('carbs',270)}g  |  "
        f"Protein: {totals.get('protein',0):.1f}g / {goals.get('protein',130)}g  |  "
        f"Fat: {totals.get('fat',0):.1f}g / {goals.get('fat',50)}g"
    )
    sugar_warn  = "⚠️ " if totals.get("sugar",  0) > goals.get("sugar",  300)  else ""
    sodium_warn = "⚠️ " if totals.get("sodium", 0) > goals.get("sodium", 2300) else ""
    lines.append(
        f"{sugar_warn}Sugar: {totals.get('sugar',0):.1f}g / {goals.get('sugar',300)}g limit  |  "
        f"{sodium_warn}Sodium: {totals.get('sodium',0):.0f}mg / {goals.get('sodium',2300)}mg limit"
    )
    return "\n".join(lines)
```

### 2.2 `backend/planner_db.py`

All DB reads and writes for the planner feature.

```python
import os
from datetime import date, timedelta
from supabase import create_client, Client
from planner_macros import (
    extract_macros_from_recipe,
    extract_macros_from_ingredient,
    compute_macro_impact
)

sb: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)


def get_or_create_week_plan(account_key: str, any_date: date) -> dict:
    """
    Get or create the week plan for the week containing any_date.
    Week always starts on Monday.
    """
    week_start = any_date - timedelta(days=any_date.weekday())
    existing = (
        sb.table("tbl_week_plan")
        .select("*")
        .eq("account_key", account_key)
        .eq("week_start_date", week_start.isoformat())
        .execute()
    )
    if existing.data:
        return existing.data[0]
    result = sb.table("tbl_week_plan").insert({
        "account_key":     account_key,
        "week_start_date": week_start.isoformat(),
        "status":          "active"
    }).execute()
    return result.data[0]


def get_daily_summary(account_key: str, target_date: date) -> dict:
    """Fetch computed daily macro summary via RPC."""
    return sb.rpc("get_daily_macro_summary", {
        "p_account_key": account_key,
        "p_date":        target_date.isoformat()
    }).execute().data[0]


def get_weekly_summary(account_key: str, week_start: date) -> dict:
    """Fetch computed weekly macro summary via RPC."""
    return sb.rpc("get_week_macro_summary", {
        "p_account_key":     account_key,
        "p_week_start_date": week_start.isoformat()
    }).execute().data[0]


def get_user_goals(account_key: str) -> dict:
    result = (
        sb.table("user_goals")
        .select("*")
        .eq("account_key", account_key)
        .single()
        .execute()
    )
    return result.data


def add_recipe_entry(
    account_key:        str,
    plan_id:            str,
    entry_date:         date,
    meal_slot:          str,
    recipe_uuid:        str,
    serving_multiplier: float = 1.0
) -> dict:
    recipe_json = sb.rpc(
        "get_recipe_json_by_uuid", {"recipe_uuid": recipe_uuid}
    ).execute().data

    macros = extract_macros_from_recipe(recipe_json, serving_multiplier)

    result = sb.table("tbl_week_plan_entries").insert({
        "plan_id":           plan_id,
        "account_key":       account_key,
        "entry_date":        entry_date.isoformat(),
        "meal_slot":         meal_slot,
        "entry_type":        "recipe",
        "source_uuid":       recipe_uuid,
        "original_snapshot": recipe_json,
        "adjusted_snapshot": None,
        "serving_multiplier": serving_multiplier,
        "macros":            macros,
        "confirmed":         True
    }).execute()
    return result.data[0]


def add_ingredient_entry(
    account_key: str,
    plan_id:     str,
    entry_date:  date,
    meal_slot:   str,
    fdcid_uuid:  str,
    quantity_g:  float
) -> dict:
    ingredient_json = sb.rpc(
        "get_item_info_json_by_uuid", {"p_fdcid_uuid": fdcid_uuid}
    ).execute().data

    macros = extract_macros_from_ingredient(ingredient_json, quantity_g)

    result = sb.table("tbl_week_plan_entries").insert({
        "plan_id":           plan_id,
        "account_key":       account_key,
        "entry_date":        entry_date.isoformat(),
        "meal_slot":         meal_slot,
        "entry_type":        "ingredient",
        "source_uuid":       fdcid_uuid,
        "original_snapshot": ingredient_json,
        "adjusted_snapshot": None,
        "quantity_g":        quantity_g,
        "macros":            macros,
        "confirmed":         True
    }).execute()
    return result.data[0]


def apply_agent_suggestion(entry_id: str, accepted: bool) -> dict:
    """
    Accept or reject a pending agent suggestion.
    If accepted: apply proposed changes, recompute macros.
    If rejected: clear the suggestion, leave entry unchanged.
    """
    entry = (
        sb.table("tbl_week_plan_entries")
        .select("*").eq("entry_id", entry_id).single().execute().data
    )
    suggestion = entry.get("agent_suggestion", {})

    if not accepted:
        return sb.table("tbl_week_plan_entries").update({
            "agent_suggestion": {**suggestion, "status": "rejected"},
            "confirmed": True
        }).eq("entry_id", entry_id).execute().data[0]

    # Apply the suggestion
    update_payload: dict = {
        "agent_suggestion": {**suggestion, "status": "accepted"},
        "adjusted_snapshot": suggestion.get("proposed_snapshot"),
        "confirmed": True
    }

    stype = suggestion.get("type")
    if stype == "serving_change":
        new_multiplier = suggestion.get("proposed_multiplier", 1.0)
        recipe_json    = entry["original_snapshot"]
        update_payload["serving_multiplier"] = new_multiplier
        update_payload["macros"] = extract_macros_from_recipe(recipe_json, new_multiplier)

    elif stype == "quantity_change":
        new_qty         = suggestion.get("proposed_quantity_g", entry["quantity_g"])
        ingredient_json = entry["original_snapshot"]
        update_payload["quantity_g"] = new_qty
        update_payload["macros"]     = extract_macros_from_ingredient(ingredient_json, new_qty)

    elif stype == "ingredient_swap":
        # Macros come from the proposed_snapshot already adjusted
        if suggestion.get("proposed_snapshot"):
            proposed = suggestion["proposed_snapshot"]
            # Re-extract macros from the swapped snapshot
            if entry["entry_type"] == "recipe":
                update_payload["macros"] = extract_macros_from_recipe(
                    proposed, entry.get("serving_multiplier", 1.0)
                )

    return sb.table("tbl_week_plan_entries").update(
        update_payload
    ).eq("entry_id", entry_id).execute().data[0]
```

### 2.3 WebSocket message types — add to `backend/models.py`

```python
# Add to existing WSMessage type literal:
# "plan_add_recipe" | "plan_add_ingredient" | "plan_suggestion_response"
# | "plan_view_day" | "plan_view_week" | "plan_snack_suggestion"

class PlannerContext(BaseModel):
    """
    Injected into every planner agent call.
    Built from DB state before calling the LLM.
    """
    account_key:     str
    target_date:     str           # ISO date string
    week_start:      str           # ISO date string of Monday
    daily_summary:   dict          # output of get_daily_macro_summary
    weekly_summary:  dict          # output of get_week_macro_summary
    user_goals:      dict          # user_goals row
    user_preferences: dict         # user_goals.preferences jsonb
```

---

## 3. Agent Prompt

### System prompt for `backend/main.py` — planner agent

```
You are the meal planning agent for Zestil, a nutrition-aware meal planning app.
You help users plan what to eat across a rolling week, track macros against their
personal goals, and make intelligent suggestions to optimise their nutrition.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXT BLOCK — injected before every response
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You will receive a context block at the start of each conversation turn:

<planner_context>
  date: {target_date}
  week_start: {week_start_date}

  USER GOALS (daily targets and limits)
  Kcal:    {goals.kcal} kcal
  Carbs:   {goals.carbs}g    [target]
  Protein: {goals.protein}g  [target]
  Fat:     {goals.fat}g      [target]
  Sugar:   {goals.sugar}g    [upper limit — do not exceed]
  Sodium:  {goals.sodium}mg  [upper limit — do not exceed]

  TODAY SO FAR ({target_date})
  {format_macro_summary(daily_summary.totals, daily_summary.goals, daily_summary.remaining)}

  THIS WEEK OVERVIEW
  {week_macro_table}
</planner_context>

Read this context before every response. It is the ground truth for the user's
current nutritional state. Never ignore it, never override it with assumptions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 1 — MACRO REASONING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Carbs, protein, and fat are TARGETS. Guide the user toward them.
Sugar and sodium are UPPER LIMITS. Warn when approaching or exceeding them.

When the user adds a recipe or ingredient to their plan:
1. Compute the macro contribution (you will receive this in the plan entry data)
2. Compare against remaining daily budget from the context block
3. If the addition fits within goals → confirm and show updated remaining macros
4. If the addition causes any macro to overshoot by > 10% →
   propose an adjustment BEFORE adding it to the plan (see RULE 3)
5. If only sugar or sodium are exceeded → add the entry but flag the limit breach
   with a ⚠️ warning. Do not block the entry for limit-only breaches.

Always show macros in this compact format after every plan change:

**Today after this addition:**
🔥 Kcal: X / {goal} | 🌾 Carbs: Xg | 💪 Protein: Xg | 🫙 Fat: Xg
{⚠️ Sugar: Xg / {limit}g limit — exceeded} ← only if exceeded
{⚠️ Sodium: Xmg / {limit}mg limit — exceeded} ← only if exceeded

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 2 — PLANNING SCOPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The user can plan:
A) A specific day     — "plan my Tuesday" / "what should I have for lunch today?"
B) A full week        — "plan my week" / "set up next week"
C) A single meal slot — "add salmon to dinner tonight"
D) A snack suggestion — "suggest a snack" (uses remaining macros to find best fit)
E) An ingredient only — "add 200g oats to breakfast" (no recipe required)

For A and B: always show the week overview macro table after planning.
For C: show only the updated day macro summary.
For D: see RULE 4 (snack suggestions).
For E: ask for quantity if not specified before adding to the plan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 3 — AGENT SUGGESTIONS (always ask before applying)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You NEVER apply changes to the plan without explicit user confirmation.
This applies to: serving size changes, ingredient swaps, quantity changes.

When you identify an improvement, present it as a suggestion:

**Suggestion:** [one sentence describing the change and why]

| | Before | After | Change |
|---|---|---|---|
| Kcal | X | X | ±X |
| Carbs | Xg | Xg | ±Xg |
| Protein | Xg | Xg | ±Xg |
| Fat | Xg | Xg | ±Xg |
| Sodium | Xmg | Xmg | ±Xmg |

<quick_replies>
→ "Accept"
→ "Reject"
→ "Show me other options"
</quick_replies>

Suggestion types you can make:
— serving_change: "Reduce to 0.5 servings to stay within your fat goal"
— quantity_change: "Reduce oats to 150g — brings you closer to your carb target"
— ingredient_swap: "Swap vegetable oil for olive oil spray — saves 100kcal"
  (only suggest swaps the knowledge graph has confirmed with weight ≥ 0.75)

Never suggest more than one change at a time.
If the user says "show me other options", suggest a different type of adjustment.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 4 — SNACK SUGGESTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When the user asks for a snack suggestion, use the remaining macro budget
from the context block to find the best fit from their recipe collection.

A good snack suggestion:
— Fills a meaningful macro gap (prioritise the macro furthest from its target)
— Does not push sugar or sodium over the daily limit
— Is realistic for a snack (< 400kcal, ideally ≤ 30 min total time)

Present exactly 2 snack options:

**Snack options for this afternoon:**

1. **[Recipe Title]** — Xcal · Xg protein · Xg carbs
   *Why:* [one sentence anchored to their remaining macro gap]

2. **[Recipe Title]** — Xcal · Xg protein · Xg carbs
   *Why:* [one sentence anchored to their remaining macro gap]

<quick_replies>
→ "[Recipe Title 1]"
→ "[Recipe Title 2]"
→ "Something else"
</quick_replies>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 5 — SHOPPING LIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When the user asks for a shopping list, aggregate all ingredients from
all confirmed recipe and ingredient entries in the plan for the requested
scope (day or week).

Group by category matching recipe_classification food groups:
- 🥩 Protein (meat, fish, eggs, legumes)
- 🥦 Produce (vegetables, fruit)
- 🌾 Grains & Bread
- 🧈 Dairy & Fats
- 🫙 Pantry & Condiments
- 🧂 Spices & Seasonings

Consolidate duplicate ingredients across recipes (combine quantities).
For ingredients with different units (e.g. 1 cup flour + 200g flour),
convert to grams using the ingredient_portions data and sum.

Format:

#### 🥩 Protein
- 360g **salmon fillet** *(Miso Bowl × 2 + Tuscan Salmon)*
- 4 **large eggs** *(Fried Pickles)*

#### 🥦 Produce
- 2 **lemons**
- 1 **yellow onion**

<quick_replies>
→ "Add to this week's plan"
→ "Export as text"
→ "What's already in my fridge?"
</quick_replies>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 6 — WEEK OVERVIEW FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When showing a weekly overview, format it as:

**Week of {week_start_date}**

| Day | Kcal | Carbs | Protein | Fat | Status |
|---|---|---|---|---|---|
| Mon | X / {goal} | Xg | Xg | Xg | ✅ on track |
| Tue | X / {goal} | Xg | Xg | Xg | ⚠️ low protein |
| Wed | — | — | — | — | 📭 not planned |
| ... | | | | | |

Status logic:
✅ on track     = all macros within 15% of target, no limits exceeded
⚠️ [issue]     = any macro > 15% off target OR a limit exceeded — name the issue
📭 not planned = no entries for that day

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 7 — FORMATTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The interface renders Markdown fully.

— Recipe and ingredient names: **bold**
— Macro values: plain numbers with units (no bold — they appear in tables/rows)
— Warnings: ⚠️ prefix, no bold
— Section labels in shopping list: #### (h4)
— Tables for suggestions and weekly overview: markdown table syntax
— Quick replies: always use <quick_replies> block, → prefix, minimum 3 options
— Never use --- as a divider (renders as a heading underline)
— Blank line required after every heading and before every list or table

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 8 — HARD RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
— Never apply a plan change without user confirmation.
— Never compute macros from memory — always use the values provided in the
  plan entry data or context block. Do not estimate nutritional values.
— Never suggest ingredient swaps not confirmed by the knowledge graph.
— If the context block shows a limit already exceeded before the user's
  request, acknowledge it first before planning anything new.
— If the user asks to plan a full week and some days already have entries,
  only suggest meals for the empty slots — never overwrite existing entries.
— Sugar and sodium over-limit entries are always allowed — warn, never block.
— Quantity questions for ingredient entries: always ask before adding if
  quantity is not specified. Never assume a quantity.
```

---

## 4. Context Builder

Called before every planner agent invocation. Builds the `<planner_context>` block.

```python
# backend/planner_context.py
from datetime import date, timedelta
from planner_db import get_daily_summary, get_weekly_summary, get_user_goals
from planner_macros import format_macro_summary


def build_week_macro_table(weekly_summary: dict) -> str:
    """Format the weekly overview as a compact text table for prompt injection."""
    days_data = weekly_summary.get("days", [])
    goals     = weekly_summary.get("goals", {})
    lines     = ["Day | Kcal | Carbs | Protein | Fat | Status"]
    day_names = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

    for i, day in enumerate(days_data):
        t   = day.get("totals", {})
        rem = day.get("remaining", {})
        lim = day.get("limits_exceeded", {})

        has_entries = t.get("kcal", 0) > 0

        if not has_entries:
            status = "📭 not planned"
        elif lim.get("sugar") or lim.get("sodium"):
            status = "⚠️ limit exceeded"
        elif any(abs(rem.get(k, 0)) / max(goals.get(k, 1), 1) > 0.15
                 for k in ["kcal","carbs","protein","fat"]):
            # Find which macro is furthest off
            worst = max(
                ["carbs","protein","fat"],
                key=lambda k: abs(rem.get(k, 0)) / max(goals.get(k, 1), 1)
            )
            direction = "low" if rem.get(worst, 0) > 0 else "over"
            status = f"⚠️ {direction} {worst}"
        else:
            status = "✅ on track"

        lines.append(
            f"{day_names[i]} | "
            f"{t.get('kcal',0):.0f}/{goals.get('kcal',2050)} | "
            f"{t.get('carbs',0):.0f}g | "
            f"{t.get('protein',0):.0f}g | "
            f"{t.get('fat',0):.0f}g | "
            f"{status}"
        )
    return "\n".join(lines)


def build_planner_context(account_key: str, target_date: date) -> str:
    week_start      = target_date - timedelta(days=target_date.weekday())
    goals           = get_user_goals(account_key)
    daily_summary   = get_daily_summary(account_key, target_date)
    weekly_summary  = get_weekly_summary(account_key, week_start)
    week_table      = build_week_macro_table(weekly_summary)

    macro_status = format_macro_summary(
        daily_summary["totals"],
        daily_summary["goals"],
        daily_summary["remaining"]
    )

    return f"""<planner_context>
  date: {target_date.isoformat()}
  week_start: {week_start.isoformat()}

  USER GOALS (daily)
  Kcal:    {goals['kcal']} kcal
  Carbs:   {goals['carbohydrates']}g    [target]
  Protein: {goals['protein']}g  [target]
  Fat:     {goals['lipid']}g      [target]
  Sugar:   {goals['sugar']}g    [upper limit]
  Sodium:  {goals['salt']}mg  [upper limit]

  TODAY SO FAR ({target_date.isoformat()})
  {macro_status}

  THIS WEEK OVERVIEW
  {week_table}
</planner_context>"""
```

---

## 5. Deployment Checklist

Run in this order:

1. Run Section 1 SQL in Supabase SQL editor
2. Add `planner_macros.py`, `planner_db.py`, `planner_context.py` to `backend/`
3. Update `backend/models.py` with `PlannerContext`
4. Add planner WebSocket handler to `backend/main.py`:
   - On planner messages: call `build_planner_context()` first
   - Prepend context block to the conversation history
   - Route to planner agent with the system prompt from Section 3
5. Deploy to Railway
6. Verify RPC functions with:

```sql
-- Test daily summary (replace with real account_key and date)
select get_daily_macro_summary('your-account-key', '2026-04-28');

-- Test weekly summary
select get_week_macro_summary('your-account-key', '2026-04-28');
```

---

## 6. Future Phases

**Phase 2 — Goal adjustment suggestions**
When the agent notices a consistent pattern across multiple weeks (e.g. user always
undershoots protein), it proactively suggests updating `user_goals`.

**Phase 3 — Knowledge graph integration**
Ingredient swap suggestions in RULE 3 currently require manual knowledge graph lookup.
Once `graph_queries.get_substitutes()` is wired to the planner agent, swaps will be
sourced automatically from confirmed `SUBSTITUTES_FOR` edges.

**Phase 4 — Fridge inventory**
Allow users to log what's in their fridge. The snack suggestion logic in RULE 4
filters to recipes whose ingredients are already available.
