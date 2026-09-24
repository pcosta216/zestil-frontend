# n_compile — the terminal commit node

Status: live · Last verified: 2026-09-22
Component: none (never rendered) — `app/onboarding/OnboardingFlow.tsx` auto-commits on arrival ·
Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-summary-screen.mjs` (its last two checks drive a real
commit through the browser); `scripts/onboarding-seed/smoke-test.ts` scenario A walks the engine
through it to terminal, but `commitUserMemory` itself is only reachable via
`POST /api/onboarding/commit`

`type: system`, `next: null` — the flow's `meta.exit_node`. Not user-facing. `OnboardingFlow`'s
effect fires the moment `node.id === "n_compile"`, POSTs `/api/onboarding/commit`, and on success
swaps the whole screen for the "You're all set" panel with a **Go to my plan** button to
`/zestil`.

## Behaviour

What the commit actually does, in `commitUserMemory` (`lib/onboarding/server-memory.ts`), called
by `app/api/onboarding/commit/route.ts` on the freshly loaded draft:

- **`memory.last_updated`** ← today, `YYYY-MM-DD` (`toISOString().slice(0, 10)`)
- **`memory.profile.onboarding_completed_at`** ← the same date string
- **`meal_planning_preferences.pairing_sample` and `.pairing_sample_source` are stripped** —
  `n_pairing_cards`' internal `sample_from` bookkeeping, not part of the profile schema
- **`flow_position` ← `[]`** in the same `tbl_user_memory` update — the session is done, there is
  nothing left to resume
- The updated `memory_json` is returned to the client as `{ done: true, memory }`

Everything else was already autosaved incrementally by `/api/onboarding/answer` after each node.
This pass changes no answer data.

## Exceptions & gotchas

- **Both timestamps are dates, not timestamps.** `onboarding_completed_at` and `last_updated`
  are ten-character `YYYY-MM-DD` strings. Don't parse them as ISO datetimes.
- **The declared `tool_calls` do not run.** `resolve_recipe_uuid`, `create_recipe_stub`,
  `queue_recipe_for_catalog_review` and `commit_user_memory` are listed on the node, but
  `tool_calls` is only a field on `FlowNodeStructure` (`lib/onboarding/types.ts:306`) — nothing
  reads it. Only the fourth has an implementation, and the route calls it directly. Every
  `recipe_uuid` written during the flow (favourite recipes, pairings, fixed meals) stays `null`;
  resolution is deferred to the onboarding agent, which doesn't exist yet.
- **No schema validation happens**, despite the content row saying so.
- **Double-fire is guarded by caching the POST's promise**, not by an in-flight ref. The ref shape
  strands the user under React StrictMode's dev double-invoke: the first invocation fires the
  request and is cancelled by its own cleanup, the second bails on the ref, and the 200 is
  discarded by both — the profile commits server-side while the screen never advances. Both
  invocations subscribe to one cached promise instead. Same shape and same reason as
  [`n_summary.md`](n_summary.md)'s fetch.
- **The node is never rendered.** `OnboardingFlow` short-circuits on `node.id === "n_compile"` to a
  plain "Saving your profile…" panel. Routing it through `COMPONENT_BY_TYPE` would flash the
  content row — which is an authoring note, not user copy — and put a live CTA on screen
  mid-commit.
- **A failed commit strands the user on an error banner.** There is no retry: the effect's
  dependency is `[node]`, which hasn't changed, and the cached promise is already settled, so it
  does not re-run. Reloading `/onboarding` resumes at `n_compile` (its history entry is still
  open) and retries.

## Depends on

- `loadUserMemory(user.id)` — the row must already exist (seeded by the signup trigger)
- An authenticated session; the route 401s without one

## Writes

- `tbl_user_memory.memory_json` — `last_updated`, `profile.onboarding_completed_at`, minus the
  two `pairing_sample*` fields
- `tbl_user_memory.flow_position` — `[]`
