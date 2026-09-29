# Shared — `repeat_for` (one screen per value)

Status: live · Last verified: 2026-09-21
Engine: `lib/onboarding/engine.ts` (`resolveEntry`, `advanceFlow`, `getRepeatForItems`)
Verify: `scripts/onboarding-seed/smoke-test.ts` scenarios A (two `n_cuisine_narrow` /
`n_dishes` iterations answered separately), B (`default_applied` → zero iterations),
K and L (`n_pairing_cards`' sampled sequence)

`repeat_for: <memory path>` expands one node into one screen per value in the array at that
path. Used by `n_cuisine_narrow` (`taste_profile.cuisines`), `n_dishes`
(`taste_profile.sub_cuisines`) and `n_pairing_cards`
(`meal_planning_preferences.pairing_sample`).

## `item`

The current iteration value — always a bare string (a slug like `asian`, `thai`, `falafel`),
never an option object. It reaches everything that needs to vary per screen:

- `renderNode(nodeId, item, memory)` substitutes `{item}` in `prompt` and
  `other_capture.prompt` — **with the raw slug, not a label** (`interpolate()`). No other
  content field is interpolated.
- `resolvers.resolveTemplateRef` resolves `{item}` for `options_source` lookups, so
  `curated_lookup`'s `key: "{item}"` reads that iteration's own option list.
- `validation.payload.context` templates (`parent_cuisine`, `parent_sub_cuisine`) resolve
  against it server-side in `/api/onboarding/validate-other`, which is passed `item` by the
  client.
- `skip_if` is evaluated with `item` in scope, per iteration.

## Iteration

`resolveEntry` with `item === undefined` reads the array and enters at `items[0]`;
`advanceFlow` from `(node, item)` takes `items[indexOf(item) + 1]`, and falls through to the
node's `next` when there is no next value. An empty array means zero screens: the node is
skipped entirely, exactly like `skip_if` firing, and never appears in history.

`getRepeatForItems` re-reads memory on every call, so the sequence is live rather than
snapshotted at entry. No node today writes to its own `repeat_for` path, so this doesn't
currently change any sequence mid-flight.

A per-iteration `skip_if` (`item == 'other'` on `n_cuisine_narrow` / `n_dishes`) advances to the
**next item**, not out of the node.

## History

Each iteration is its own history entry, keyed `{node_id, repeat_key: item}` with its own
`pre_write_snapshot` (`ensureOpenEntry`). Consequences:

- Back pops one iteration at a time and reverts only that iteration's writes; `goBack` returns
  `{nodeId, item: last.repeat_key}`, so it lands on the specific screen — and re-renders it with
  that iteration's own answer ([`back-navigation.md`](back-navigation.md)), which is keyed on
  `repeat_key` too, so one dish's pairings can't surface on another's.
- Zero iterations leave **no** entry at all — "not in history" and "answered with nothing" are
  distinguishable.

## `default_if_empty` is terminal, not cascading

A node that resolves its value from `default_if_empty` satisfies **itself only**. It must not
make a downstream `repeat_for` behave as though the user had really picked that value.

`applyAnswer` tags the history entry `default_applied: true` whenever the default fired (skip,
or a Continue with nothing selected). `getRepeatForItems` calls `wasValueDefaulted`, which walks
history newest-first for the entry whose node's `writes_to` targets include this `repeat_for`
path, and returns **zero items** if that entry is flagged.

So skipping `n_cuisine_broad` writes `taste_profile.cuisines = ["mediterranean"]`, and
`n_cuisine_narrow` and `n_dishes` both run zero iterations — the flow goes straight to
`n_allergies` (smoke-test scenario B).

Ordering matters: `applyAnswer` writes `default_applied` onto the entry **before** calling
`advanceFlow`, because that's what the next node's `wasValueDefaulted` reads. Setting it later
reads a stale flag.

## Gotchas

- `wasValueDefaulted` matches on a node's declared `writes_to`, so a path written by nothing —
  `meal_planning_preferences.pairing_sample`, which `ensureSampleComputed` writes outside the
  answer path — always returns `false`. `n_pairing_cards` is bypassed by an empty sample, never
  by this rule.
- `bypassRemainingIterations` in `advanceFlow` (a whole-node Skip abandoning the rest of a
  sequence) is gated on `structure.optional`. No `repeat_for` node is `optional` today, so the
  branch is currently unreachable — it's kept as a general mechanism, not a live behaviour.
- `{item}` substitution is slug-level. `n_pairing_cards` gets a readable label only because it
  has its own `{dish}` placeholder resolved through `findPairingDish`.
