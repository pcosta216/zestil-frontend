# Recipe detail — full recipe view and delete

Status: live · Last verified: 2026-09-29
Component: `app/zestil/[id]/page.tsx`, `app/zestil/[id]/BackButton.tsx` · Shared hero:
`components/RecipeDetailHero.tsx` (also reused, `asOverlay`, by Plan tab's "View Recipe" overlay —
`components/WeekdayRecipeCard.tsx:152`)
Verify: no seed/browser script yet — manually check by opening a card from
[saved_tab.md](./saved_tab.md) and using Delete Recipe

Reached from a `RecipeCard` link (`components/RecipeCard.tsx:34`, `/zestil/[uuid]`) in Saved, or
wherever else a `recipe_uuid` is known. It's a standalone route, not client tab state like
Plan/Explore/Saved/Profile.

## Behaviour

**Fetch** (`app/zestil/[id]/page.tsx:9-19`): server component reads `params.id`, calls
`getRecipe(recipeUuid, user.id)` (`lib/supabase/queries.ts:97-115`), and `notFound()`s if it
returns null — a `recipe_uuid` that exists but belongs to a different account 404s exactly like one
that doesn't exist, since the query filters on both `recipe_uuid` and `account_key`.

**No auth redirect.** Unlike `app/zestil/page.tsx`, which redirects to `/login` when there's no
session, this page never checks `user` before using it — `user!.id`
(`app/zestil/[id]/page.tsx:43`) is a non-null assertion. An unauthenticated visit throws inside the
`Suspense` boundary instead of redirecting.

**Rendering** (`components/RecipeDetailHero.tsx`): title, hero image (falls back to a plate emoji
if `image_url` fails `isValidUrl` — no runtime `onError` fallback the way `RecipeCard` has),
author/date, prep/total time and servings badges, an optional "View original recipe" link,
ingredients, instructions grouped by `instruction.title` (e.g. "Prep"/"Cook"), collection badges
(`collection_names`, unfiltered — see Exceptions), and a per-serving macro row
(kcal/protein/carbs/fat/sugar/sodium), each value divided by `servings_value || 1`.

**Back** (`BackButton.tsx`): `router.back()`, not a link to `/zestil?tab=saved` — arriving here
from somewhere other than Saved (e.g. an Explore chat result) goes back the way you came, not
necessarily to Saved.

**Delete** (`handleDelete`, `RecipeDetailHero.tsx:44-48`): only rendered when `!asOverlay`, so
never on the Plan-tab overlay reuse. Confirm dialog → `DELETE /api/recipe/[uuid]`
(`app/api/recipe/[uuid]/route.ts:19-36`) → unconditional `router.push("/zestil?tab=saved")`. That
navigation is what makes Saved look current afterward: it's a route change from `/zestil/[id]`
back to `/zestil`, which remounts `app/zestil/page.tsx` and re-runs `getRecipes` from scratch —
`SavedTab` itself never learns about the delete directly (see
[saved_tab.md](./saved_tab.md#exceptions-gotchas)).

## Exceptions & gotchas

**Delete removes the recipe from every collection at once, not just one.** The route deletes every
`tbl_collections_line` row matching `recipe_uuid` **and** `account_key`
(`app/api/recipe/[uuid]/route.ts:28-32`) — there's no per-collection remove. A recipe saved into
three collections disappears from all three on one delete, even though the confirm dialog just
says it will "remove the recipe from your collections" — reads as informational, not as a warning
that it's all-or-nothing.

**Delete failures are silent.** `handleDelete` never checks the fetch's `res.ok` or catches a
rejection (`RecipeDetailHero.tsx:44-48`) — it always navigates back to Saved regardless. A failed
delete looks identical to a successful one; the recipe is simply still there.

**Collection badges aren't filtered.** `getRecipe`'s `collection_names`
(`lib/supabase/queries.ts:110-112`) includes a literal `"main"` collection if the recipe is in one.
Saved's own filter panel deliberately excludes `"main"` (`SavedTab.tsx:23`), so this page can show
a badge the rest of the tab treats as not user-facing.

**No image load fallback.** `RecipeCard` clears a broken image via `onError`
(`components/RecipeCard.tsx:46-48`); `RecipeDetailHero` computes `imageUrl` once from
`isValidUrl` and has no `onError` handler, so a URL that's well-formed but errors at request time
leaves a broken image instead of the plate-emoji placeholder.

**The nutrition rings are cosmetic, not proportional** — same pattern as Plan tab's macro overlay
([plan_tab.md](../plan_tab.md#exceptions-gotchas)): `strokeDasharray={`${circ * 0.75} ${circ}`}`
(`RecipeDetailHero.tsx:249`) always draws at 75% regardless of the macro's actual value; only the
center number is real.

## Depends on

- `viw_user_collection_set` — via `getRecipe` (`lib/supabase/queries.ts:97-115`)
- `tbl_collections_line` — read indirectly through the view; written by the delete below and by
  the save flows in [plan_tab.md](../plan_tab.md#behaviour)

## Writes

- `DELETE /api/recipe/[uuid]` — deletes every `tbl_collections_line` row for `recipe_uuid` +
  `account_key` (`app/api/recipe/[uuid]/route.ts:19-36`); see Exceptions above
