# Shared — going back to an already-answered screen

Status: live · Last verified: 2026-09-24
Verify: `scripts/onboarding-seed/verify-back-recalls-answers.mjs` (both doors, in the browser),
`scripts/onboarding-seed/verify-allergy-edit-loop.mjs` (correcting an answer replaces it),
engine-side, `scripts/onboarding-seed/smoke-test.ts` scenarios C, F, G, O, T, V

Two things put a person back on a screen they already answered:

- **the Back button** — `POST /api/onboarding/back` → `goBack` in `lib/onboarding/engine.ts`;
- **`n_allergy_confirm`'s "Something's missing or wrong"** — a `confirm_edit` answer of `edit`,
  which rewinds *into* the node being corrected instead of branching forward to it
  (`revertAndTruncateFrom`). See [`../onboarding/n_allergies.md`](../onboarding/n_allergies.md).

Both revert the node's writes on the way in, and both re-render it with the answer still on it.

## Revert, then recall

`goBack` pops the trailing open entry (the screen on display, never answered — nothing to undo),
pops the entry before it, and restores that entry's `pre_write_snapshot`. `confirm_edit`'s rewind
does the same from the target node's entry forward. Reverting is what makes a correction a
*replacement*: without it, re-answering appends, and the value someone came back specifically to
remove survives.

So by the time the screen renders, memory no longer holds the answer — which is why the answer is
recorded separately, on the history entry itself (`HistoryEntry.answer`):

```
applyAnswer  → entry.answer = the submitted Answer   (unless skipped / default_if_empty)
goBack       → re-opens the target's entry, carrying that answer forward
routes       → recalledAnswer(history, target) → response.previousAnswer
OnboardingFlow → <Component previousAnswer={...}> → the screen's initial state
```

It cannot be re-derived from memory. `n_goal` writes a macro *order* looked up from the pick, not
the pick; the [exclusion decks](../onboarding/exclusion-decks.md) write the complement of what was
tapped; free-text entries land as bare strings among curated ones with nothing marking which were
typed. The answer is the only faithful record of what the screen looked like.

**Skips and `default_if_empty` writes record nothing.** Echoing an empty answer back would open an
opt-out deck with everything *deselected* — the opposite of what skipping it meant. With no
recorded answer the screen falls back to its own default state, which is the correct one.

## What each screen restores

| Screen | Restored from | Notes |
|---|---|---|
| `single_select`, `multi_select` | `values` | filtered to options still on screen and still selectable |
| `multi_select` "Other" | `other_entries` | listed under the field as removable rows — see below |
| `pairing_cards` | `values` + `left_values` | both checked groups |
| `biometrics_form` | `fields` | numbers back to strings; `submit()` re-converts |
| `free_text` | `text` | |
| `free_text_search` | `recipe_picks` | the staged chips, already removable |
| `day_meal_picker` | `day_meal_entries` | the added meals; the composer itself starts empty |
| `day_order_picker` | `day_order_value` | |

## Exceptions & gotchas

**Recalled "Other" entries are rows, not text in the box.** The input holds *unvalidated* input;
a recalled entry has already been through [the validator gate](validator-gate.md) and may carry
the agent's own renaming (typed "pumpkin", listed as "Pumpkin" — the label is what renders).
Re-seeding the box would send it through validation a second time and could re-open a review the
user already settled. Removing a row is the only way to take one back, which is the point: a
typed-in allergy was otherwise impossible to remove without restarting the flow.

**Entries recalled this way count as content.** `require_selection` and the exclusion decks'
`needsAlternative` gate both treat them exactly like freshly typed text (`otherHasContent` in
`MultiSelect.tsx`) — otherwise backing into a screen answered *only* by free text would find
Continue disabled with the answer visibly on screen.

**A recalled value that can't be rendered is dropped.** Only options still present and still
selectable are re-selected: anything else would sit invisibly in the selection set and be
resubmitted with no way to see or remove it.

**Re-answering replaces the recalled answer, never merges with it.** `applyAnswer` assigns
`entry.answer` on every path rather than spreading the old one, so a removed entry stays removed
on the next visit too.

**Back leaves history with an open entry.** `goBack` re-opens the target's own entry (with a
fresh snapshot of the now-reverted memory) instead of leaving nothing open. That keeps the
"history always ends with an open entry for what's on screen" invariant the `/answer` route's
stale-node check and `resolveResumeTarget` both rely on — and it's where the recalled answer
lives, so reloading the page right after Back still shows it.

**`confirm_edit` screens are not stops on the back stack.** Backing out of a node that sits
behind one (`n_intolerances` → `n_allergies`) skips the gate rather than landing on the same
recap again. The rewind also attaches nothing if the target node auto-skips and the flow lands
elsewhere — one node's answer must never pre-select another node's screen.

**A templated write path is never snapshotted.** `n_fixed_meals` writes
`cooking_profile.day_constraints.{day_of_week}.fixed_meals`; `collectWriteTargets` expands it per
day and drops anything still holding a `{placeholder}`. Revert `setPath`s every key it finds and
`setPath` creates missing parents, so a raw templated path would materialise a literal
`{day_of_week}` sibling of the real days. Scenario T.

## Depends on

- `tbl_user_memory.flow_position` — the history stack, `HistoryEntry[]`
- `lib/onboarding/engine.ts` — `goBack`, `revertAndTruncateFrom`, `ensureOpenEntry`, `recalledAnswer`
- `app/onboarding/OnboardingFlow.tsx` — holds `previousAnswer` and passes it to the node screen
- `app/onboarding/_components/shared.tsx` — `NodeScreenProps.previousAnswer`
