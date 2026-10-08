# Plan tab — chat-first meal planner

Status: live · Last verified: 2026-09-25
Component: `app/zestil/PlanTab.tsx` (mounted by `app/zestil/AppShell.tsx`) · Cards:
`components/WeekdayGrid.tsx`, `components/WeekdayRecipeCard.tsx` · Mapper: `lib/plan-card.ts`
Verify: `scripts/plan-seed/verify-plan-tab.mjs` — seeds real `tbl_week_plan_entries` rows (plain
recipe, optimised recipe, ingredient, and a delete target) for `doe@gmail.com` after walking her
through onboarding for real goals data, then drives the tab in a browser

One of five tabs in `AppShell` (`NAV_ITEMS`, `AppShell.tsx:110-160`) — first in the nav bar, but
**not** the default: `activeTab = searchParams.get("tab") ?? "explore"` (`AppShell.tsx:25`), so
Plan only shows once the URL carries `?tab=plan`. All five tab bodies mount at once and are
toggled with a `hidden` class instead of being conditionally rendered (`AppShell.tsx:63-78`), so
PlanTab's mount-time fetches and its whole chat/session state fire on page load and persist across
tab switches regardless of which tab is in front. There's no `app/zestil/plan/` route — Plan is
client tab state, not a page of its own. `groceries`, also in `NAV_ITEMS`, is a static "Coming
soon" placeholder, not a real tab.

## Behaviour

**Mount** (`PlanTab.tsx:494-536, 703-707`): fetches `/api/plan/week` for a 21-day window (today
±10) to light up date-strip dots; fetches `/api/goals` once for `macro_goals` and
`preferences.{meal_slots,week_start_day}` (sourced from `tbl_user_goals.macro_goals` and
`tbl_user_memory.memory_json.meal_planning_preferences.active_slots` /
`.profile.locale.week_start_day` — both written by onboarding, `app/api/goals/route.ts`); seeds
the transcript with a static welcome message, then appends today's day view. Both `/api/goals`
queries use `.single()`, so an account with no `tbl_user_goals` row 500s there silently (caught,
logged, nothing shown) — and without `macro_goals`, `WeekdayGrid` renders no macro rings at all,
since a ring is only included for a key where `goals[key] > 0` (`WeekdayGrid.tsx:67-68`); the
card's own kcal pill is unaffected.

**Chat loop** (`sendMessage`, `PlanTab.tsx:603-701`): posts to `POST /api/plan` — a thin proxy
(`app/api/plan/route.ts`) to a Supabase Edge Function, `router-agent`, via `PLAN_FUNCTION_URL` or
`<NEXT_PUBLIC_SUPABASE_URL>/functions/v1/router-agent` — with the message, a per-mount
`session_id` (`crypto.randomUUID()`), and **three** history arrays: `apiHistory` (everything) plus
`plannerHistory`/`exploreHistory`, split after each reply by `data._router?.routed_to` — the
backend can route a message typed in the Plan tab to an "explore" sub-agent, and its turns are
tracked separately from the planner's own. `activeDate` (a ref) tracks the one day the agent is
currently talking about — set from `changed_dates`/`meal_cards[].date` when a reply touches
exactly one date, cleared to `null` on a multi-day reply, also set by tapping a date-strip day —
sent as `active_date` on every request, and read back to decide whether a reply should also
trigger a fresh day-view append (`datesInResponse.includes(selectedDate)`).

`response_type` selects the bubble:

| `response_type` | Renders |
|---|---|
| `week_plan` / `day_update` | `PlanBubble` — parses day headers and `Breakfast:`-style slot lines out of plain text (`PlanTab.tsx:112-137`) |
| `recipe_list` | plain markdown |
| `macro_summary` | regex-parses `"N kcal … / goal"` out of the text into a ring; text-only if the phrasing doesn't match (`PlanTab.tsx:158-161`) |
| `suggestion_pending` | Confirm / Reject buttons that resend the canned phrases `"Yes, confirm the change"` / `"No, keep the original"` |
| `ingredients_list` | `WeekdayRecipeCard` rows (`cardVariant="ingredient"`) with an Add action |
| `recipe` | markdown + a hero image if `metadata.media.image_url` is set |
| `feedback` | generic markdown bubble, content is the `ui_body` (below). `meal_cards` / `changed_dates` are **ignored** on this type, so the reply neither renders a plan grid nor triggers the day-view re-fetch — the chat just continues |
| anything else (`info`, …) | generic markdown bubble |

**`ui_body`** (any response type; contract in `docs/UI_BODY_CONTRACT.md`): parsed by
`lib/ui-body.ts:parseUiBody` (unknown block types dropped) and rendered below the bubble by
`components/UiBodyBlocks.tsx` — `text`, `button`, `choice`. A button/choice `call` goes from the
browser straight to `<NEXT_PUBLIC_SUPABASE_URL>/functions/v1/<endpoint>` with the user's JWT
(allowlist: `sides-catalog`), then the reply's `ui_body` (or its `message` as a `text` block)
replaces the blocks on that one chat message, without scrolling the chat. If `ui_body` has a
`text` block, the model's own sentence is not shown.

