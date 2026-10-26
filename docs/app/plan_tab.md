# Plan tab — chat-first meal planner

Status: live · Last verified: 2026-09-25
Component: `app/zestil/PlanTab.tsx` (mounted by `app/zestil/AppShell.tsx`) · Cards:
`components/WeekdayGrid.tsx`, `components/WeekdayRecipeCard.tsx` (plan entries), `components/IngredientCard.tsx`
(ingredient suggestions) · Mapper: `lib/plan-card.ts`
Verify: `scripts/plan-seed/verify-plan-tab.mjs` — seeds real `tbl_week_plan_entries` rows (plain
recipe, optimised recipe, ingredient, and a delete target) for `doe@gmail.com` after walking her
through onboarding for real goals data, then drives the tab in a browser

One of five tabs in `AppShell` (`NAV_ITEMS`, `AppShell.tsx:110-160`) — first in the nav bar and the
default: `activeTab = searchParams.get("tab") ?? "plan"` (`AppShell.tsx`), so `/zestil` with no `tab`
(after login, onboarding, a password reset) opens on Plan, and the other tabs need `?tab=`. The Explore tab is currently switched off by `EXPLORE_ENABLED = false` in `AppShell.tsx` (no nav item, not mounted, `?tab=explore` opens Plan); set it to `true` to restore it. All five tab bodies mount at once and are
toggled with a `hidden` class instead of being conditionally rendered (`AppShell.tsx:63-78`), so
PlanTab's mount-time fetches and its whole chat/session state fire on page load and persist across
tab switches regardless of which tab is in front. There's no `app/zestil/plan/` route — Plan is
client tab state, not a page of its own. `groceries`, also in `NAV_ITEMS`, is a static "Coming
soon" placeholder, not a real tab.

The opening "Today" block is fetched by the mount effect. In dev, Strict Mode and Fast Refresh run that effect
twice, so the effect cancels its own fetch on cleanup (`isCurrent` in `appendDayView`); without that, today
was drawn twice on load. The effect also does nothing when the chat already has messages: it is the only code that starts the chat over, and an effect re-run on a mounted PlanTab (Fast Refresh, a hidden-then-shown boundary) must not wipe the history. The "Hi! I'm your meal planner…" greeting is added after that block (or on its own if the fetch fails), so the transcript opens on today's plan and the greeting sits under it; until the fetch ends the chat is empty.

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
trigger a fresh day-view append (`datesInResponse.includes(selectedDate)`). That append only
happens for a reply that **changed the plan** (`response_type: "day_update"` or non-empty
`changed_dates`); a reply that merely shows a day already carries its cards, so re-fetching it
would draw them twice. For the same reason a `day_update` whose own `meal_cards` include the followed
day gets no extra append for it: its cards are that day's list. The append still happens when the
reply names the day in `changed_dates` without carrying its cards.

`response_type` selects the bubble:

| `response_type` | Renders |
|---|---|
| `week_plan` / `day_update` | `PlanBubble` — parses day headers and `Breakfast:`-style slot lines out of plain text (`PlanTab.tsx:112-137`) |
| `recipe_list` | plain markdown |
| `macro_summary` | regex-parses `"N kcal … / goal"` out of the text into a ring; text-only if the phrasing doesn't match (`PlanTab.tsx:158-161`) |
| `suggestion_pending` | Confirm / Reject buttons that resend the canned phrases `"Yes, confirm the change"` / `"No, keep the original"` |
| `ingredients_list` | `IngredientCard` rows with an Add action |
| `recipe` | markdown + a hero image if `metadata.media.image_url` is set |
| `feedback` | generic markdown bubble, content is the `ui_body` (below). `meal_cards` / `changed_dates` are **ignored** on this type, so the reply neither renders a plan grid nor triggers the day-view re-fetch — the chat just continues |
| `info` (also a missing `response_type`) | generic markdown bubble. `meal_cards` / `changed_dates` are **ignored**, same as `feedback`: any cards would otherwise hide the bubble (below) and the sentence with it |
| anything else | generic markdown bubble |

For every type except `feedback` and `info`, a reply that has `meal_cards` shows the grid **instead
of** its bubble — the `!(msg.mealCards?.length)` guard in the render (since 2026-05-08, `ce84e7d`),
so the text is never shown. That is by design for `week_plan` / `day_update`, whose text is the plan
spelled out; it would also hide a `suggestion_pending` reply's Confirm / Keep buttons.

