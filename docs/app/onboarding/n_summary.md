# n_summary — the recap screen before commit

Status: live · Last verified: 2026-09-22
Component: `app/onboarding/_components/SummaryScreen.tsx` · Route: `app/api/onboarding/summary/route.ts` ·
Config: `content/onboarding/flow-structure.yaml`
Verify: `scripts/onboarding-seed/verify-summary-screen.mjs` (failure state, retry, rendered
markdown, commit); `scripts/onboarding-seed/smoke-test.ts` scenario A walks the engine through it

`type: summary`. The last user-facing screen. Its body is a markdown document generated per user
by the **Onboarding Summary Agent**, fetched on mount; the CTA **"Let's start planning"** submits
an empty answer and advances to `n_compile`.

## Behaviour

- **Writes nothing.** No `writes_to`. `writeNodeAnswer` returns early for `type: summary` (shared
  with `system` and `confirm_edit`), so the answer only closes the history entry and advances.
- **The body is fetched, not content.** `SummaryScreen` POSTs `/api/onboarding/summary` on mount
  and renders `summary_markdown` through `react-markdown` + `remark-breaks`, styled by the shared
  `.chat-markdown` rules in `app/globals.css`. The agent decides which sections appear.
- **The node's `prompt` is not rendered.** The returned document brings its own `## ` headings;
  the screen's own heading ("Here's what we've got") is component copy.
- **Continue is never gated on the summary.** It is live while the document is loading and after a
  failure — this is the last screen before the profile commits, so a failing recap must not be
  able to strand anyone one tap from finishing.
- **One generation per attempt.** The fetch promise is cached in a ref keyed by attempt number, so
  React StrictMode's dev double-invoke subscribes twice to a single request. A plain in-flight ref
  does *not* work here: the first invocation's result is discarded by its own cleanup and the
  second bails on the ref, leaving the screen on its skeleton forever.
- **Failure offers a retry** — "Try again" bumps the attempt counter, which starts exactly one new
  request.
- **Back is available** like any other node; `showBack` comes from the state route's `canBack`.

## The endpoint

```
POST /api/onboarding/summary            (no body)
  → POST ${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-summary-agent
    Authorization: Bearer <the user's session access_token>
    { "user_id": "<uuid>" }             ← the entire payload
  → { "summary_markdown": "## Diet & Eating Style\n\n- ..." }
```

Both halves of the auth come from the same verified session: the function checks the bearer token
past the gateway's `verify_jwt` and 403s if its subject doesn't match the posted `user_id`, so the
UUID is never client-supplied. See [`../_shared/validator-gate.md`](../_shared/validator-gate.md)
for the same posture on the validator agent.

Upstream statuses (400 bad body, 401 no/invalid token, 403 subject mismatch, 404 no
`tbl_user_memory` row, 500 server-side) all collapse to one `502` and one message: the user can act
on none of them. The distinction is kept in the route's `console.error`, which is where it helps.

`TIMEOUT_MS = 30000` in the route — an unstreamed LLM call, sized like the validator's measured
20s with headroom for a longer document.

## Exceptions & gotchas

- **The live function currently 500s on its happy path**, returning plain `Internal Server Error`
  rather than the documented `{ "error": ... }` — an uncaught throw, not its own 500 branch. Its
  400/401/403 branches answer correctly, and no row reaches `tbl_agent_debug_log`, so it fails
  before it logs. The screen degrades exactly as designed (failure copy, retry, live CTA);
  nothing on this side needs to change when it's fixed.
- **`node:n_summary`'s content row is unused.** Its `prompt` holds an authoring instruction
  ("Render a short human-readable recap of everything captured…") and is no longer read by
  anything. Deleting or repurposing the row is a content change, not a code one.
- **An empty profile still returns prose.** The agent substitutes "We don't have enough from your
  onboarding yet to summarize." rather than an empty string, so there is no empty-document state
  to design for.

## Depends on

- The `onboarding-summary-agent` Edge Function, and an authenticated session for its bearer token
- Nothing from `memory` client-side — the agent reads `tbl_user_memory` itself
