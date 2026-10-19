# Profile tab — name, "About you", read-only cards, user id

Status: built; biometrics saves need the migration below applied · Last verified: 2026-10-17
Component: `app/zestil/ProfileTab.tsx`, `app/zestil/BiometricsCard.tsx`, `app/zestil/ProfileCard.tsx` ·
Route: `app/api/profile/route.ts` · Shared: `lib/profile.ts`, `lib/profile-sections.ts` ·
Migration: `supabase/migrations/20261017_update_memory_biometrics.sql`
Verify: no script. Checked on 2026-10-17: `npx tsc --noEmit` passes, `PATCH /api/profile` without a
session answers 401, and `convertMeasurement` round-trips 180 cm → 71 in → 180 cm and 70 kg → 154 lb → 70 kg.
`buildProfileSections` was run on a made-up memory against the live content tables and gave the
labels below. No save has been run against a live backend, and no real account's cards were viewed.

Two sources, two edits. The name is `tbl_user_profiles.display_name`; "About you" is five fields of
`tbl_user_memory.memory_json`. The other cards show more of `memory_json`, read-only.

## Layout

- **Header:** avatar (`UserAvatar`), display name with an edit pencil, email. The email is the
  profile row's, else the auth email, and is never editable here.
- **About you** (`BiometricsCard`): units, gender, age, height, weight, with the same pencil
  (`EditButton`) as the name.
- **Diet & health, Taste, Planning** (`ProfileSectionCard`): read-only, built on the server.
  All four cards share `ProfileCard`'s frame and its 44px row, so they read as one list.
- **User id:** `user.id`, left-aligned at the bottom of the scroll area, `select-all` for copying.
- **Sign out**, pinned below the scroll area.

## Name

- The pencil opens an input (`maxLength` = `DISPLAY_NAME_MAX`, 60). Enter or Save saves, Escape or
  Cancel closes. An unchanged name closes without a request.
- `normalizeDisplayName` trims; an empty name saves `null`, shown as "No name set".
- `PATCH /api/profile` `{ display_name }` updates the user's own row (the `_update_own` RLS policy)
  and answers `{ display_name }`; 404 when there's no profile row.

## About you

- **Loaded with the page.** `loadProfileBiometrics` in `app/zestil/page.tsx` reads `loadUserMemory`
  and `renderNodeBase("n_biometrics")`, so labels, options and bounds are the onboarding screen's own
  ([n_biometrics.md](onboarding/n_biometrics.md)). If either fails, the card says it couldn't load
  and the rest of the tab is unaffected.
- **Read-only rows:** label on the left; on the right an option's label, a measurement with its unit
  label from `range_by_unit` (`180 cm`), or "Not set". Each row is a button: it starts editing like
  the pencil does, and a measurement's row focuses its input.
- **Editing happens in place.** Each row keeps its label and its height (44px, the same wrapper in
  both modes), and only the value turns into its control: chips for units and gender, a number
  input with its unit for the measurements. Errors show under their row; Cancel and Save appear
  under the card's rows. `validateBiometrics` runs on every change and every issue shows at once
  (the editor opens filled in). Save is disabled while any issue stands or nothing changed. A
  cleared measurement saves `null`.
- **Switching units converts** the height and weight already typed, to the nearest whole unit
  (`convertMeasurement`: cm ÷ 2.54, kg × 2.20462). Only from a known system: with no units stored
  yet, the numbers are left as typed.
- `PATCH /api/profile` `{ biometrics: { units, gender, age, height, weight } }` re-runs
  `validateBiometrics` against the same fields, and also rejects a non-number measurement and a
  units or gender value outside its option list. Then it calls `update_memory_biometrics`.

After either save the tab calls `router.refresh()`: the header avatar reads the page's props, and a
back navigation from a recipe page would otherwise restore the cached page with the old values.

## Read-only cards

