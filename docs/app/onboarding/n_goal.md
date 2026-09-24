# n_goal — "What are you mainly optimizing for right now?"

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/SingleSelect.tsx` · Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/smoke-test.ts` scenario A (`lose_weight_lean_out` →
`macro_priority` `protein,fat,carbs`, `goals_source` `user_input`) and scenario C (Back reverts
both writes). `scripts/onboarding-seed/verify-diet-styles-validation.mjs` drives the screen as
select-to-continue on its way past, but asserts nothing here.

`type: single_select`. Tap an option to highlight it, then Continue to submit — the option tap
never advances on its own, and the selection stays visible until it does.

## Behaviour

- **Select-to-continue.** `SingleSelect` holds the pick in local state; Continue is disabled
  while state is the `NONE` sentinel. (The sentinel rather than `undefined` exists for
  `n_leftovers`, whose option values are native booleans — currently a disabled node.)
- **The submitted value is not the written value.** `writeNodeAnswer` special-cases
  `structure.id === "n_goal"`: the picked slug is looked up in `structure.lookup` and the
  resulting three-macro ordering is written to `meal_planning_preferences.macro_priority`.

  | Picked | `macro_priority` |
  |---|---|
  | `build_muscle_strength` | `[protein, carbs, fat]` |
  | `endurance_training_energy` | `[carbs, protein, fat]` |
  | `lose_weight_lean_out` | `[protein, fat, carbs]` |
  | `eat_healthier_balanced` | `[carbs, protein, fat]` |

- **`optional: true` with `default_if_empty: eat_healthier_balanced`**, so `SingleSelect` does
  render a `SkipButton`. The content row carries no `skip_label`, so it reads "Skip".
- **`infer` runs on every path**, including Skip: `meal_planning_preferences.goals_source` is set
  to the literal `"user_input"` — the only source implemented today.
- **Branch:** `answer == 'manage_a_health_condition'` → `n_health_condition_note`. The branch
  reads `answer.values[0]` (via `rawAnswerForBranches`), so a Skip takes the default
  `next: n_allergies`.
- **`default_applied` is tagged on the history entry** when the write came from
  `default_if_empty`. It is inert here — the flag only matters for `repeat_for` targets, and
  `macro_priority` is not one.

## Exceptions & gotchas

**Skip writes the wrong shape.** Verified by running `applyAnswer` directly:

```
{ values: ["build_muscle_strength"] } → macro_priority ["protein","carbs","fat"]
{ values: [] }                        → macro_priority ["carbs","protein","fat"]
{ skipped: true }                     → macro_priority ["eat_healthier_balanced"]   ← wrong
```

An empty-values submission goes through the `n_goal` special case, which resolves
`default_if_empty` through `lookup` correctly. A **skipped** submission never reaches
`writeNodeAnswer` at all — `applyAnswer`'s `else if (structure.optional && default_if_empty)`
branch calls `applyDefaultIfEmpty`, which sees a string default against an array target and
`appendUnique`s the raw slug. The result is `["eat_healthier_balanced"]` where a three-macro
ordering belongs. `applyDefaultIfEmpty`'s own comment ("no current node does this, since
`n_goal`'s single_select-with-default is special-cased above and never reaches here") holds only
for the non-skipped path. The Skip button is live on this screen, so this is reachable from the
UI. No scenario asserts `macro_priority` after a skipped `n_goal`, which is why it stands.

**`manage_a_health_condition` has no `lookup` row.** Picking it branches correctly to
`n_health_condition_note` but leaves `macro_priority` at its skeleton `[]` — `macroOrder` is
`undefined`, so nothing is written. Downstream readers must treat an empty `macro_priority` as
"no macro opinion recorded", not as a missing answer.

**That option is missing from the live content row.** See
[`n_health_condition_note.md`](n_health_condition_note.md) — the branch is currently unreachable
through the UI.

## Depends on

- Content: `node:n_goal` — `prompt` plus four options (`build_muscle_strength`,
  `endurance_training_energy`, `lose_weight_lean_out`, `eat_healthier_balanced`), sorted by
  `id_order`. No `prompt_instructions`, no `skip_label`.
- `structure.lookup` in `flow-structure.yaml` — the option→macro-order table. A content-side
  option with no `lookup` key writes nothing.

## Writes

- `meal_planning_preferences.macro_priority` — the three-macro ordering from `lookup`
  (`setPath`, so re-answering replaces)
- `meal_planning_preferences.goals_source` — literal `"user_input"`, via `infer`

Both are in this node's `pre_write_snapshot`, so Back from `n_allergies` restores
`[]` / `null`.

## Decisions

- Single-choice screens show your pick and wait for Continue (goal, leftovers, week start) —
  [2026-09-18](../../diary_log/2026-09-18.md#onboarding-screens)
