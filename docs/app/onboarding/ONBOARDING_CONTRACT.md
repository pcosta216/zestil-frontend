# Finishing onboarding: the app ↔ recipe discovery contract

For the frontend. How a user who has finished onboarding gets their recipe discovery (`user-profile-agent`), and how the app follows its progress. The agent itself is described in [`SPEC.md`](./SPEC.md).

## 1. Sequence

1. The user finishes the pairing cards.
2. **The app** shows the "you're done" screen, which calls `onboarding-summary-agent` (as it already does).
3. **`onboarding-summary-agent`** starts the recipe discovery in the background (since 2026-10-05; migration `2026100511`). The app makes no call of its own.
   - It happens once per user: only if no discovery ever started for them (`onboarding.recipe_discovery_run` unset).
   - It runs with the user's own token; the summary does not wait for it.
   - It can be switched off with `agent.options.start_recipe_discovery` in the summary agent's config.
   - A direct call is still possible, e.g. for a "try again" button:
   ```
   POST {SUPABASE_URL}/functions/v1/user-profile-agent
   Authorization: Bearer <the user's session access token>
   Content-Type: application/json

   { "user_id": "<the same user's id>" }
   ```
   Replies:
   - **202** `{ "status": "started", "run": "<run id>", "seeds": [{ "seed": "pizza", "quota": 2 }, …], "fill_up": true }`, after a few seconds. The work continues in the background for several minutes.
   - **202** `{ "status": "already_running" }`: a run for this user is still active (it made progress within the last 15 minutes). Nothing new is started; keep following the current one.
   - A profile with no favorite dishes and no go-to recipes still gets a run: the fill-up alone (§2).
   - **422**: no favorite dishes, no go-to recipes, and the fill-up is switched off, so there is nothing to look for. Nothing is written.
   - **400** (no `user_id`), **401** (no or invalid token), **403** (the token belongs to someone else), **404** (no `tbl_user_memory` row), **500**.
4. **The agent** writes its progress into `memory_json.onboarding` (§2) while it runs.
5. **The app** reads `memory_json.onboarding` (poll or realtime) to show progress. It may append its own entries to `onboarding.status` (e.g. `{"current": "complete"}`), but the discovery does not depend on them.

## 2. What the agent writes

```jsonc
"onboarding": {
  "status": [
    {"current": "complete",                  "time": "2026-10-04T10:00:00.000Z"},  // app
    {"current": "recipe_discovery_complete", "time": "2026-10-04T10:04:30.512Z"}   // agent — ONE entry, updated in place:
  ],                                                                                //   recipe_discovery_started → _complete | _failed
  "recipe_discovery_run": "2026-10-04T10:00:01.874Z",                             // agent — internal run id
  "recipe_discovery": [                                                               // agent — one item per seed dish, then the fill-up
    {"name": "pizza", "status": "complete", "found": 7, "accepted": 1, "saved": 1, "rejected": 6,
     "recipes": [{"uuid": "…", "title": "Pizza"}], "updated_at": "…"},
    {"name": "dhall", "status": "in_process", "found": 3, "rejected": 1, "updated_at": "…"},
    {"name": "Carne de porco à merçês", "status": "failed", "error": "Explore failed: …", "updated_at": "…"},
    {"name": "Tofu Bolognese", "status": "waiting", "updated_at": "…"},
    {"name": "More recipes for you", "type": "fill", "status": "waiting", "updated_at": "…"}
  ]
}
```

- **`recipe_discovery`** is replaced at the start of every run, with one `waiting` item per seed dish. Seeds are the user's favorite dishes, then their go-to recipes; only the first `cap` of them run when there are more seeds than recipes allowed (cap below).
- **The fill-up item** (`"type": "fill"`, named "More recipes for you", always last):
  - it stays `waiting` until every dish is `complete` or `failed`;
  - then it brings the user to 10 recipes with lunch, dinner and snack recipes chosen from the rest of their profile;
  - it has the same counts as a dish; with nothing to add (the user already has 10) it completes with `"note": "nothing to add"`;
  - show it as its own row ("Finding more recipes for you…"), not as a dish.
- **`recipes`** (on any item): the recipes it accepted, `{uuid, title, saved}`, as they are accepted. `saved` is true when the recipe is in the user's recipes (always false while saving is off). `uuid` is null for a recipe Explore wrote that was not saved.
  - Item `status`: `waiting` → `in_process` → `complete` | `failed`.
  - Dishes are worked on a few at a time, so an item can stay `waiting` for a few minutes.
- **Counts** appear and grow while an item is `in_process`; they are final once it is `complete`. Missing means 0.
  - `found`: recipes considered for that dish (the dish itself, recipes Explore found, recipes Explore wrote).
  - `rejected`: failed the allergy / intolerance / avoided-food check.
  - `accepted`: passed the check and fit under the cap.
  - `saved`: actually added to the user's recipes. This is 0 while saving is switched off; `accepted` is then what *would* have been saved.
  - `failed`: recipes that could not be processed (a parse or save error).