**Day/week grid** (`DayGrids`, `PlanTab.tsx:304-372`): groups `MealCard[]` by weekday, sorts
within a day by the account's `meal_slots` order then `main → side → dessert` (`ROLE_ORDER`), and
renders one `WeekdayGrid` per day with a summed `MacroData` for the rings. A day with no real
entries gets one synthesized `emptyCard` (`entry_type: "empty"`, `PlanTab.tsx:392-405`) so the
header still renders, with "Not planned yet — ask me to add something" instead of cards. Every
`WeekdayGrid` gets an **Optimise** button whenever a `date` is passed, even an empty one.
`handleOptimise` (`PlanTab.tsx:729-769`) posts `{ date_str }` to `/api/plan/optimise` (proxying
another Edge Function, `optimize-day-agent`), re-fetches just that day, and splices it back into
**the specific transcript block the button lived in** — not a global refresh — showing a result
banner either way.

Each row is a `WeekdayRecipeCard`, collapsed by default to a 40px bar (name, kcal pill, optimised
badge); tapping it expands an actions strip — Macros / More / Delete for recipe-shaped entries,
Add / More / Info for the `ingredients_list` variant. `lib/plan-card.ts:rowToMealCard` is the one
place `is_optimised` / `original_macros` / `quantity_g` are computed from a raw
`tbl_week_plan_entries` row; it's shared by the `today` and `week` routes specifically so they
can't drift apart on that mapping (its own header comment says so).

**Recipe save** (`responseType === "recipe"` messages only, `PlanTab.tsx:800-930`): a heart button
opens a collections checklist (`collections` come from the page's initial props, filtered to drop
any collection literally named `"main"`, `PlanTab.tsx:419`). Saving does one of two things
depending on whether the message already carries a `recipe_uuid`: a known one goes to the
Supabase RPC `link_user_recipe` (`PlanTab.tsx:864`, same call ExploreTab.tsx uses); otherwise
`POST /api/recipe/submit` with the raw message text, then, if any collections were checked,
`POST /api/recipe/collections`. Either way success calls `onRecipeSaved?.()`, which `AppShell`
wires to a `GET /api/recipes` refetch that updates the Saved tab's list (`AppShell.tsx:33-38,
64`).

## Exceptions & gotchas

**The `+ Dinner` / `+ Lunch` / `+ Snack` chips next to the heart button do nothing.**
`selectedSlots` (`PlanTab.tsx:446, 906-927`) only toggles their own highlight; nothing reads the
map afterward, and no request is ever sent for a slot pick.

**The optimised badge and the expanded action bar are mutually exclusive.**
`isOptimised && !barOpen` (`WeekdayRecipeCard.tsx:361`) — tapping a row to reach Delete/Macros
hides the "✦ optimised" pill until the row collapses again. Not lost, just not drawn there.

**"View Recipe" on a non-recipe card opens an empty overlay.** It's always offered
(`DEFAULT_MORE_OPTIONS`, unconditional on `cardVariant`), but the fetch behind it is gated on
`recipeUuid` (`WeekdayRecipeCard.tsx:93-102`) — an ingredient-shaped entry has none, so the
overlay opens to just the "← Back" header and nothing else, no error message. "Show Macros" on the
same card works fine: the macro panel's fallback branch (`!loading && !recipe && displayMacros`,
`WeekdayRecipeCard.tsx:296`) renders rings straight from the card's own `macros`/`originalMacros`
props, independent of the recipe fetch.

**The macro-overlay rings are cosmetic, not proportional.** Both branches of the expanded macro
panel hardcode `strokeDasharray={circ * 0.75}` (`WeekdayRecipeCard.tsx:278, 307`) — the ring
always draws at 75% regardless of value; only the center label number is real. `WeekdayGrid`'s own
per-day rings genuinely scale to `goals` — this overlay's rings don't scale to anything.

**Frozen snapshots.** Every date-strip tap, or the "w" week button, fetches fresh from the DB and
appends a **new** block rather than patching one already on screen — scrolling back shows what a
day looked like at the moment it was viewed, not a live-updating panel. Delete and Optimise are
the exception: each patches only the one block its button lived in. See
[2026-09-10](../diary_log/2026-09-10.md#date-bar).

## Depends on

- `tbl_week_plan_entries` (columns: `lib/plan-card.ts:PLAN_ENTRY_COLUMNS`) and its parent
  `tbl_week_plan` row per account per week (`plan_id`)
- `tbl_user_goals.macro_goals`, `tbl_user_memory.memory_json` — both populated by onboarding, read
  through `/api/goals`
- Two Supabase Edge Functions: `router-agent` (chat) and `optimize-day-agent` (Optimise) — their
  own logic isn't visible from this repo

## Writes

- `DELETE /api/plan/entries/[entry_id]` — deletes one row, scoped to `entry_id` **and**
  `account_key = user.id` (`app/api/plan/entries/[entry_id]/route.ts`)
- `POST /api/plan` and `POST /api/plan/optimise` write indirectly, inside the Edge Functions they
  proxy to — not visible from this repo
- `POST /api/recipe/submit`, `POST /api/recipe/collections`
- Supabase RPC `link_user_recipe` — called directly from the client, not via an API route
