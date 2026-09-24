# n_week_start — "Which day should your week start on?"

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/DayOrderPicker.tsx` · Config: `content/onboarding/flow-structure.yaml`
Verify: no dedicated script; covered by `scripts/onboarding-seed/smoke-test.ts` scenario A
(`week_start_day` assertion)

`type: day_order_picker`. Single-choice list of the seven days, select-to-continue. Writes the
chosen day to `profile.locale.week_start_day`.

## Behaviour

- **Select-to-continue, not tap-to-submit.** Tapping a day sets local `selected` and highlights
  it; nothing is sent. The Continue button submits `{ day_order_value: selected }`. Consistent
  with the other single-choice screens in the flow.
- **Continue is disabled until a day is picked** (`disabled={selected === undefined}`). There is
  no initial selection, so an untouched screen cannot be submitted.
- **No Skip.** The node is not `optional`, and DayOrderPicker renders no `SkipButton` at all.
- **Options come from a shared content section**, not this node's own row:
  `options_source: { section: "content:days_of_week" }` — Sunday first through Saturday, by
  `id_order`. The `node:n_week_start` row carries only `prompt` and `prompt_instructions`.
- **Only re-selection, no deselection.** `onClick` assigns rather than toggles, so once a day is
  chosen the screen can never return to the no-selection state.
- **Advances to `n_fixed_meals`.**

## Exceptions & gotchas

- **Nothing is reordered.** Despite the type name and the "tap a day to make it first" copy, the
  component renders the days in their content order and records a single value. The list on screen
  does not re-sort, and the write is a scalar, not an ordering. Anything that wants a rotated week
  derives it from `profile.locale.week_start_day` itself.
- **Day keys elsewhere are unaffected.** `cooking_profile.day_constraints` is keyed by plain day
  name (`DAYS_OF_WEEK`) regardless of what is picked here — as the node's own
  `prompt_instructions` says. Don't treat `week_start_day` as an index into that record.
- **`writeNodeAnswer` no-ops on a missing value.** The `day_order_picker` branch writes only when
  `answer.day_order_value !== undefined`, so a submission without it leaves the skeleton `null`
  standing rather than writing `undefined`. The UI can't produce that, but a scripted answer can.

## Depends on

- Content: `node:n_week_start` (`prompt`, `prompt_instructions`) and `content:days_of_week`
  (the option list, shared with `n_fixed_meals.day_of_week`)

## Writes

- `profile.locale.week_start_day` — one of the `DayOfWeek` values (`sunday` … `saturday`)

## Decisions

- Single-choice screens show your pick and wait for Continue —
  [2026-09-18](../../diary_log/2026-09-18.md#onboarding-screens)