`buildProfileSections` (`lib/profile-sections.ts`) runs in `app/zestil/page.tsx` on the memory
`loadProfileMemory` already read for "About you", and hands the tab rows with labels resolved. A
list shows as tags, a grouped row (fixed meals) as day headers under its label, a single value as
text, nothing as "None" or "Not set". If building them fails
the three cards are left out and "About you" still shows.

| Card | Row | Memory path | Labels from |
|---|---|---|---|
| Diet & health | Diet | `dietary.diet_type.preferred` | `node:n_diet_style_cards` options |
| | Diets to avoid *(when set)* | `dietary.diet_type.to_avoid` | same |
| | Allergies | `dietary.allergies` | `node:n_allergies` options |
| | Intolerances | `dietary.intolerances` | `curated:intolerance.common` |
| | Foods you avoid | `dietary.avoided_foods` | the three exclusion decks' options |
| | Health notes, Notes *(when set)* | `dietary.health_condition_notes`, `dietary.notes` | free text |
| Taste | Regions | `taste_profile.cuisines` | `node:n_cuisine_broad` options |
| | Cuisines | `taste_profile.sub_cuisines` | `tbl_cuisines_onboarding.display_name` |
| | Favourite dishes | `taste_profile.favorite_dishes` | those cuisines' `popular_dishes` |
| | Go-to meals | `meal_planning_preferences.preferred_recipes[].title` | the titles |
| | Pairings you like / skip *(when set)* | `preferred_pairings`, `forbidden_pairings` | main from `curated:pairing.sides`, sides' titles |
| Planning | Macro priority | `meal_planning_preferences.macro_priority` | "Protein, then fat, then carbs" |
| | Meals | `meal_planning_preferences.active_slots` | `node:n_active_slots` options + its `always_include` (Snacks) |
| | Week starts on | `profile.locale.week_start_day` | `content:days_of_week` |
| | Fixed meals *(when set)* | `cooking_profile.day_constraints.*.fixed_meals` | under the label, each day (from the week start) as a header with its meals under it as sub-headers, in `n_active_slots` order, titles A–Z |

- **Every label lookup is soft.** A failed read or an unknown code falls back to the stored text:
  a bare slug is humanised (`bacalhau` → "Bacalhau"), typed text keeps its wording with a capital
  first letter. "other" (the trigger, not an answer) and "none" are dropped, so "None of these"
  reads as "None".
- **A skipped `n_goal`** stores the goal's slug instead of an ordering
  ([n_goal.md](onboarding/n_goal.md)); the row then shows the goal's label.
- **Not shown:** pantry, skill, budget, household size, cooking days, batch cooking, calorie
  budgets, variety rules, and bookkeeping (`version`, `consent`, `planning_history`,
  `explorer_handoff`, `diet_search`, `other`). Onboarding doesn't fill the first group.

## The memory write

`update_memory_biometrics(p_units, p_gender, p_age, p_height, p_weight)` writes exactly
`profile.locale.units` and `profile.biometrics.{gender,age,height,weight}`, and leaves the rest of
`memory_json` as it is, `last_updated` included. Security invoker, always `auth.uid()`'s row. It
locks the row from read to write (`select … for update`), so a concurrent single-statement write to
another part of `memory_json` (an agent's `diet_search`) is never lost.

## Exceptions & gotchas

- **Until the migration is applied, biometrics saves fail.** The function doesn't exist, so the
  route answers 500 and the card shows "Couldn't save your details. Try again." Name saves don't
  depend on it.
- **The lock covers single-statement writers only.** A writer that reads `memory_json`, works, and
  writes the whole object back later can still overwrite an edit made in between.
- **Nothing reads biometrics yet** (neither this app nor the meal planner spec), so an edit triggers
  nothing downstream.

## Depends on

- `node:n_biometrics` in `tbl_onboarding_content` (labels, options) and the `n_biometrics` fields
  in `content/onboarding/flow-structure.yaml` (bounds)
- `update_memory_biometrics`, from the migration above