**`ui_body`** (any response type; contract in `docs/UI_BODY_CONTRACT.md`): parsed by
`lib/ui-body.ts:parseUiBody` (unknown block types dropped, unknown `text` styles kept as body) and
rendered by `components/UiBodyBlocks.tsx` inside `UiBodyBubble`, one agent bubble that replaces
`AgentBubble` for that message (a message with cards gets a bubble of just the blocks below the
cards).

Blocks:
- `text` (body / header / sub_header) and `button`.
- `choice`: a radio list in a component of its own (`ChoiceBlock`), so each form keeps its pick in its
  own state and reads `selected` when it mounts. It must not live in the parent, or an Edit form that
  reappears in the same row (same id, via a local `replace`) would inherit the last form's pick.
  `selected` is compared as a string against `option.value` (a number is stringified); no match means
  nothing is selected. Save is disabled while the pick equals `selected`, so it enables only for a
  different option and disables again if the original is picked back; with no `selected`, any pick
  enables it. `cancel` is a second button on Save's line (always enabled unless a call is in flight):
  a `revert`, a `call` or a `replace`, never `{value}`-substituted, with the same scope as Save, so in a list
  row both replace only that row. Save sends the picked value as an exact string (`"1.5"`). The
  component is keyed by id and `selected`, so a form swapped in place with another baseline remounts.
- `section`: a header (caption over detail, chevron when `collapsed`) that contains its blocks, one
  level deep. A section with no blocks left is **not drawn** (the contract leaves that to us). A hairline
  under each header separates it from what follows, so a closed section that ends the list has none;
  an emptied section after it and a trailing `notice` (a footer, not more list) don't count. An open
  one keeps its line, which sits under the header.
- `button_group`, optionally collapsed to one tappable row. Its buttons share one row as equal-width
  cells, icon over label, because four labelled pills don't fit a phone-width bubble. A button with
  `state` is a **switch** (track and knob, `role="switch"`) instead of a cell with an icon.
- `nutrition`, hidden until a `toggle` shows it; drawn with `components/MacroRings.tsx`, the recipe
  card's macro rings (values rounded, a missing key gets no ring, always one row: full 40px from
  about 430px wide, shrinking in a narrower bubble). A `nutrition` block that a group in the same list
  toggles is drawn **inside that group's card**, under a divider below the buttons, and only while
  the group is open; one nothing toggles keeps a card of its own.
- `notice`: a note or warning behind its icon. Collapsed (the default) it is **only the icon** — bare
  and tone-coloured, not a chip; the padding around the glyph is the tap target, and a negative
  margin keeps the glyph in line with the text above. It is named for screen readers by its `title`
  (or `caption`); tapping opens a panel with the bold `title` and the `caption`, with the same bare
  icon in its header. The **tone** (`info` / `warning` / `forbidden` / `critical`; unknown is `info`) sets
  the colour of the icon and panel, not the icon's name: warning is amber, critical red, and info and
  forbidden are neutral because §3.1.7 leaves them "open". An unknown or missing icon falls back to
  the tone's (`info`, `alert`, `block`, `alert`), so a notice never shows nothing, and a notice with
  any text is never dropped. Open/closed is local state keyed by what the notice says (it has no
  `id`), so it survives the list changing around it. `format: "markdown"` goes through
  `lib/mini-markdown.ts` + `components/MiniMarkdown.tsx`, which understand only `**bold**`,
  `*italic*`, `- ` bullets, line breaks and blank-line paragraphs; everything else, including links,
  headings, code and HTML, stays as the literal characters, and all text is escaped by React.

Icons are a closed name → lucide map (`ICONS`); an unknown name draws none. The icon also sets the
button's colour (`TONES`), as on the recipe card's actions, whatever the button's `style`: `trash`
red, `edit` grey, `info` blue, `alert` yellow (the colour column of §3.2); the rest (`toggle`, `undo`,
`check`, `cross`, `plus`, `swap`, `block`) are "open" there and keep the green style.

Actions:
- `call`: from the browser straight to `<NEXT_PUBLIC_SUPABASE_URL>/functions/v1/<endpoint>` with the
  user's JWT (allowlist in `UI_ACTION_ENDPOINTS`: `sides-catalog`, `snacks-catalog`, `breakfasts-catalog`).
