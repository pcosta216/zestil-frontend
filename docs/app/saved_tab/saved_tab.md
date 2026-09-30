# Saved tab — collected recipes, browsable by collection

Status: live · Last verified: 2026-09-30
Component: `app/zestil/SavedTab.tsx` (mounted by `app/zestil/AppShell.tsx`) · Cards:
`components/RecipeGrid.tsx`, `components/RecipeCard.tsx`, `components/RecipeCardEmpty.tsx`
Verify: no seed/browser script yet — manually check via `/zestil?tab=saved` against an account with
recipes in more than one collection, plus a **separate** check of the Add-recipe flow. Any account
created since 2026-09-30 can demonstrate that flow (`doe@gmail.com` holds the 11 defaults); an
older one may hold no collections at all — see Exceptions

One of five tabs in `AppShell` (`NAV_ITEMS`, `AppShell.tsx:110-160`). Like Plan and Explore, it's
client tab state toggled with a `hidden` class (`AppShell.tsx:69-71`), not a route of its own —
there's no `app/zestil/saved/`. The screen's top row is a two-pill sub-tab switcher, `"mine"` and
`"recent"` (`SavedTab.tsx:38`), not a plain heading. Tapping a card navigates to `/zestil/[uuid]`, a
real route, documented separately in [recipe_detail.md](./recipe_detail.md).

## Behaviour

**Data source.** `app/zestil/page.tsx:15-19` fetches `initialRecipes` via `getRecipes(user.id)`
(`lib/supabase/queries.ts:70-80`), reading `viw_user_collection_set` filtered by `account_key`,
ordered by `meal_title`. `AppShell` holds it in state (`recipes`, `AppShell.tsx:30`) and passes it
to `SavedTab` as a plain prop — a snapshot from render time, not a live subscription. `AppShell`
also passes its already-fetched `collections` (`getCollections`, `lib/supabase/queries.ts:57-68`)
straight through as a prop (`AppShell.tsx:70`) — `SavedTab` doesn't query for these itself; it
needs the raw `{id, name}` list to build the Add-recipe checklist below.

**Refresh.** `AppShell.refreshRecipes` (`AppShell.tsx:33-38`) re-fetches `GET /api/recipes` and
replaces state; it's wired into `PlanTab`, `ExploreTab` **and now `SavedTab`** as `onRecipeSaved`
(`AppShell.tsx:64, 67, 70`) — added alongside the Add-recipe flow below, since without it a
successful add would save but the tab would keep showing the stale pre-add list until some other
tab's save happened to trigger a refresh, or the page reloaded.

**Sub-tabs** (`subTab`, `SavedTab.tsx:38`, rendered `SavedTab.tsx:167-206`): a two-pill segmented
control, `"My recipes"` / `"Recent"`, is the screen's top row. `"mine"` is the behaviour below
unchanged (search, collection filter, alphabetical order from the
`getRecipes` query itself — this tab does no client-side sort of its own). `"recent"`
(`recentRecipes`, `SavedTab.tsx:101-112`) shows at most 10 recipes ordered by `created_at` desc; the
underlying view has one row per collection membership, so recipes are first deduped by
`recipe_uuid`, keeping the row with the latest `created_at` per recipe. Switching tabs also force-
closes the collections panel (`SavedTab.tsx:180-183`) since it's a `"mine"`-only control. The
collections filter icon and the search bar (`SavedTab.tsx:193-205, 298-323`) only render on
`"mine"` — `"recent"` has neither, by design (no search/filter on a fixed 10-item list).

**Collections list** (`SavedTab.tsx:91-97`): built client-side from
`recipes.map(r => r.collections_short_desc)`, deduped, sorted alphabetically, excluding any value
literally equal to `"main"` (case-insensitive). Shown in a slide-out panel (`panelOpen`) toggled by
the book icon, `"mine"`-only.

**Filtering** (`SavedTab.tsx:114-129`, `"mine"` only): `selected` — one collection at a time,
`toggleCollection` clears it on a second click — narrows by exact `collections_short_desc` match;
`query` (the search box) substring-matches `meal_title`, case-insensitive. Both run client-side
against the full in-memory `recipes` list, no debounce, no server round-trip. The result is deduped
by `recipe_uuid` last — a recipe that's in more than one collection, and so appears once per
collection in the underlying view, only shows once when no collection filter is active.

