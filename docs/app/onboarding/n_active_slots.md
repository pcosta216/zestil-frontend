# n_active_slots — "Which meals do you want us to plan for?"

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/MultiSelect.tsx` · Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-active-slots.mjs` (preselection, all-unticked Continue,
written value, next screen), `scripts/onboarding-seed/smoke-test.ts` scenario A (forced `snack`,
`plan_snacks`)

`type: multi_select`, opt-OUT framing. Three tiles from `node:n_active_slots` — Breakfast, Lunch,
Dinner — all selected on mount. `snack` is force-added to the write regardless of what's on screen
and is never a tile.

## Behaviour

- **`select_all_by_default: true`.** MultiSelect's lazy `useState` seeds `selected` with every
  non-`disabled` option, so an untouched screen submits all three. This node declares no
  `options_filter`, so nothing is ever `disabled` here and "all selectable" is always all three.
- **No `require_selection`, no `optional`.** Continue is always enabled and there is no Skip
  button. Unticking all three is a legal submission — it writes `["snack"]` and nothing else.
- **`always_include: [{ value: snack, label: "Snacks" }]`.** `applyAnswer` appends it via
  `appendUnique` *after* the normal `writes_to` write, unconditionally, and independently of the
  rendered options. `snack` is singular to match the `meal_slot` enum used by
  `slot_kcal_budgets` and `cooking_profile.day_constraints.<day>.fixed_meals`.
- **`infer` sets `meal_planning_preferences.plan_snacks: true`** on every answer, also
  unconditionally — there is no path through this node that leaves it `false`.
- **No `exclusive_value`, no per-option `allows`.** The tiles are independent; `toggle` and
  `isDisabled` reduce to plain on/off here.
- **Advances to `n_week_start`.**

## Exceptions & gotchas

- **`other_capture` is not declared on this node** — not in `flow-structure.yaml` and not in the
  `node:n_active_slots` content row. MultiSelect's `needsAlternative` is gated on
  `Boolean(node.select_all_by_default) && Boolean(node.other_capture) && …`, and the
  `other_capture` half is exactly what keeps this node out of that state. Without the gate, the
  select-all-by-default half alone would be satisfied the moment a user unticks all three tiles,
  and `continueDisabled` would flip to `true` with no text field on screen to satisfy it — a dead
  end reachable in three taps. Consequence: the forced-open "Other" state is unreachable here, and
  `otherActive` is permanently `false`, so the free-text box and the validator review block never
  render. Do not add `other_capture` to this node without also giving it an Other tile.
- **Values are not re-checked against the rendered options.** `writeNodeAnswer`'s scalar
  `writes_to` branch (the one this node takes) writes `answer.values` as submitted. The
  option-filtering defence lives only in the object-form `{excluded, allowed}` branch used by the
  exclusion decks, so a stale or hand-rolled client can land an unknown slot string in
  `active_slots`.
- **`plan_snacks` and `active_slots` can disagree in intent but never in content** — `snack` is
  always in the array and `plan_snacks` is always `true`, so neither is a meaningful signal about
  what the user actually chose.

## Not in the flow — n_leftovers

`n_leftovers` is **commented out** in `flow-structure.yaml` (the block directly under this node)
and `n_active_slots.next` points straight at `n_week_start`. It is unreached rather than deleted:
its `node:n_leftovers` content row and structure block are left in place so re-enabling it is
uncommenting the block and repointing `next`. While it's off,
`meal_planning_preferences.variety_rules.leftover_friendly` stays at its skeleton default of
`null` — "not asked", **not** `false`. Asserted by smoke-test scenario A. There is no doc for it.

## Depends on

- Content: `node:n_active_slots` (`tbl_onboarding_content`) — `prompt` plus the three options
- Nothing upstream: no `options_filter`, no `skip_if`, no curated lookup

## Writes

- `meal_planning_preferences.active_slots` — selected values, then `snack` appended
  (`["breakfast","lunch","dinner","snack"]` for an untouched screen)
- `meal_planning_preferences.plan_snacks` — `true`, via `infer`

## Downstream

`n_fixed_meals`' `meal_slot` field reads this node back:
`options_source: { from_node_options: n_active_slots }` resolves (see `lib/onboarding/resolvers.ts`)
to this node's content options **plus** its `always_include` entries, filtered to whatever
persisted in `active_slots`. "Snacks" therefore always appears as a choosable meal slot there.

## Decisions

- All meal slots start selected — [2026-09-19](../../diary_log/2026-09-19.md#onboarding-screens)
- Leftovers switched off reversibly; its field means "not asked" —
  [2026-09-19](../../diary_log/2026-09-19.md#onboarding-screens)