- `toggle`: local state, shows or hides a `nutrition` block.
- `replace`: local, swaps its scope for the given blocks; `[]` removes the scope (the snack list's
  Continue). No pending state. What it swaps out is **kept** for `revert`: on the slot it creates (or
  on the body, for a body-level scope), written by the same state update as the swap, one level, only
  the latest swap. For a group that is the group and its macros panel; for a slot, its blocks.
- A list row that comes back from a call (the reply to Save, to the Auto switch or to an Undo) is
  `collapsed: false` in the contract, which would leave an open row with no way to fold it.
  `keepRowsCollapsible` in `UiBodyBlocks.tsx` makes such a row collapsible again, and keeps it open, when it
  arrives inside a slot. A "row" is a `button_group` with a trash / info / edit button, an Info toggle or a
  switch (so a snack or side with no macros, whose Info is a placeholder, still counts). Remove's
  sentence-plus-Undo group and a Removed row with only Restore are not rows and stay as sent.
  Edit's form keeps the row's fold control too: a slot whose `previous` holds a row is drawn as a card with
  the row's name, detail and chevron over the form (kept mounted while folded, so the pick survives), and
  Cancel (`revert`) puts the row back collapsible, through the same helper.
- `revert`: local, puts back what the last `replace` kept and forgets it (the snack Edit form's
  Cancel — no connection, so it also works offline). Disabled when the scope kept nothing (the form
  arrived another way, e.g. as a call's reply). A call's reply replaces the scope *without* the kept
  copy, so a stale row can never come back. It is never usable as a choice's submit. What is kept
  also folds in what the user could see (`bake`): a row they had expanded and a panel they had
  opened come back as they were, since that open state belongs to where a block sat.
- A button with no action, an unknown action kind, a non-allowlisted endpoint, a `toggle` whose
  target is missing, a `replace` without a block list, or a `revert` with nothing to revert renders
  disabled.

A call's **scope** is the whole body, or just the `button_group` its button sits in (also inside a
section): only that scope is disabled while the call is in flight (pending is tracked per scope), and
the reply (`ui_body`, or its `message` as a `text` block) replaces only that scope. A replaced group
becomes a frontend-only `slot` block; a call from inside it replaces the slot again (Remove → Undo →
the row again, in the same place). A slot made of groups has no card of its own, since they already
are cards. An open group's caption wraps (it can be a sentence); a collapsed row's is one line.
Local state (selected option, expanded section or group, shown panel, switch, pending, error) is
keyed by scope + id, never the bare id, because reply ids like `undo` repeat. Replies are applied
through an updater (`onChange(prev => …)`), so two groups resolving together don't overwrite each
other, and without scrolling the chat.

A switch flips at once, then calls with `"{value}"` replaced by its new state as a JSON boolean. Only
a reply with a `ui_body` and without `ok: false` counts; anything else (or a network error) flips it
back and shows the server's `message`, or a generic one, under the group.

The model's own sentence is hidden only when a *body* `text` block says it already — a list's header
lines don't count, so its category counts stay visible.

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

Each row is a `WeekdayRecipeCard`: a 40px bar (name, kcal pill, and the optimised / suggestion
pills). Tapping it **slides icon buttons in at the right end of the bar**. Cards open and close
independently, so several can be open at once. The buttons are icon-only, in the colours of the icon table,
each with an `aria-label` and `title`: **Info** (blue; shows or hides the six macro rings, `MacroRings`, one
row, beneath the bar, then the entry's `notes` when it has any, as a small muted line with no label; closing the card hides them again), **View recipe** (green, only when the entry has a
`recipe_uuid`), for a side or a snack a grey button that stops suggesting the item, for a recipe entry a grey **Stop auto planning** / **Use in auto planning** button (see below), and **Delete** (red,
`onDelete`), always the right-most so it keeps its place. While open, the "optimised" and "suggestion"
pills are hidden to make room, so the original / optimised switch is used while closed and the rings
follow it.

The small line under the name (`slotRoleLabel` in `PlanTab.tsx`) reads `Dinner`, `Dinner ⋅ Side` for a non-main
role, then the amount: `⋅ 50g` for a side, snack, breakfast food or ingredient (`quantity_g`), `⋅ 0.5 servings` for a recipe
(`serving_multiplier`). A recipe-shaped side or snack (`side_kind` / `snack_kind` `recipe`) has no gram amount
on the card, so it gets servings like a recipe: `Dinner ⋅ Side ⋅ 2 servings`.

