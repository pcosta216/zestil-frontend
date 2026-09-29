# Recipe Parser — Spec

Current state only. If something here seems surprising, check `DECISIONS.md` for why — this file doesn't carry historical narrative.

## 1. What it does

Turns a recipe — raw pasted text, or a URL to scrape — into the two things the rest of the app needs: ingredient lines that are *nutritionally real* (resolved against `tbl_ingredients_master_core` via `fdcid_uuid`, so macros can be computed) and a structured list of instruction steps. Persists both, plus recipe metadata, and enqueues anything that didn't resolve for self-healing rather than failing the save.

Four modules, one pipeline:

| Module | Lines | Role |
|---|---|---|
| [`full_recipe_parser.py`](../../app/full_recipe_parser.py) | 317 | Acquisition (text or URL) + composition. Owns JSON-LD extraction and the merge of the two lanes below. |
| [`recipe_parser.py`](../../app/recipe_parser.py) | 815 | Lane A — ingredient lines → qty, unit, `fdcid_uuid`. |
| [`instruction_parser.py`](../../app/instruction_parser.py) | 344 | Lane B — steps, tips, and recipe meta (prep/cook time, servings, author, difficulty). |
| [`recipe_save.py`](../../app/recipe_save.py) | 312 | Persistence and the async follow-on work (waitlist queueing, classification, graph build, image fetch). |

## 2. Architecture at a glance

```
  raw text                    URL
     │                         │
     │              ┌──────────┴──────────┐
     │              │ scrape_and_parse_full│
     │              │  JSON-LD? ──yes──┐   │
     │              │      │ no        │   │
     │              │   page text      │   │
     │              └──────┬───────────┼───┘
     └────────────────────►│           │
                           │           │ structured meta
              ┌────────────┴─────┐     │ (nutrition, image,
              │                  │     │  cuisine, video)
              ▼                  ▼     │  — no LLM
    ┌──────────────────┐  ┌──────────────────┐
    │  LANE A          │  │  LANE B          │
    │  recipe_parser   │  │ instruction_     │
    │  ingredients     │  │ parser           │
    │                  │  │ steps + meta     │
    │ deterministic    │  │                  │
    │  qty/unit        │  │ 1 Gemini call    │
    │ + 3 LLM/API      │  │                  │
    │   calls          │  │                  │
    └────────┬─────────┘  └────────┬─────────┘
             └────────┬────────────┘
                      ▼
              _merge + _strip_internal_fields
                      ▼
              save_full_recipe  →  header, lines, instructions, snapshot
                      ▼
        unmatched → waitlist → agent messages → self-heal
```

**The load-bearing design rule, everywhere in Lane A: the model never produces an identifier.** It's given an indexed candidate list fetched by code and returns an array index (`{"i":0,"match":2}` — *the third candidate*). Code maps that index back to the UUID it fetched. An out-of-range index is discarded; a hallucinated UUID would have been silently wrong and would have attached the wrong nutrition to a meal. The [Recipe Classification Agent](../recipe-classification-agent/SPEC.md) picks numeric IDs from an injected taxonomy for the same reason.

Two lanes rather than one prompt, because the two problems are different in kind: instructions have no ground truth to check against (a step is prose that stays prose), so one Gemini call with a fixed schema is exactly right. Ingredients have to resolve against a database, so Lane A never lets the model touch an identifier and instead splits into narrow jobs — quantity/unit extraction is code (rule-governed), name extraction is the model (genuinely semantic), candidate retrieval is code (the database is the authority), and picking from candidates is the model, by index only.

## 3. Entry points

Four HTTP routes in `app/api.py`, plus two dashboard flows in `app/dashboard/routes.py`. All four HTTP routes require `X-API-Key` (see §7 for the auth caveat).