**Rendering.** `displayed` (`"recent"`'s fixed list, or `"mine"`'s search + filter applied) is
passed to `RecipeGrid` (`SavedTab.tsx:222`), which renders one `RecipeCard` per result plus a
trailing `RecipeCardEmpty` tile, or its own empty state if `displayed` is empty (see Exceptions —
that empty state doesn't distinguish "no recipes at all" from "no matches"). `RecipeCard` links to
`/zestil/[uuid]` (`components/RecipeCard.tsx:34`).

**Scroll thumb** (`SavedTab.tsx:131-154`): a custom scrollbar indicator recomputed from
`scrollTop`/`scrollHeight`/`clientHeight` on every scroll/resize and whenever `displayed` changes;
hidden entirely when content already fits without scrolling.

**Floating add button** (`SavedTab.tsx:238-246`): a green circular button, bottom-right, on both
sub-tabs — `bottom-20` on `"mine"` to clear the search bar, `bottom-4` on `"recent"` since that tab
has none. Opens the Add-recipe overlay; `z-10`, one layer below the collections panel (`z-20`) so
the panel visually covers it while open.

**Add-recipe overlay** (`addOpen`, `SavedTab.tsx:251-287`): a full-height card (24px inset on all
four sides, matching the button's own right/bottom gutter) with a `textarea` and Cancel/Add. Stays
open — Add disabled, labelled "Adding…" — until the submit resolves, rather than closing
optimistically; mirrors how Explore's own save button doesn't dismiss its card until its fetch
completes.

**Submit** (`handleAddRecipe`, `SavedTab.tsx:53-89`): `parseRecipeInput` (`SavedTab.tsx:17-30`)
decides URL vs. text — a single whitespace-free line that parses as a URL, or matches a bare-domain
pattern (`example.com/recipe`, scheme prepended as `https://`), is sent as `{url}`; anything else
(multi-line, or any internal whitespace) is sent as `{text}` verbatim. Either shape goes to
`POST /api/recipe/submit` (`app/api/recipe/submit/route.ts`, a thin proxy to the
[recipe-parser](../../recipe-parser/SPEC.md) backend's `/api/v1/recipe/submit`, same endpoint
Plan/Explore's own save-without-a-known-`recipe_uuid` path uses). On success, the response's
`recipe_uuid` is assigned to every collection the user checked, via a second call,
`POST /api/recipe/collections`. Notification uses the identical `showBanner`/banner-state pair
Explore uses (`SavedTab.tsx:42-51, 289-295`, vs. `ExploreTab.tsx:183-196, 454-459`): an `"info"`
banner immediately ("We're cooking the data…"), replaced by `"success"` or `"error"` once the
request(s) settle. The overlay only closes on success; on error the entered text is preserved so
the user can retry.

## Exceptions & gotchas

**Adding a recipe needs a collection to file it in, and the frontend never creates one.**
`handleAddRecipe` returns on `checkedCollections.size === 0` (`SavedTab.tsx:72`), and Add is
disabled on the same condition (`:309`) — `/api/recipe/submit` alone never inserts a
`tbl_collections_line` row, so anything saved without the follow-up
`POST /api/recipe/collections` (`:88-89`) never appears anywhere `viw_user_collection_set` is
read from, this tab and [recipe_detail.md](./recipe_detail.md) included. And **nothing in this
repo creates a `tbl_collections_set_header` row** — only the read in
`getCollections`. They come from the database: `trg_user_profiles_insert_collections` copies
`tbl_collections_header_user_default` (11 rows: Main, Breakfast, Chicken, …) into it when the
account's profile row is created ([auth-setup.md](../../auth-setup.md),
`supabase/migrations/20260930_default_collections_on_profile_insert.sql`). Accounts predating
2026-09-30 were not backfilled and can still hold zero (`me@gmail.com` does): the panel shows
"No collections yet" (`:327-328`), nothing is checkable, Add stays disabled — a visible dead end
rather than a silent one. `addCollections` drops `"main"` case-insensitively, so an account
holding *only* `Main` lands there too.

**"No recipes yet" shows on a dead-end filter too, not just an empty account.**
`RecipeGrid`'s empty state (`components/RecipeGrid.tsx:10-20`) fires whenever the `recipes` prop
it's given is empty — and `SavedTab` passes it `displayed`, the already-filtered/searched list, not
the account's full set (`SavedTab.tsx:222`). Searching for something that doesn't match, or
picking a collection with nothing currently in it, shows the same "Your saved recipes will appear
here once you add them to a collection" copy as having saved nothing at all.

**The `RecipeCardEmpty` grid tile still does nothing.** `RecipeGrid` renders `<RecipeCardEmpty />`
with no `onClick` (`components/RecipeGrid.tsx:27`), even though the component accepts one
(`components/RecipeCardEmpty.tsx:5`) — same shape as Plan tab's dead `+ Dinner`/`+ Lunch`/`+ Snack`
chips ([plan_tab.md](../plan_tab.md#exceptions-gotchas)). The floating add button above is the only
working entry point into the Add-recipe flow; this tile is unrelated to it and remains a dead end.

**The collections panel filters out `"main"`; the recipe detail page doesn't.** `SavedTab.tsx:95`
drops any collection literally named `"main"` from the filter list. `getRecipe`
(`lib/supabase/queries.ts:97-115`), used by [recipe_detail.md](./recipe_detail.md), builds
`collection_names` with no such filter — a recipe's detail page can show a "main" badge that
Saved's own panel would never let you select.

## Depends on

- `viw_user_collection_set` — via `getRecipes` (`lib/supabase/queries.ts:70-80`);
  `collections_short_desc` on each row is what builds the filter panel
- `tbl_collections_set_header` — via `getCollections` (`lib/supabase/queries.ts:57-68`), passed
  through `AppShell` as the `collections` prop, used only to find `"main"`'s id (see Exceptions)
- The [recipe-parser](../../recipe-parser/SPEC.md) backend, via `/api/recipe/submit`

## Writes

- `POST /api/recipe/submit` (`app/api/recipe/submit/route.ts`) — parses and saves a new recipe;
  see [recipe-parser SPEC.md §3](../../recipe-parser/SPEC.md#3-entry-points)
- `POST /api/recipe/collections` (`app/api/recipe/collections/route.ts`) — assigns the new recipe
  to `"main"`, when one exists (see Exceptions)
- See [recipe_detail.md](./recipe_detail.md#writes) for the delete that changes what this tab
  shows, and [plan_tab.md](../plan_tab.md#behaviour) for Plan/Explore's own save flow
