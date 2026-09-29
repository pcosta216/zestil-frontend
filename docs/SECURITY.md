# Security findings

A tracked log of security-shaped findings from building this app — access control, authentication,
data exposure, and secrets handling. Separate from `docs/app/onboarding/bugs_and_improvements.md`,
which is UX and correctness issues with no urgency attached; a finding here needs a real triage
decision, not just a "someday" label.

This file is committed to the repo. **Don't add exploit details, working payloads, or anything
that turns a finding into a how-to** — describe what's wrong and where, not how to abuse it.

## Columns

- **Day found** — when it surfaced. Longer story, if there is one, is in `docs/diary_log/` (gitignored,
  so the link only resolves in the owner's own working copy — expected, not broken).
- **Severity** — plain terms, not a formal score: **High** (real user data or another user's account
  reachable), **Medium** (a real gap, but needs another condition to matter), **Low** (best-practice
  gap, limited real-world impact today).
- **Where** — the file or component it lives in.
- **Status** — **Open** (not addressed), **Fixed** (resolved, dated), **Mitigated** (a real gap still
  exists, but something else reduces the risk — say what), **Accepted risk** (a deliberate call to
  leave it, with the reason).

## Findings

| Day found | Severity | Finding | Where | Status |
|---|---|---|---|---|
| [2026-09-21](diary_log/2026-09-21.md#cuisine-questions) | Medium | `tbl_cuisines_onboarding` had row-level security enabled with no `SELECT` policy for signed-in users — returned an empty result rather than an error, so the gap showed up as a broken screen, not a visible failure | `supabase/migrations/20260921_cuisines_onboarding_read_policy.sql` | **Fixed** 2026-09-21 — read-only `select` policy for `authenticated`, same shape as `tbl_onboarding_content`'s policy |
| 2026-09-22 | Medium | The external recipe-preparation backend authenticates a request by a shared secret plus a self-asserted user ID, with no independent proof the caller is who it claims — unlike the in-house Edge Functions, which verify a real session token | `app/api/recipe/submit/route.ts` (`X-API-Key` / `X-User-Id` headers) | **Open** — no decision made either way |
| 2026-09-10 | Low | Signup tells the visitor when an email is already registered, rather than Supabase's default of a same-looking response either way — a deliberate choice, trades a small privacy exposure (email enumeration) for clearer UX | `app/(auth)/signup/SignupForm.tsx` | **Accepted risk** — chosen deliberately for now; revisit before this matters at real scale |
| 2026-09-17 (pattern; first noted this day) | Low | Ad-hoc admin scripts under `scripts/onboarding-seed/` use the Supabase service-role key directly for one-off content pushes and test-account resets — the key itself has full database access, independent of any one script | `scripts/onboarding-seed/*.mjs` | **Mitigated** — every write needs the owner's explicit go-ahead first (standing rule), but the key's reach itself is unchanged |

## Backlog

Not yet triaged — found in passing, not from a dedicated security pass:

- Whether other tables besides `tbl_cuisines_onboarding` are missing a `SELECT` policy for `authenticated` hasn't been checked directly; the one found so far was found by accident (a broken screen), not by looking.