| Entry point | Behavior |
|---|---|
| `POST /api/v1/recipe/parse` ([`api.py:703`](../../app/api.py#L703)) | Ingredients lane only. `{"text": "..."}` → `recipe_parser.parse_recipe()` → `{"status": "success", "data": {"name", "ingredients": [...]}}`. No save. |
| `POST /api/v1/recipe/submit` ([`api.py:511`](../../app/api.py#L511)) | Parse **and** save in one call. `{"text": "..."}` or `{"url": "..."}`, requires `X-User-Id`. Runs `full_recipe_parser` (text or URL) then `save_full_recipe`. Returns `{"recipe_uuid", "line_count", "unmatched_count"}`. |
| `POST /api/v1/recipe/save` ([`api.py:644`](../../app/api.py#L644)) | Save a JSON payload the caller already parsed elsewhere. `{"parsed_json": {...}, "account_key" or X-User-Id, "url"}` → `save_full_recipe()` directly, no parsing step. `account_key` in the body is only used when the `X-User-Id` header is absent. |
| `POST /api/v1/recipe/link` ([`api.py:586`](../../app/api.py#L586)) | Not a parser call at all — attaches an *already-saved* recipe to a user's list (`db.upsert_user_recipe_snapshot`), for the case where a caller (per its own docstring, the explore-agent's discovery path) found a recipe already in the database and just needs it linked. Requires `X-User-Id` and `{"recipe_uuid": "..."}`. |
| Dashboard `/database/full-parse` ([`routes.py:1363`](../../app/dashboard/routes.py#L1363)) → `/run` ([`:1369`](../../app/dashboard/routes.py#L1369)) / `/run-url` ([`:1381`](../../app/dashboard/routes.py#L1381)) → `/save` ([`:1393`](../../app/dashboard/routes.py#L1393)) | Full pipeline (ingredients + instructions), parse and save as **separate** calls — `/run`/`/run-url` return `{result, log}` for inspection; `/save` takes the (possibly hand-corrected) JSON. |
| Dashboard `/database/recipe-parse` ([`routes.py:1677`](../../app/dashboard/routes.py#L1677)) → `/run` ([`:1683`](../../app/dashboard/routes.py#L1683)) | Ingredients lane only (`recipe_parser.parse_recipe`), same "inspect before you trust it" shape as the full-parse dashboard flow. |

The dashboard's parse/save split is why the parser is developable at all: paste a recipe → inspect the structured output and the log → fix the unit map or add a synonym → re-run → save when it's right. Both dashboard parse flows return a **log array** alongside the result — line counts, JSON-LD found or not, extracted character counts, per-step errors — because parsing fails in shades rather than pass/fail.

No caller for `/api/v1/recipe/link` or `/api/v1/recipe/save` was found anywhere in this repo (`supabase/functions/`, `app/`) — grepped for both route paths, no hits. Their own docstrings describe intended callers (explore-agent for `/link`; a caller that parses independently and saves separately for `/save`) that must live in `zestil-frontend`, which isn't in this workspace. Not confirmed either way; stated plainly rather than assumed.

## 4. Input acquisition (`full_recipe_parser.py`)

`scrape_and_parse_full(url)` tries three sources in descending order of reliability:

1. **schema.org JSON-LD** (`_parse_from_jsonld`) — most recipe sites publish it for Google. Gives `recipeIngredient` as a clean array and `recipeInstructions` as typed steps, no scraping heuristics.
2. **Targeted page text** (`_extract_page_text`) — strips `script/style/nav/footer/header/aside`, walks a selector list ordered by specificity (`[class*="recipe-instructions"]`, `[class*="wprm-recipe"]`, `[class*="tasty-recipes"]`, then generic `article`/`main`), accepts the first match over 200 characters.
3. **Whole `<body>`** — last resort.

**Structured meta never touches the LLM.** `_extract_structured_meta()` pulls nutrition, category, cuisine, image and video straight from the JSON-LD dict — publisher-declared facts are copied, not re-derived.

**JSON-LD is normalized *into text* before parsing, not handled as a separate path.** `_flatten_steps()` renders `HowToStep`/`HowToSection` objects back into the two textual formats the instruction prompt already understands (numbered steps, or `"Step N (Title):"` blocks with bullets) — so one prompt handles JSON-LD and free text alike, and the messier path (free text) isn't a second, less-tested implementation.

`_resolve_author()` dereferences the schema.org `{"@id": "#/schema/person/1"}` pointer-into-`@graph` pattern rather than reading a name that isn't there directly.

**Duplication, not shared code:** `_resolve_author`, `_flatten_steps` and `_extract_structured_meta` are implemented twice — verbatim — between `full_recipe_parser.py` and `instruction_parser.py`. A JSON-LD quirk fixed in one copy won't be fixed in the other.

## 5. Lane A — ingredient pipeline (`recipe_parser.py`)

### 5.1 Deterministic quantity/unit extraction

`_parse_ingredient_line()` runs before any LLM call. In order: strip checkbox/bullet noise (`▢□☐☑☒✓✔•‣◦-*+`), unicode fractions → ASCII (`¼` → `1/4`), mixed fractions → decimal (`1 1/2` → `1.5`), split glued tokens (`400g` → `400 g`), strip parentheticals (`(about 180-200g each)`) while preserving the original text for `ingredient_text`.

Units only match if an ingredient word still remains after the unit is removed — this is what stops "3 eggs" from being read as qty=3, unit="egg"; it becomes qty=3, unit=`un` instead. `tbl_unit_map` ([`supabase/migrations/202605/20260504_unit_map.sql`](../../supabase/migrations/202605/20260504_unit_map.sql)) holds the unit vocabulary (`slice`, `piece`, `can`, `clove`, ...), cached in a module global; the dashboard's unit-map editor calls `reload_caches()` on save so a new synonym takes effect on the next parse with no restart (see §9 for the per-process caveat).

### 5.2 LLM name extraction + section detection (one call)

`_extract_ingredient_names()` (model `gemini-2.5-flash`, `temperature=0`, `response_mime_type='application/json'`) sends every line at once, numbered, and asks for a clean ingredient name or `null`. Rules: keep variety/color/grain-type/processing that define a distinct ingredient; strip quantities, prep words, freshness words, brands; for "X or Y" alternatives, return the more specific option; `null` for section headers and non-ingredients.

`parse_recipe()` reads that same `null` as a section boundary — section structure falls out of name extraction for free, with no separate heuristic pass, and the two answers can never disagree with each other. A small whitelist (`_SECTION_HEADERS`) then discards generic labels like *"Ingredients"* (→ `None`) while keeping real section names like *"For the Dough:"*.

**Shape validation is strict:** if the response isn't a list of exactly the same length as the input lines, the whole result is discarded and the code falls back to regex cleaning (§5.5) — the names are zipped positionally against parsed lines, so a misaligned result is worse than no result.

### 5.3 Hybrid candidate retrieval (three strategies, merged)

`_fetch_candidates()` builds a shortlist per ingredient:

| Strategy | Query | Similarity | Purpose |
|---|---|---|---|
| Text (all words) | `LIKE` on every word > 2 chars, shortest description first | `1.0` | Precise multi-word match |
| Text (per word) | Only if the above found nothing | `0.9` | "ground ginger" → "Ginger root, raw" |
| Synonym | Exact match on `tbl_ingredient_synonyms` | `1.0` | Regional names (cilantro → Coriander leaves) |
| Vector | pgvector cosine on the ingredient's name embedding, top-5 above 0.75 | actual | Custom and branded entries |

Run cheapest-and-most-precise first; the vector query only adds to what the exact paths already found. Merged by `fdcid_uuid` into a dict, first-writer-wins, so lexical/synonym hits take priority over vector ones. A pure vector query on a word like "ginger" clusters near fruits, not spices — embeddings capture semantic similarity, not the literal substring match FDC's multi-word descriptions need — which is why lexical search runs first and synonyms exist at all (`tbl_ingredient_synonyms`, [`supabase/migrations/202605/20260505_ingredient_synonyms.sql`](../../supabase/migrations/202605/20260505_ingredient_synonyms.sql)): no shared substring and unreliable vector similarity across regional names is exactly the case neither of the other two strategies handles. `ORDER BY LENGTH(description) ASC` biases toward the least-qualified, most generic entry among matches.

The vector embedding this strategy queries against is written by [`embed-ingredient-name`](../../supabase/functions/embed-ingredient-name/index.ts), a trigger-driven edge function on `tbl_ingredients_master_core` insert (see `AGENT_INVENTORY.md`) — this parser only ever reads it.

### 5.4 LLM disambiguation, by index (one call)

`_disambiguate_with_llm()` (model `gemini-2.5-flash`) sends every line, its extracted name, and its indexed candidates in one call. Rules: ignore qualifiers ("unseasoned", "fresh", "organic", "raw") and prep notes, but prefer the most specific candidate for what the ingredient *is* ("Brown Basmati Rice" → "brown rice" not "rice"; "Ginger, ground" over "Ginger root, raw" for ground ginger) — qualifiers describing this recipe's prep are noise, qualifiers describing what the ingredient *is* are signal, and that distinction isn't one a similarity score can make on its own. Always stay within the same food category. Use the full original line only to resolve genuine ambiguity ("baking powder" ≠ "Curry Powder"). Return `null` only if every candidate is from a completely different category — deliberately reluctant, because a wrong match is worse than an unresolved line.

Validation: only an `int` with `0 <= match < len(candidates)` is accepted; anything else becomes `None`.

### 5.5 Fallbacks

Every LLM/API step degrades to something deterministic:

| Step | Failure | Fallback |
|---|---|---|
| Name extraction | No key, error, shape mismatch | `_clean_for_classification()` — regex stripping of parentheticals, leading qty, leading unit word |
| Embeddings | No DeepInfra key, API error | Smith-Waterman local sequence alignment over the full cached ingredient dictionary, plus word-overlap ratios (`_word_ratio`, `_count_matching_words`, `_count_exact_words`) |
| Disambiguation | No key, error, bad JSON | Top-1 vector candidate |

Smith-Waterman is pure Python, O(n·m) per pair, single-threaded — slow, but entirely offline; it's the original matcher, kept so the parser still works with no external API at all, just less well (see §9 for the scaling caveat).

### 5.6 Serving-size fallback

A line like "salt to taste" parses with `qty=None`; since nutrition is `quantity × per-100g`, a null quantity means a null contribution. `_serving_fallback()` batch-fetches every serving size for the affected ingredients in one query, ranks units `g` → `ml` → other, and assigns `qty=1.0` with that unit — but only when the user *didn't* write an explicit count ("3 eggs" keeps its parsed qty/unit). When there's no `fdcid_uuid` at all, unit is forced to `un` since an unmatched line has no serving data to be consistent with.

### 5.7 Call budget

For a recipe of any size, Lane A makes exactly three external calls (name extraction, batch embed, disambiguation), plus one for Lane B — four calls per recipe regardless of ingredient count, because every step is batched by construction.

## 6. Lane B — instruction pipeline (`instruction_parser.py`)

One Gemini call (`temperature=0`, `response_mime_type='application/json'`, [`:20`](../../app/instruction_parser.py#L20) for the prompt/schema), handling two input shapes `_flatten_steps()` can emit: numbered steps ("1. Do this.") and section blocks ("Step N (Title):" + bullets — each block is **one** instruction object; bullets under a heading are explicitly not split into separate steps).

Each step is `{step, title, actions[], notes, tips[]}` — actions as an array so the UI can render a checklist. General tips (serving suggestions, storage, make-ahead) use a sentinel `step: 99` entry instead of a separate top-level field, and are omitted entirely when the recipe has none.

`meta` is extracted in the same call: `prep_min`, `cook_min`, `total_time` (stated directly or inferred as prep + cook), `serves_string` (display text, e.g. "2-3 people") **and** `serves_value` (integer lower bound, for arithmetic), `author`, `date`, `difficulty`.

## 7. Merge, persistence, and self-healing

### 7.1 Merge (`full_recipe_parser._merge`)

Composes both lanes; recipe name resolves through a three-step fallback: instruction meta → ingredient-parser title → JSON-LD `name`. `_strip_internal_fields()` drops debugging fields (`_similarity`, `_candidates`) and promotes `_llm_name` to the public `ingredient_name` field **only when the line is unmatched** (`fdcid_uuid` is null) — that field is what the waitlist trigger reads, so the parser's best guess at what the ingredient *is* becomes the search term the research agent uses later.

### 7.2 Persistence (`recipe_save.save_full_recipe`)

Writes header → lines → instructions → snapshot. Line status encodes resolution — `1310` if `fdcid_uuid` resolved, `1320` if not ([`db.py:959`](../../app/db.py#L959), `insert_recipe_lines`) — both are valid saved states; an unmatched ingredient is a recipe that isn't finished resolving yet, not an error.

### 7.3 Waitlist trigger (in the database, not the app)

[`supabase/migrations/202605/20260506_waitlist_trigger.sql`](../../supabase/migrations/202605/20260506_waitlist_trigger.sql): any line inserted or updated with `fdcid_uuid IS NULL AND ingredient_name IS NOT NULL` gets a row in `tbl_recipe_ingredient_waitlist`, regardless of which code path did the insert (dashboard save, API submit, a manual `INSERT`) — the invariant can't be forgotten by a new caller.

### 7.4 Self-healing loop

```
parse → unmatched line
      → waitlist row (trigger)
      → tbl_agent_messages → balancing_agent   (classify into a food group)
      → database_agent                          (research + insert the ingredient)
      → resolve_waitlist_for_ingredient()       (db.py:1075 — backfill EVERY waiting line)
      → line UPDATE → trigger → recompute_recipe_snapshot()
      → when count_pending_waitlist() == 0 → re-classify the recipe
```

- **Fan-out by description**, not by recipe: `resolve_waitlist_for_ingredient()` matches on description, so researching *sumac* once fixes every recipe that was waiting on it.
- **Snapshot refresh is a trigger**, not app code: [`supabase/migrations/202605/20260511_recipe_line_update_trigger.sql`](../../supabase/migrations/202605/20260511_recipe_line_update_trigger.sql) fires on any change to `ingredient_qty`, `ingredient_unit`, `fdcid_uuid` or `section` and recomputes `tbl_user_recipes.recipe_data`.
- **Re-classification waits for an empty waitlist** — classifying a half-resolved recipe would tag it from incomplete nutrition.
- **Deduplication is double**: before queueing, check whether the ingredient already exists in the master table, and whether a pending/processing message for it is already queued. One `sumac` message serves however many recipes need it.

### 7.5 Async fan-out after save

Classification, graph build, and image fetch run in daemon threads — `save_full_recipe` returns as soon as the data is durable. Graph building is chained *behind* successful classification (the graph builder consumes classifications; this is a real ordering dependency, not an arbitrary one). Image fetch is conditional: a scraped recipe already has the publisher's photo from JSON-LD, so only agent-generated recipes (no source `url`) trigger a fetch — Wikipedia opensearch-then-thumbnail first, falling back to Pexels.

## 8. Auth

`/api/v1/recipe/parse`, `/submit`, `/save` all require the static `X-API-Key` header, checked against the `API_KEY` env var. `/submit`, `/save`, `/link` additionally require `X-User-Id` (the account to attribute the recipe/link to) — for `/save`, a body field `account_key` is accepted only when the `X-User-Id` header is absent.

**Nothing in `app/api.py` verifies that `X-User-Id` corresponds to the caller's actual authenticated session** — no JWT decoding, no `supabase.auth.getUser()` call, no auth import at all in the file. It's taken at face value. Combined with `API_KEY` already being tracked as leaked in plaintext ([`docs/VULNERABILITIES.md`](../VULNERABILITIES.md), finding #8), anyone holding that key can submit, save, or link a recipe under any `X-User-Id` they choose. Flagged as a new finding, [finding #12](../VULNERABILITIES.md#12-app_apipys-x-user-id-header-is-trusted-with-no-session-verification-and-two-routes-need-no-secret-at-all) — see there for the full write-up, which also covers two *other* routes in the same file (`/api/v1/plan`, `/api/v1/chat`) that need no `X-API-Key` at all.

## 9. Known limitations

- **`_queue_unmatched_ingredients()` in [`recipe_parser.py:731`](../../app/recipe_parser.py#L731) is dead code.** ~85 lines, never called — superseded by `recipe_save._queue_unmatched()`. It also references `item.get('ingredient', ...)`, a key the parser never produces, so it would silently fall back to the description if it ever ran.
- **`_resolve_author`, `_flatten_steps`, `_extract_structured_meta` are duplicated verbatim** between `full_recipe_parser.py` and `instruction_parser.py` (§4).
- **`app/recipe_reader.py` and `app/ingredient_conversion.py` are dead.** Both still `import supabase_connection`, a module that doesn't exist anywhere in this tree — confirmed present but unimportable. Pre-refactor leftovers; nothing references either file.
- **Smith-Waterman doesn't scale.** Pure-Python local alignment against every dictionary row is O(n·m) per pair, single-threaded. Fine as a rare fallback, not viable as a primary path as the catalog grows.
- **Synonym lookup is exact-match only** (`LOWER(synonym) = LOWER(text)`) — "cilantro leaves" misses a "cilantro" synonym. Deliberate (keeps a unique lower index fast and unambiguous), but means synonym coverage has to be broad rather than clever.
- **No unit conversion at parse time.** `cup`/`tbsp` are stored as-is; converting to grams needs `tbl_food_portions_core` at consumption time (correct, since density is ingredient-specific) — but an ingredient with no portion data yields a quantity nothing downstream can use.
- **`recipe_parser.parse_recipe()` requires the first line to be the title.** Fine for the JSON-LD path (which prepends the name), but a pasted ingredient list with no title loses its first ingredient.
- **Module-level caches (unit map, ingredient dictionary) are per-process.** `reload_caches()` only clears the current worker; under multiple gunicorn workers, a unit-map edit reaches one of them, not all.
- **Fire-and-forget async work is unobserved.** If classification or graph build throws inside its daemon thread, the recipe is still saved and the failure is only in the log — no retry, nothing surfaced in the API response.
- **`/api/v1/recipe/link` and `/api/v1/recipe/save` have no known caller in this repo** (§3) — not necessarily unused, just unverifiable from here.

## 10. Where to look

| Concern | File |
|---|---|
| Acquisition, JSON-LD, merge | [`app/full_recipe_parser.py`](../../app/full_recipe_parser.py) |
| Quantity/unit parsing | [`app/recipe_parser.py:98`](../../app/recipe_parser.py#L98) |
| LLM name extraction + section detection | [`app/recipe_parser.py:257`](../../app/recipe_parser.py#L257), [`:631`](../../app/recipe_parser.py#L631) |
| Hybrid candidate retrieval | [`app/recipe_parser.py:353`](../../app/recipe_parser.py#L353) |
| LLM disambiguation | [`app/recipe_parser.py:458`](../../app/recipe_parser.py#L458) |
| Smith-Waterman fallback | [`app/recipe_parser.py:177`](../../app/recipe_parser.py#L177) |
| Instruction prompt and schema | [`app/instruction_parser.py:20`](../../app/instruction_parser.py#L20) |
| Save orchestration + async fan-out | [`app/recipe_save.py`](../../app/recipe_save.py) |
| Line insert and status codes | [`app/db.py:959`](../../app/db.py#L959) |
| Waitlist resolution | [`app/db.py:1075`](../../app/db.py#L1075), [`app/agent_message_listener.py:176`](../../app/agent_message_listener.py#L176) |
| HTTP entry points | [`app/api.py:511-753`](../../app/api.py#L511) (`submit`, `link`, `save`, `parse`) |
| Dashboard entry points | [`app/dashboard/routes.py:1363`](../../app/dashboard/routes.py#L1363) (full-parse), [`:1677`](../../app/dashboard/routes.py#L1677) (recipe-parse) |
| Waitlist trigger | [`supabase/migrations/202605/20260506_waitlist_trigger.sql`](../../supabase/migrations/202605/20260506_waitlist_trigger.sql) |
| Snapshot refresh trigger | [`supabase/migrations/202605/20260511_recipe_line_update_trigger.sql`](../../supabase/migrations/202605/20260511_recipe_line_update_trigger.sql) |
| Unit vocabulary | [`supabase/migrations/202605/20260504_unit_map.sql`](../../supabase/migrations/202605/20260504_unit_map.sql) |
| Ingredient synonyms | [`supabase/migrations/202605/20260505_ingredient_synonyms.sql`](../../supabase/migrations/202605/20260505_ingredient_synonyms.sql) |