**Stop auto planning** (a `recipe` entry with a recipe) is the recipe page's "Auto-plan" switch
(`components/PlanningSwitch.tsx`) on the card: the same `setRecipePlanning` (`set_recipe_planning`, with the
signed-in user's id), the same words (`planningMessage`), and the same `rememberAutoPlan` +
`announcePlanningChanged` afterwards so the Saved tab's triangles follow. The card reads the recipe's
`auto_plan` / `auto_reason` from `viw_user_collection_set` the first time it is opened
(`loadRecipePlanState`), because a plan entry does not carry them; until that lands the button reads "Stop".
Once the recipe is out, the same button reads "Use in auto planning" and flips it back (naming the diet when
only the diet had kept it out). The result shows in `PlanTab`'s bottom banner (`onFeedback` = `showBanner`),
and an entry that is not planned by hand is unaffected: it only changes what the optimizer may pick.

The stop-suggesting button (`lib/stop-suggesting.ts`) is a direct catalog call, like the snack list's:
a **snack** gets "Stop suggesting" (`snacks-catalog` `set_auto` with `auto: false`: the optimizer stops
picking it, the user can still add it by hand); a **breakfast** food item gets the same "Stop suggesting"
(`breakfasts-catalog` `set_auto` with `breakfast_uuid` and `auto: false`); a **side** gets "Remove from my sides" (`sides-catalog`
`remove`). All take the item from `catalog_uuid`, which `rowToMealCard` fills from
`tbl_week_plan_entries.source_uuid` for side, snack and breakfast entries (null for recipes and ingredients, which
get no such button). A card in a chat reply is built by the agent and has no `catalog_uuid`, so the uuid is read from its `metadata` snapshot (`snack_uuid` / `side_uuid` / `breakfast_uuid`) instead; without that the button does not show. The call goes through `lib/edge-call.ts`, and the endpoint's own reply, a sentence
and an Undo, is drawn inside the card with `UiBodyBlocks`, so Undo works with no extra code. It does not
touch the planned entry: that stays on the day. The reply's Undo is drawn orange here (`buttonTone`, not the contract's default green), with a green OK on the same row at the right that just clears the reply from the card (`dismiss`, no call). A failed call shows an inline error. The recipe is read
when View recipe is tapped (once per card), not when the card appears.

**View recipe** (`WeekdayRecipeCard.openRecipe`, `docs/UI_BODY_CONTRACT.md` §5.11) shows on any entry
whose snapshot names a recipe (`recipe_uuid`): a `recipe` entry, and since the 2026-10-22 backend change a
snack or side that is a recipe (their `source_uuid` stays the list item). Nothing is read until it's tapped.
Then:
- `/api/recipe/{uuid}` asks the user's recipes (`viw_user_collection_set`). A hit is the live recipe with its
  collections, and that's all.
