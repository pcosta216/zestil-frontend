# Shared — the validator gate (free-text "Other" entries)

Status: live · Last verified: 2026-09-25
Verify: `scripts/onboarding-seed/verify-mixed-entry-review.mjs` (mixed batches, per-entry rows),
`scripts/onboarding-seed/verify-favrecipes-review.mjs` (section-specific flag semantics),
`scripts/onboarding-seed/verify-invalid-no-override.mjs` (the `invalid` hard-block, via `n_dishes`)

Any screen that accepts free text runs it past the **Onboarding Validator Agent** before the
answer is submitted — a pre-submit gate in the components, not part of `applyAnswer`, so the
engine stays pure and never calls out.

Applies to: `n_cuisine_narrow`, `n_dishes`, `n_allergies`, `n_intolerances`,
`n_favorite_recipes`, `n_diet_style_cards`, plus the three macro decks (wired, not yet live).

## Transport

```
POST ${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-validator-agent
Authorization: Bearer <the user's session access_token>     (never the service-role key)
{ user_id, section, context, entries }
→ { results: [{ entry, verdict, value, label, reason, split_into? }] }
```

Clients don't call this directly. They POST to `/api/onboarding/validate-other` with
`{node_id, item, entries}`; the route resolves the node's `validation.payload.context` against
server-side memory (a client can't — `n_intolerances` passes `{dietary.allergies}`) and forwards.
One call per **submission**, never per entry; entries are comma/semicolon/newline-split first.

## Sections

`lib/onboarding/validator-sections.ts` holds the in-scope set. The Edge Function keeps its **own
hardcoded allowlist** — adding a section to `tbl_agent_configs` is *not* enough to make it
callable, and an unknown section 400s. Re-probe the live function before adding a name here:
`scripts/onboarding-seed/probe-diet-style-section.mjs`.

| Node | `section` | `context` |
|---|---|---|
| `n_cuisine_narrow` | `cuisine_narrow` | `{regions}` |
| `n_dishes` | `dishes` | `{parent_sub_cuisine, diet_type, regions}` |
| `n_allergies` | `allergies` | `{}` |
| `n_intolerances` | `intolerances` | `{allergies}` |
| `n_favorite_recipes` | `favorite_recipes` | `{cuisines, favorite_dishes}` |
| `n_diet_style_cards` | `diet_styles` | `{}` — **plural**; `diet_style` is rejected |
| `n_protein_exclusion_cards` | `protein_source` | `{carb_sources, fat_sources}` — **labels** |
| `n_carb_exclusion_cards` | `carb_source` | `{protein_sources, fat_sources}` — **labels** |
| `n_fat_exclusion_cards` | `fat_source` | `{protein_sources, carb_sources}` — **labels** |

**`regions` is a hard requirement, not extra detail.** The agent's region check is
`selectedRegions.includes(hit.region)`, reading `context.regions` — an array of the six region
slugs (`asia_oceania`, `central_latin_america`, `europe`, `north_america`, `middle_east`,
`africa`), the same vocabulary `n_cuisine_broad` writes into `taste_profile.cuisines`. Omit it and
the check matches nothing, so every in-region cuisine comes back `flag`ged as out-of-region — a
failure that reads like a model problem and isn't one.

**The three macro-source sections carry only the *other two* macros in `context`**, never their
own — that's what lets the agent spot a cross-macro duplicate — and they carry display **labels**,
not the slugs every other section sends. The agent quotes them back verbatim ("You already listed
Poultry as a Protein Source"), so `red_meat` reaching it surfaces as "Red_meat" in real copy.
`{ path, labels_from: <node id> }` in the YAML context is what maps one to the other; see
[`../onboarding/exclusion-decks.md`](../onboarding/exclusion-decks.md).

Out of scope for good: `cuisine_broad` declares a `validation` block but never reaches the
network — `validateEntries` synthesises all-valid locally. Its option set is closed enough not to.

## Verdicts

| Verdict | Meaning | UI |
|---|---|---|
| `valid` | agrees with the user | accepted silently, no row shown |
| `flag` | plausible, worth a look | resolvable — see below |
| `invalid` | not a real answer for this section | **no accept-as-typed, ever** |

`invalid` is hard-blocked on **every** section, deliberately and uniformly. Forcing one through
writes the wrong *kind* of data (a cuisine typed as a dish, gibberish as an allergy). `allergies`
is included: it returns `invalid` for entries naming nothing usable, and the block applies there
like anywhere else. Don't add a section-specific exemption without revisiting that decision.

What `flag` *means* is section-dependent, and this is the subtle part:

- Most sections: "are you sure?" → the user can approve and keep the entry.
- `favorite_recipes`: the section prompt defines `flag` as *"a nudge toward naming the particular
  dish meant"*. Approving as typed writes back the text the agent just called too vague, so
  there is **no approve button there**. See `onboarding/n_favorite_recipes.md`.

## Per-entry resolution

A batch can come back mixed (`"kketo"` flagged, `"silver surfer"` invalid). Each problem entry
gets its own row and its own decision; Continue commits and stays disabled while any row is
undecided. There is no batch-wide override.

Rows render `result.reason` — the agent's own text. The node's static `on_invalid_message` is a
fallback for a null reason, which should be unreachable.

## Before and after the call

**Pre-check** — a typed piece matching a rendered option's label (case/whitespace-insensitive)
is a plain selection, not a custom entry. Toggled directly, never sent. If nothing remains, no
network call happens at all.

**Post-normalisation dedupe** — if the agent's `value` matches a rendered option's value, select
that option instead of appending a duplicate custom entry.

> Typing two dishes and getting back one row is this, not a lost entry — the matched one became a
> lit tile. Matters most on a screen re-entered via [Back](back-navigation.md), where recalled
> entries are rows and recalled selections are tiles.

> **Known gap.** The agent normalises to its own vocabulary, which does not align with the
> curated option values: `"keto diet"` → `ketogenic`, but the curated option is `keto`. The
> dedupe misses, and a custom entry is appended that downstream lookups keyed on `keto` won't
> match. This is the deferred stage-2 free-text/option matching problem, not a bug to patch here.

**Staging** — entries are also appended to `memory.other.<section>`, alongside the real field,
flagging them as user-typed for that future pass. This runs from the `other_capture` branch, so
`n_favorite_recipes` (which declares `validation` at node level, not inside `other_capture`) is
**not** staged.

## Failure modes

All of them degrade to `flag` — never to `valid`, which would silently accept unvalidated text,
and never to `invalid`, which would hard-block on our own fault.

- **Timeout.** `TIMEOUT_MS = 20000` in `lib/onboarding/validate-other.ts` — sized from measured
  traffic, not estimated; that constant's own comment carries the numbers and the trade-off.
- **Short or malformed response.** Results are matched **by entry text**, not by position or a
  length check. Any entry the response doesn't cover becomes a flag. The model returns fewer
  results than entries on roughly 5% of multi-entry calls (observed in `tbl_agent_debug_log`);
  the Edge Function repairs the count, so this is belt-and-braces.
- **Copy.** Every synthetic flag carries `TOTAL_FAILURE_REASON` from `validator-sections.ts`,
  verbatim on both sides, so our timeout and a real backend failure are indistinguishable. It is
  also how `FreeTextSearch` tells "we couldn't check this" (confirmable) apart from a real
  section flag (not confirmable).

## Debugging

`tbl_agent_debug_log`, filtered to `agent_name = 'Onboarding Validator Agent'`, has one row per
request: `user_message` (entries, pipe-separated), `turns[0].raw_text` (the model's **raw**
output), `final_response` (what the function returned), and `duration_ms`. Comparing `raw_text`
against `final_response` tells you whether the model failed to produce something or the function
dropped it — it has settled every validator question so far.
