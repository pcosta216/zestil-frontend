# App docs — per-screen reference

Answers one question: **what is true about this screen right now?**

The diary (`docs/diary_log/`) answers a different one — *what did we decide, when, and what did
we reverse?* These docs are the spatial index; the diary is the chronological one. Neither
replaces the other.

## Rules

1. **Current state only.** No history, no "we used to…", no narration of how we got here. When
   behaviour changes, edit the doc in place. The diary keeps the trail.
2. **These docs follow the code, they don't lead it.** They describe what is implemented. If a
   doc and the code disagree, **the code is right and the doc is stale** — fix the doc. Never
   "fix" code to match a doc; take that to the diary as a new decision first.
3. **Link, don't restate.** Behaviour shared across screens lives once in `_shared/`. Rationale
   lives in code comments and the diary. A doc that repeats either will drift from it.
4. **One screen per file, roughly one page.** If it's growing past that, the shared behaviour
   in it probably belongs in `_shared/`.
5. **Behaviour change, doc, and verify script move in the same commit.**

## Where things live

| Surface | Answers | Dies when |
|---|---|---|
| Code comment | why *this code* is written this way | the code is deleted |
| `content/onboarding/flow-structure.yaml` | structural config and its constraints | the node changes |
| `docs/diary_log/` + `decisions.md` | when we decided, why, what got reversed | never (append-only) |
| **`docs/app/` (here)** | what a screen does now, and its exceptions | the screen is cut |

## Reading these

Written for whoever builds next, including agents working from a cold start. Technical voice;
real identifiers (node ids, memory paths, section names, file paths) over prose descriptions of
them. Assume the reader can open the code but hasn't yet.

The `Verify:` line on each doc names the script that proves its claims. When a doc looks wrong,
run that first — it settles the question faster than reading.

Those browser scripts share `scripts/onboarding-seed/_walk.mjs`. Its `walkTo(page, /heading/)`
answers whatever screen is in front of it until the target appears, so a script names the screen
it cares about and nothing else. Never walk by a fixed sequence of clicks: that couples the script
to the flow's ORDER, and it rots silently — a walk that ends on the wrong screen still runs and
still prints output. The engine-level equivalent in `smoke-test.ts` is `skipUntil(nodeId, ...)`.

**Links into `docs/diary_log/` resolve only in the owner's working copy.** That folder is
personal and gitignored (`.gitignore:44`), while these docs are committed. A dead diary link in
a fresh clone is expected, not a mistake — the decision context simply isn't public. Everything
needed to understand *what the screen does* is here; the diary only adds *why it was chosen*.

## Layout

```
docs/app/
  README.md                  this file
  _shared/                   behaviour spanning several screens
    validator-gate.md        the Onboarding Validator Agent: verdicts, UI contract, failure modes
    options-filter.md        diet intersection vs. allergy/intolerance union; disabled-not-removed
    repeat-for.md            one screen per value: `item`, history entries, the terminal default
  onboarding/                in flow order
    n_welcome.md  n_consent.md  n_biometrics.md  n_goal.md  n_health_condition_note.md
    n_allergies.md  n_intolerances.md
    n_diet_style_cards.md  n_cuisine_broad.md  n_cuisine_narrow.md  n_dishes.md
    n_favorite_recipes.md  n_pairing_cards.md
    exclusion-decks.md       n_protein_/n_carb_/n_fat_exclusion_cards — one doc, they differ only by macro
    n_active_slots.md  n_week_start.md  n_fixed_meals.md  n_summary.md  n_compile.md
    bugs_and_improvements.md   known-but-unfixed, and ideas — the one file about what ISN'T true
```

`bugs_and_improvements.md` is the deliberate exception to rule 1's "current state only": it's a
backlog, so it carries no `Status:`/`Verify:` header (nothing to verify) and `check-app-docs.mjs`
exempts it. A screen's own doc still describes its bugs where they change what the screen does
today — this file is for the ones nobody is acting on yet.

`exclusion-decks.md` is the one file covering more than one node. The three decks differ only in
macro category, content section and write paths, so they share a doc with a table for the
differences rather than three near-identical files.

## Coverage

**Onboarding is complete** — every node in `content/onboarding/flow-structure.yaml` is covered.
`n_allergy_confirm` is documented inside `n_allergies.md` (it's that screen's confirm gate, not a
question of its own), and `n_leftovers` is noted inside `n_active_slots.md` as commented out of
the flow.

The Explore tab and everything outside onboarding are **not** documented yet. Absence of a file
means "not written", never "nothing special here".

Run `node scripts/check-app-docs.mjs` to check these docs mechanically: header blocks, that every
cited script and source path exists, that links and their anchors resolve, and that no history
has crept into a current-state doc. It cannot tell whether a cited `Verify:` script genuinely
exercises the node it's cited under — that still needs reading.
