# Diet change — search progress screen and diet-fit alert

Status: built, not yet exercised against a live backend · Last verified: 2026-10-15
Component: `components/DietHost.tsx` (mounted once in `app/zestil/AppShell.tsx`) · Calls and events:
`lib/diet.ts` · Request list shared with onboarding: `components/DiscoveryItems.tsx`
Verify: none yet — typechecked only. Needs a user with a strict diet and the diet migrations applied
(`2026101501`–`2026101505`). Backend contract: `docs/FRONTEND_DIET_CHANGE.md`.

Two screens, one host. The chats and save paths only announce what happened (window events from
`lib/diet.ts`); `DietHost` owns everything on screen, so a progress sheet survives a tab switch.

## Search progress screen

- Opens on `announceDietSearch(data.recipe_search)`, fired by the Explore chat (`/api/chat`) and the
  Plan chat (`/api/plan`) when a reply carries `recipe_search` (`{ diet, run, target }`).
- Polls `tbl_user_memory.memory_json->diet_search` every 6s until `status` is `complete` or
  `failed`. Reads only; never touches `memory_json.onboarding` or `tbl_recipe_setup`.
- A record is shown only when `record.run >= recipe_search.run`. Until the agent writes the new
  run, memory still holds the previous search, whose `complete` would end this one before it began.
  A newer search replaces the screen.
- Renders `items` with `DiscoveryItems`, the same renderer as onboarding's last screen
  (`status` values `waiting | in_process | complete | failed`; `requestState` accepts both
  `in progress` and `in_process`).
- The screen can always be closed; it is not a gate. On `complete` it calls `refreshRecipes` once.

## Diet-fit alert

- Fired by `announceItemSaved("recipe", uuid)` after a save in Explore chat, Plan chat, and the
  Saved tab's add-recipe form.
- `item_fits_diet` is called with `p_account_key = user.id`. While `why` is `"not classified yet"`
  it is retried every 5s, up to 24 tries (2 min), then dropped silently.
- Shown when `ask && !kept_in`, as a banner (`FitBanner`): the tabs' save banner's place, motion
  and look (`fixed bottom-4`, slides up, `rounded-2xl`, white 13px text), in the info blue. "This
  recipe doesn't fit your keto diet. Should it be used in automatic planning?", then the `why` line
  unless it only repeats that ("not keto"). "Yes, use it" and "No, keep it out" call
  `set_diet_planning` (`p_in_planning` true / false). The × dismisses without writing; the item
  stays planned.
- Unlike the save banner it doesn't time out: it stays until answered or dismissed.
- It waits 5.3s after each save (the save banner's 5s plus its slide-out), so the two never share
  the spot. It sits under the tabs' banners (z-40 vs z-50 / z-[60]): a later save's feedback
  covers it for its 5s.
- Alerts queue; one shows at a time.

## Not built

- **Sides and snacks added from the app's own screens.** The app has none: they are only added in
  chat, where the "Added" card carries the alert as a `button_group` (`diet_alert`, agents repo
  `docs/UI_BODY_CONTRACT.md` §5.9; this repo's copy stops at §5.6). When such a screen exists,
  `announceItemSaved("side" | "snack", uuid)` brings up the same banner.

## Why a recipe is off

The recipe page carries the planning switch (D37; [recipe_detail.md](./saved_tab/recipe_detail.md)).
A recipe kept out only by the strict diet shows "Not keto" on it, from the recipe's `auto_reason`
(`viw_user_collection_set`); its Saved tab card's triangle is grey (`auto_plan` false,
[saved_tab.md](./saved_tab/saved_tab.md)). The banner's answer for a recipe (`set_diet_planning`)
fires `announcePlanningChanged`, so `AppShell` reads the recipes' `auto_plan` again.
