# Food data: signed-in users read only — the frontend check

**For:** whoever has access to `zestil-frontend` (not in this workspace: nothing below was checked there). **From:** the agents repo, 2026-10-22. **Migration it gates:** `supabase/migrations/202610/2026102212_food_data_signed_in_read_only.sql`. **Why:** `docs/VULNERABILITIES.md` #9, `docs/planner-agent/BRANDED_FOODS.md` D71.

## What changes

Zestil's food data is three tables (`tbl_ingredients_master_core`, `tbl_food_nutrients_core`, `tbl_food_portions_core`) and 37 database functions that read them.

| Who calls | Today | After 2026102212 |
|---|---|---|
| **Signed in** (the anon key with the user's session) | Reads, **and can insert** | Reads only. A write fails: `permission denied for table …` |
| **Not signed in** (the anon key, no session) | Reads everything, calls the 37 functions | Nothing. `permission denied for table …` / `… for function …` |
| **Service role** (edge functions, server code with the service key) | Everything | Unchanged |

Writes to the food data now come only from Zestil's code: the edge functions and the Flask app, with the service role or as the owner. A food a user enters from a label stays on their own list, never in these tables (D63, D68).

**What the database shows:** since 2026-03-04, no read, write or function call on any of these by a signed-in user or the anon key (`pg_stat_statements`). That covers what was used in that time, not a screen nobody opened. Hence this check.

## What would break

1. **A read or call before sign-in:** any query on the three tables, or call of the 37 functions, made with no user session.
   - Look at screens shown before sign-in: landing, onboarding, a shared or public recipe page, a barcode scan.
   - Look at server code (Next.js route handlers, server actions, `app/api/**`) that creates its client with the anon key and doesn't attach the user's session.
2. **Any write to the three tables, signed in or not:** `insert`, `upsert`, `update` or `delete` through the anon key.
3. **Before sign-in only:** an edit to a recipe's lines (`tbl_recipe_ingredients_line`). Its trigger rebuilds the recipe through `get_recipe_json_by_uuid`, one of the 37.

**Not affected:**
- Calls to Zestil's edge functions: the agents, `sides-catalog`, `snacks-catalog`, `breakfasts-catalog`. They check the user's token, then use the service role inside.
- Server code using the service role key.
- Any read by a signed-in user.

## The checks

Run from the root of `zestil-frontend`.

**1. The tables.** List every use, then look at the operation of each.

```sh
grep -rnE "tbl_ingredients_master_core|tbl_food_nutrients_core|tbl_food_portions_core" --include=*.ts --include=*.tsx --include=*.js --include=*.jsx . | grep -v node_modules
```

**2. The 37 functions.** This covers `.rpc('…')` and raw `/rest/v1/rpc/…` URLs alike.

```sh
grep -rnE "_trigger_sync_ingredient_food_group_edges|breakfast_category_for_ingredient|find_duplicate_ingredient_pairs|fn_apply_tag_details|fn_tag_details_for|get_ingredient_completion_status|get_ingredient_diversity_audit|get_ingredient_for_qa|get_ingredients_pending_name_embedding|get_item_info_json_by_uuid|get_missing_dietary_flags_count|get_missing_embedding_count|get_missing_food_group_category_count|get_missing_food_group_count|get_missing_health_attributess_count|get_missing_macronutrient_count|get_missing_nutrients_count|get_missing_processing_level_count|get_missing_servings_count|get_recipe_for_graph|get_recipe_json_by_uuid|get_total_ingredients_count|get_unreviewed_ingredient_uuids|preview_breakfast_category|preview_side_category|preview_snack_category|recompute_recipe_snapshot|search_conflicts_semantic|search_ingredient_fuzzy|search_ingredients_by_embedding|search_ingredients_by_name|search_knowledge_graph|search_pairings_semantic|search_substitutes_fts|search_substitutes_semantic|side_role_for_ingredient|snack_category_for_ingredient" --include=*.ts --include=*.tsx --include=*.js --include=*.jsx . | grep -v node_modules
```

**3. Recipe lines written from the app.** Only matters if a hit can run before sign-in.

```sh
grep -rnE "tbl_recipe_ingredients_line" --include=*.ts --include=*.tsx --include=*.js --include=*.jsx . | grep -v node_modules
```

**4. For each hit, which client makes the call.** Follow the Supabase client to where it's created:
- `createClient`, `createBrowserClient`, `createServerClient`, `createRouteHandlerClient`, or the project's own helper.
- Note its key: `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
- Note whether the user's session is attached: a browser client after sign-in, or a server client built from the request's cookies or `Authorization` header.
- **The anon key with no session counts as not signed in.**

## What to send back

One row per hit:

| File:line | Table or function | Read / write / call | Client: key, session attached? | Can run before sign-in? | Verdict |
|---|---|---|---|---|---|

- **Safe to apply** if every row is a read or a call, made with a session or the service key.
- **Not safe yet** if any row is a write to the three tables, or a read or call without a session. Send those rows: the fix is in the frontend (sign in first, or go through an edge function), or the migration changes.
- **No hits at all** is a valid answer. Say so, with the three commands' output.

## Optional, for a later change

Not part of this migration. These tables are open to anyone as well (`VULNERABILITIES.md` #17), and closing them will need the same check:
- `tbl_ingredient_pairings`, `tbl_ingredient_substitutes`, `tbl_ingredient_conflicts`;
- the older food tables: `tbl_ingredients_master`, `tbl_ingredients_main`, `tbl_ingredients_dictionary`, `tbl_food_nutrients`, `tbl_food_portions`, and their `_duplicate` copies.

Their policies mention "scanned items", so a barcode feature may write them. If the frontend uses any of them, add those rows to the same table.