- **`error`** (on a `failed` item): a short technical reason.
- **`status`** holds exactly ONE recipe-discovery entry, which the agent updates in place:
  - a run's start sets it to `recipe_discovery_started`;
  - when the last item finishes (the fill-up, when there is one), the same entry becomes `recipe_discovery_complete` if at least one item completed, otherwise `recipe_discovery_failed`;
  - a new run sets it back to `recipe_discovery_started`.

  The run is over when the entry says complete or failed. The app's own entries (`{"current": "complete"}` …) are never touched.
- **Preferred recipes:** when the run finishes, the recipes saved for the user's dishes are written to `meal_planning_preferences.preferred_recipes`, in the same statement as the final status.
  - Titles always come from the agent: the catalogue title of the recipe it saved (migration `2026100508`).
  - The user's own go-to entry for a dish, if it has no recipe yet, gets the recipe's `title` and `recipe_uuid`; the title they typed is kept as `original_title`.
  - Every other recipe is appended as `{title, recipe_uuid, sides: [], has_side: false}`.
  - Every entry the agent writes carries `discovery_run` (the run id).
  - The fill-up's recipes are not added: they are only in the user's recipes (their Main collection).
  - Nothing changes while saving is off.
- **Times** are ISO 8601 UTC with milliseconds.
- **Cap:** at most `explorer_handoff.max_new_recipes_per_week` recipes per run when that is a positive number, otherwise 10.

## 3. Rules for the app

- **Write only the keys you change** (e.g. `jsonb_set` / a merge in one statement), not the whole `memory_json` from a copy read earlier. Re-read immediately before writing if you must write the whole document.
  - The agent updates `onboarding` with single atomic statements while it runs, and the app's save after the summary screen lands exactly then.
  - On 2026-10-05 such a save erased two progress updates and the run stalled.
  - Since migration `2026100512`, the database keeps the agent's keys (`recipe_discovery`, `recipe_discovery_run` and the discovery status entry) whatever another write says.
  - `meal_planning_preferences.preferred_recipes` is not protected, because the app edits it legitimately: a stale whole-document write there can still drop the recipes a run added.
- Never write `onboarding.recipe_discovery`, `onboarding.recipe_discovery_run` or the `recipe_discovery_*` status entry; they belong to the agent.
- The agent also writes `meal_planning_preferences.preferred_recipes` when a run finishes, so the same re-read rule applies to it.
- **A run that stops making progress:** if no item's `updated_at` has changed for **5 minutes** and there is no final status, the run was cut off. Show unfinished dishes as failed. Calling the agent again starts a fresh run once 15 minutes have passed without progress.
- Calling the agent again while a run is active returns `already_running`. Recipes the user already holds are never added twice.
- New recipes appear in the user's recipe list (`tbl_user_recipes`) as each dish is processed, once saving is enabled.

## 4. On every app load: the recipe setup check

Since 2026-10-06 (migration `2026100604`), a discovery that falls short is finished later, when the app loads. The run's status (§2) can say complete when nothing was saved. On 2026-10-05, for example, the saves went to an outdated Flask. So the check looks at what was actually saved.

After onboarding is complete (the summary screen has been shown), **on every app load**:

1. Read the user's row:
   ```
   supabase.from('tbl_recipe_setup').select('status').eq('account_key', userId).maybeSingle()
   ```
   Users can read only their own row. Nobody can write it through the API.
2. If there is **no row**, or `status` is anything but `complete`, call the agent without waiting for the answer:
   ```
   POST {SUPABASE_URL}/functions/v1/user-profile-agent
   Authorization: Bearer <the user's session access token>
   Content-Type: application/json

   { "user_id": "<the same user's id>", "mode": "ensure" }
   ```
   - It answers `{ "status": "complete" | "running" | "pending" | "failed", "reason": "…" }`.
   - When it starts a retry run, it answers **202** `{ "status": "running", "run": "…", "retry": true, … }`.
   - Calling it again is harmless: two calls never start two runs.
3. While the status is `running`, show **"Picking recipes for you…"**.
   - To hide it when the run ends, subscribe to the row with Realtime (the table is in the `supabase_realtime` publication), or read it again on the next load.
   - New recipes appear in the Main collection as they are saved, through the collection sync the app already has.
4. On `failed`, show nothing. The team sees it on the dashboard (Recipes → Recipe Setup) and can retry from there.
5. Once the status is `complete`, stop calling. It is final, so a recipe the user deletes later is never put back.

| `status` | Meaning |
|---|---|
| `pending` | Something is missing. A load after the retry delay (15 minutes) starts a retry run of only what is missing. |
| `running` | A run is working: onboarding's, or a retry. |
| `complete` | Done. The user has their recipes, or as many as their profile allows. |
| `failed` | 3 runs did not finish the job, or a person has to look at it (e.g. the user has no Main collection). |
