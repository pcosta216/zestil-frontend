# n_consent — the data-use notice

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/Consent.tsx` · Config: `content/onboarding/flow-structure.yaml`
Verify: no dedicated script; `scripts/onboarding-seed/smoke-test.ts` walks it in every scenario
but asserts nothing about `profile.consent`. The browser scripts
(`verify-biometrics-validation.mjs`, `verify-diet-styles-validation.mjs`, …) all click through it
by its button label, `"I agree"`.

`type: consent`. A statement of how the data is used and a single accept button. There is no
decline path and no checkbox — one explicit action, no dark patterns.

## Behaviour

- **The button label is hardcoded** (`"I agree"` in `Consent.tsx`). Only the prompt is DB copy.
  Browser scripts match on that literal.
- **The answer's content is ignored.** `Consent.tsx` submits `{}`; `writeNodeAnswer`'s
  `type: consent` branch sets `{ accepted: true, accepted_at: new Date().toISOString() }` on
  `writes_to` regardless of what arrived. `smoke-test.ts` scenario A passes
  `{ values: ["accept"] }` and gets exactly the same write.
- **Not `optional`, so `{ skipped: true }` writes nothing.** `applyAnswer` only calls
  `writeNodeAnswer` when `answer.skipped` is falsy, and the `else if` fallback requires
  `structure.optional`. A skipped submission therefore advances to `n_biometrics` with
  `profile.consent` still at its skeleton default `{ accepted: false, accepted_at: null }`.
  Unreachable from the UI (the component renders no skip button), but reachable from a script.
- **`next: n_biometrics`**, unconditional.

## Exceptions & gotchas

**Backing into this screen un-accepts.** `collectWriteTargets` includes `profile.consent`, so
the entry's `pre_write_snapshot` holds the pre-accept value. Going Back from `n_biometrics`
reverts `profile.consent` to `{ accepted: false, accepted_at: null }`; agreeing again stamps a
fresh `accepted_at`. The timestamp is the moment of the *surviving* acceptance, not the first one.

**Consent is not recorded anywhere outside `tbl_user_memory`.** There is no separate consent
audit table and no signup-time gate — a user who abandons onboarding on this screen has
`accepted: false` in memory and nothing else recorded.

## Depends on

- Content: `node:n_consent` in `tbl_onboarding_content` — `prompt` only

## Writes

- `profile.consent` — `{ accepted: true, accepted_at: <ISO 8601 string> }` (shape fixed in
  `engine.ts`, not configurable from YAML or content)

## Decisions

- Terms and conditions at signup are parked for later — this screen is a data-use notice, not a
  ToS acceptance — [2026-09-10](../../diary_log/2026-09-10.md#accounts)
