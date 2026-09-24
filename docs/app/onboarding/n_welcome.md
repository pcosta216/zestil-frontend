# n_welcome — the opening screen

Status: live · Last verified: 2026-09-21
Component: `app/onboarding/_components/SystemScreen.tsx` · Config: `content/onboarding/flow-structure.yaml`
Verify: no dedicated script; covered by `scripts/onboarding-seed/smoke-test.ts` (every scenario
enters here via `entryPoint`; scenario C answers it explicitly before walking on)

`type: system`. A prompt and one button. Writes nothing — it exists to be the flow's
`meta.entry_node` and to give the first `/api/onboarding/answer` call something to answer.

## Behaviour

- **CTA is hardcoded, not content.** `SystemScreen` picks it from the node id: `"Let's start
  planning"` for `n_summary`, `"Get started"` for everything else (i.e. here). Only the prompt
  comes from the DB.
- **No Back button.** `canGoBack(history)` is false while the only history entry is this node's
  own open one, so `showBack` is false. Back appears from `n_consent` onward.
- **Submits `{}`.** The engine's `writeNodeAnswer` returns early for `type: system` — no
  `writes_to`, no `infer`, nothing.
- **Nothing to revert.** `collectWriteTargets` yields an empty set, so this node's
  `pre_write_snapshot` is `{}`. Backing into it from `n_consent` restores nothing; the consent
  write is undone by `n_consent`'s own snapshot, not this one.
- **`next: n_consent`**, unconditional — no `branches`, no `skip_if`, not `optional`.

## Shared component

`SystemScreen` also renders `n_summary` (the other `type: system` node with a screen).
`n_compile` is `type: system` too but never reaches this component: `OnboardingFlow.tsx`
POSTs `/api/onboarding/commit` the moment `node.id === "n_compile"` and shows the done state.

## Exceptions & gotchas

**The 300ms phantom-click window applies here like everywhere else.** `OnboardingFlow.tsx`
ignores any `onAnswer`/`onBack` fired within `PHANTOM_CLICK_WINDOW_MS` of a node mounting. A
scripted test that clicks "Get started" immediately after `/api/onboarding/state` resolves will
be silently dropped — the existing verify scripts all wait ~400-600ms after each transition for
this reason, not for rendering.

## Depends on

- Content: `node:n_welcome` in `tbl_onboarding_content` — `prompt` only, no options, no
  `skip_label` (~60s TTL cache, `lib/onboarding/content.ts`)

## Writes

Nothing.
