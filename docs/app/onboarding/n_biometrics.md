# n_biometrics — units, gender, and three optional measurements

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/BiometricsForm.tsx` · Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-biometrics-validation.mjs` (form side: no skip button,
Continue gating, per-unit range messages, write-through), `scripts/onboarding-seed/smoke-test.ts`
scenario P (write side: bounds enforced in `applyAnswer`, bad fields dropped individually)

`type: biometrics_form`. Five fields rendered from `structure.fields`, labelled and optioned from
the `node:n_biometrics` content row's `fields.<name>` sub-object.

| Field | Type | Required | Bounds |
|---|---|---|---|
| `units` | `single_select` | **yes** | `metric` / `imperial` |
| `gender` | `single_select` | **yes** | `female` / `male` / `prefer_not_to_say` |
| `age` | `number` | no | 18–120 (fixed `min`/`max`) |
| `height` | `number` | no | `range_by_unit`: 60–270 cm / 24–106 in |
| `weight` | `number` | no | `range_by_unit`: 25–350 kg / 55–772 lb |

## Behaviour

- **No skip button.** The node dropped `optional: true` when units and gender became required.
  `BiometricsForm` gates its `SkipButton` on `node.optional` like every other component, so
  nothing renders. Demanding `gender` is safe only because "Prefer not to say" is an option — it
  never forces an actual disclosure.
- **Required fields get a `*`** — rendered from `!field.optional`, so the asterisks follow the
  YAML, not a hardcoded list.
- **Continue is disabled whenever `validateBiometrics` returns any issue**, from first render
  onward. Error text is a different matter: `required` issues stay hidden until `touched`
  (any field interacted with), so the screen doesn't open pre-scolded; `out_of_range` issues
  show as soon as a bad number is typed.
- **Range messages follow the selected unit system live.** Switching `units` from metric to
  imperial re-resolves `range_by_unit` and rewrites the inline message
  ("between 60 and 270 cm" → "between 24 and 106 in") without clearing the typed value.
- **Blank optional fields are dropped before submit.** `BiometricsForm.submit` skips falsy
  strings and coerces `age`/`height`/`weight` with `Number()`, sending `{ fields }`.
- **The same rules run again on the write.** `lib/onboarding/biometrics-validation.ts` is
  deliberately dependency-free so `engine.ts` can import it. `writeNodeAnswer`'s
  `biometrics_form` branch builds a set of failing field names and **skips** those fields —
  no throw, no partial rejection of the submission. Valid fields in the same payload still land;
  invalid ones keep the skeleton's `null`.
- **`next: n_goal`**, unconditional.

## Exceptions & gotchas

**Bounds can't catch a wrong-unit value that lands in range.** `69` typed as a metric height is
69 cm — implausible, but inside 60–270, so nothing rejects it. Known and accepted, pinned by an
explicit `smoke-test.ts` scenario-P assertion ("documented not fixed"). Don't treat
`profile.biometrics.height` as unit-sane, only as in-range for the recorded `units`.

**Range checks silently no-op when `units` is missing or unrecognised.** `boundsFor` returns
`undefined` if `units` isn't a string, and `range_by_unit[units]` is `undefined` for any value
outside `metric`/`imperial` — `validateBiometrics` then skips the check entirely rather than
failing. Verified locally: `{ height: 900 }` with no units yields issues for `units` and
`gender` only, and `{ units: "furlongs", gender: "male", height: 900 }` yields **no issues at
all**. The form can't reach either state (Continue is disabled until `units` is picked from the
two rendered options), but the engine's second gate does not close it — a hand-rolled client can
write an arbitrary `units` string plus an unbounded height/weight. Neither `units` nor `gender`
is checked against its option list on the write path.

**`{ skipped: true }` is a silent no-op that still advances.** The node is no longer `optional`
and has no `default_if_empty`, so `applyAnswer` writes nothing and moves to `n_goal`.
`smoke-test.ts` still sends `n_biometrics: { skipped: true }` in most scenarios — those walks
reach later nodes with an empty `profile.biometrics`, which is the intended shortcut, not a bug.

**`BiometricsForm.tsx`'s header comment (lines 13–17) is stale.** It describes a whole-section
skip, per-field skips, and an engine that "just writes whatever fields arrive" — all three
contradicted by the code below it (lines 27–28, 87–89) and by `engine.ts`. Trust the code.

## Depends on

- Content: `node:n_biometrics` — `prompt` plus `fields.<name>.label` and, for `units`/`gender`,
  `fields.<name>.options` (sorted by `id_order` in `render-node.ts`)
- Bounds live in `content/onboarding/flow-structure.yaml`, not in code, so they're tunable
  without a deploy — but they are deploy-time config, not admin-editable content

## Writes

`writes_to` is a per-field map, and `units` does **not** live under `biometrics`:

- `units` → `profile.locale.units`
- `gender` → `profile.biometrics.gender`
- `age` → `profile.biometrics.age`
- `height` → `profile.biometrics.height`
- `weight` → `profile.biometrics.weight`

All five are plain `setPath` scalars — re-answering replaces rather than appends.

## Decisions

- Units and gender required, so the screen can no longer be skipped —
  [2026-09-19](../../diary_log/2026-09-19.md#biometrics)
- Age 18–120 (the cap exists to catch birth years) —
  [2026-09-19](../../diary_log/2026-09-19.md#biometrics)
- Height 60–270cm, weight 25–350kg, with imperial equivalents —
  [2026-09-19](../../diary_log/2026-09-19.md#biometrics)
- The same limits run on the server, not just in the browser —
  [2026-09-19](../../diary_log/2026-09-19.md#biometrics)