- Otherwise the recipe is read by its id with `get_recipe_json_by_uuid` (`loadRecipeById` in
  `lib/recipe-snapshot.ts`, with the user's login), whether or not the user has it: the planner's own
  snapshot function, so the result has the snapshot's shape. A snack or side carries only the id, so that
  read starts at once and the overlay says "Loading…". A `recipe` entry's snapshot is the whole recipe
  (`recipeFromSnapshot`: title, lines, steps, totals, and whatever of servings, times, author, date, link
  and image `metadata` has) and shows at once; its read by id is made only after the user's recipes said no,
  to tell whether the recipe still exists.
- Not the user's: the overlay (`RecipeDetailHero`, `saved={false}`) shows a **Save recipe** button at the
  bottom (the recipe page's Delete never shows in the overlay) and no collections row. Save is the Plan chat
  heart's link, `link_user_recipe`, then the diet alert (`announceItemSaved`) and `onRecipeSaved` (Saved tab
  refresh); after it the collections row appears so it can be filed. While the lookups run
  (`saved={null}`) there is no Save and no collections row.
- No longer exists (the read by id finds nothing): the entry's name and macros, and "This recipe is no
  longer available."
- A read that fails: a `recipe` entry keeps its snapshot (still with Save when the user's recipes said no);
  a snack or side says "Couldn't load the recipe.", and the next tap tries again.

The page's "Auto-plan" switch shows for an unsaved recipe too, taken as on, and so does the
card's Stop auto planning button: the user can stop a recipe Zestil planned before ever saving it. An
unsaved recipe has no `auto_plan` to read back, so after a reload the switch starts as on again.

**Breakfast.** The planner composes a breakfast from the My breakfasts list, so one slot can hold several
entries, all with role `main` (nothing assumes one main per meal; every entry gets its own card). A food
item is an entry of type `breakfast` (`source_uuid` = `breakfast_uuid`, `quantity_g`, snapshot with
`breakfast_kind` / `display_name`); `rowToMealCard` builds its card like a snack food's, and its subtitle
reads `Breakfast ⋅ 50g`. A recipe item is a plain `recipe` entry. A breakfast food card gets the
stop-suggesting button (above); a recipe item, being a recipe entry, does not. The My breakfasts list itself, like My snacks, is the agent's `ui_body`
(`breakfasts-catalog`); the app has no screen of its own for it.

**Add recipe** (`components/AddRecipeButton.tsx`, the Saved tab's own "+" and dialog): a 35px green button
floating at the bottom right of the chat (`absolute right-4 bottom-3` in a wrapper around the scroll area),
just above the quick-reply chips without covering them. The chat has `pb-16` so its last message can scroll
clear of it. It opens the same paste-a-link-or-text dialog, with the collections picker, and calls
`onRecipeSaved` like the Saved tab does.

`IngredientCard` (an `ingredients_list` suggestion, not a planned item) keeps the original behaviour: a
bar that slides in Add / More / Info. Only Add does anything; Info has no handler, and More's two items
have nothing to open for a bare ingredient name, so they now just close the menu.

`lib/plan-card.ts:rowToMealCard` is the one place `is_optimised` / `original_macros` / `quantity_g` /
`catalog_uuid` are computed from a raw `tbl_week_plan_entries` row; it's shared by the `today` and
`week` routes specifically so they can't drift apart on that mapping (its own header comment says so).
`original_macros` (the "original" toggle) is the entry's `original_snapshot` at its amount before the first
change: `originalQtyG` (`adjusted_snapshot.original_qty_g`) for a food sized in grams, and `originalMultiplier`
(`adjusted_snapshot.original_multiplier`, since 2026-10-21, `docs/FRONTEND_ORIGINAL_SERVINGS.md`) for a recipe
or a recipe-kind side, snack or breakfast item. A row changed before that has no stamp and falls back to
`serving_multiplier`, so its original equals its current. The app never changes an entry's servings itself
(serving changes go through the agents), so it never writes the stamp.

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

**The macro rings are cosmetic, not proportional.** `MacroRings` draws every ring at a fixed 75% arc
regardless of value; only the number in the middle is real. `WeekdayGrid`'s own per-day rings genuinely
scale to `goals` — the per-card rings don't scale to anything. A three-digit sodium value (`900mg`) is
wider than the ring's inside.

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
- Two more, called straight from the browser with the user's JWT (`lib/edge-call.ts`, allowlist in
  `lib/ui-body.ts`): `sides-catalog`, `snacks-catalog` and `breakfasts-catalog`, by `ui_body` buttons and by a plan card's
  stop-suggesting button
- Supabase RPC `get_recipe_json_by_uuid` (read, from the browser with the user's login): View recipe on a
  recipe the user does not have, by the snapshot's `recipe_uuid` (§5.11)

## Writes

- `DELETE /api/plan/entries/[entry_id]` — deletes one row, scoped to `entry_id` **and**
  `account_key = user.id` (`app/api/plan/entries/[entry_id]/route.ts`)
- `POST /api/plan` and `POST /api/plan/optimise` write indirectly, inside the Edge Functions they
  proxy to — not visible from this repo
- `POST /api/recipe/submit`, `POST /api/recipe/collections`
- Supabase RPC `link_user_recipe` — called directly from the client, not via an API route
- Supabase RPC `set_recipe_planning` (a recipe card's Stop / Use in auto planning button, as on the recipe page) — called directly from the client; it changes whether the recipe is picked by automatic planning, not the planned entry. The card also reads `viw_user_collection_set` (`auto_plan`, `auto_reason`) for that one recipe
- `snacks-catalog` `set_auto` / `breakfasts-catalog` `set_auto` / `sides-catalog` `remove` (and their Undos) — a plan card's stop-suggesting
  button, also called directly from the client; they change the user's catalog, not the planned entry
