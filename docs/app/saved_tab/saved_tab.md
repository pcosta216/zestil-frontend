# Saved tab — collected recipes, browsable by collection

Status: live · Last verified: 2026-09-29
Component: `app/zestil/SavedTab.tsx` (mounted by `app/zestil/AppShell.tsx`) · Cards:
`components/RecipeGrid.tsx`, `components/RecipeCard.tsx`, `components/RecipeCardEmpty.tsx`
Verify: no seed/browser script yet — manually check via `/zestil?tab=saved` against an account with
recipes in more than one collection

One of five tabs in `AppShell` (`NAV_ITEMS`, `AppShell.tsx:110-160`). Like Plan and Explore, it's
client tab state toggled with a `hidden` class (`AppShell.tsx:69-71`), not a route of its own —
there's no `app/zestil/saved/`. Tapping a card navigates to `/zestil/[uuid]`, a real route,
documented separately in [recipe_detail.md](./recipe_detail.md).

## Behaviour

**Data source.** `app/zestil/page.tsx:15-19` fetches `initialRecipes` via `getRecipes(user.id)`
(`lib/supabase/queries.ts:70-80`), reading `viw_user_collection_set` filtered by `account_key`,
ordered by `meal_title`. `AppShell` holds it in state (`recipes`, `AppShell.tsx:30`) and passes it
to `SavedTab` as a plain prop — a snapshot from render time, not a live subscription.

**Refresh.** `AppShell.refreshRecipes` (`AppShell.tsx:33-38`) re-fetches `GET /api/recipes` and
replaces state; it's wired into `PlanTab` and `ExploreTab` as `onRecipeSaved` (`AppShell.tsx:64,
67`). `SavedTab` itself has no fetch and never triggers a refresh — its list only ever changes
because another tab's save flow called it, or because the page reloaded.

**Collections list** (`SavedTab.tsx:19-25`): built client-side from
`recipes.map(r => r.collections_short_desc)`, deduped, sorted alphabetically, excluding any value
literally equal to `"main"` (case-insensitive). Shown in a slide-out panel (`panelOpen`) toggled by
the book icon.

**Filtering** (`SavedTab.tsx:27-40`): `selected` — one collection at a time, `toggleCollection`
clears it on a second click — narrows by exact `collections_short_desc` match; `query` (the search
box) substring-matches `meal_title`, case-insensitive. Both run client-side against the full
in-memory `recipes` list, no debounce, no server round-trip. The result is deduped by
`recipe_uuid` last (`SavedTab.tsx:34-39`) — a recipe that's in more than one collection, and so
appears once per collection in the underlying view, only shows once when no collection filter is
active.

**Rendering.** `displayed` (search + filter applied) is passed to `RecipeGrid`
(`SavedTab.tsx:107`), which renders one `RecipeCard` per result plus a trailing
`RecipeCardEmpty` tile, or its own empty state if `displayed` is empty (see Exceptions — that
empty state doesn't distinguish "no recipes at all" from "no matches"). `RecipeCard` links to
`/zestil/[uuid]` (`components/RecipeCard.tsx:34`).

**Scroll thumb** (`SavedTab.tsx:42-65`): a custom scrollbar indicator recomputed from
`scrollTop`/`scrollHeight`/`clientHeight` on every scroll/resize and whenever `displayed` changes;
hidden entirely when content already fits without scrolling.

## Exceptions & gotchas

**"No recipes yet" shows on a dead-end filter too, not just an empty account.**
`RecipeGrid`'s empty state (`components/RecipeGrid.tsx:10-20`) fires whenever the `recipes` prop
it's given is empty — and `SavedTab` passes it `displayed`, the already-filtered/searched list, not
the account's full set (`SavedTab.tsx:107`). Searching for something that doesn't match, or
picking a collection with nothing currently in it, shows the same "Your saved recipes will appear
here once you add them to a collection" copy as having saved nothing at all.

**The "+ Add recipe" tile does nothing.** `RecipeGrid` renders `<RecipeCardEmpty />` with no
`onClick` (`components/RecipeGrid.tsx:27`), even though the component accepts one
(`components/RecipeCardEmpty.tsx:5`) — same shape as Plan tab's dead `+ Dinner`/`+ Lunch`/`+ Snack`
chips ([plan_tab.md](../plan_tab.md#exceptions-gotchas)). Recipes only ever get saved from Plan's
or Explore's own save flows, never from Saved itself.

**The collections panel filters out `"main"`; the recipe detail page doesn't.** `SavedTab.tsx:23`
drops any collection literally named `"main"` from the filter list. `getRecipe`
(`lib/supabase/queries.ts:97-115`), used by [recipe_detail.md](./recipe_detail.md), builds
`collection_names` with no such filter — a recipe's detail page can show a "main" badge that
Saved's own panel would never let you select.

**Saved never refreshes on its own.** Deleting a recipe from the detail page, or another tab
saving one, doesn't reach `SavedTab` until `AppShell.refreshRecipes` runs, or the page reloads —
see [recipe_detail.md](./recipe_detail.md#behaviour) for why the delete flow happens to work
anyway (a route change, not a state update `SavedTab` reacts to).

## Depends on

- `viw_user_collection_set` — via `getRecipes` (`lib/supabase/queries.ts:70-80`);
  `collections_short_desc` on each row is what builds the filter panel, no separate query against
  `tbl_collections_set_header`

## Writes

None. See [recipe_detail.md](./recipe_detail.md#writes) for the delete that changes what this tab
shows, and [plan_tab.md](../plan_tab.md#behaviour) for the save flow that adds to it.
