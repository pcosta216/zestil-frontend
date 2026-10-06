# Recipe-discovery progress — the last onboarding screen

Status: live · Last verified: 2026-10-06
Component: `app/onboarding/_components/DiscoveryProgress.tsx` · Route:
`app/api/onboarding/discovery/route.ts`
Verify: `scripts/onboarding-seed/verify-discovery-progress.mjs` (drives a whole scripted run —
nothing reported → part-done → complete → auto-continue, against `doe@gmail.com`, whose own
`memory_json.onboarding` the fixture shapes are copied from)

Not a flow node. It replaces the `done` state in `OnboardingFlow.tsx` — the old "You're all set"
panel — so it sits after [`n_compile`](./n_compile.md) has committed, at the position that panel
held. It exists because **"Go to my plan" was a trap**: recipe discovery is still running at that
point, so the button handed the user an empty plan.

Everything here is a READ. `memory_json.onboarding` is written solely by the backend discovery
job; nothing in this repo creates or updates it.

## Behaviour

- **Polls `GET /api/onboarding/discovery` every 10s**, one interval, cleared on unmount and the
  moment the run finishes. The route selects the `memory_json->onboarding` sub-path, not the
  whole blob — a run is polled for minutes and the committed profile is far larger than the
  progress block inside it. An in-flight guard stops a slow response stacking requests behind it.
- **`Continue to plan` is gated on `onboarding.status.current`** reaching
  `recipe_discovery_complete` (or `recipe_discovery_failed`, which also stops the wait — the
  profile is already saved and the user should not be held by someone else's failure).
- **`status` is an append-only log, not a value.** The newest entry wins, chosen by sorting on
  `time` rather than trusting array order.
- **Auto-continues 15s after completion**, not 15s after mount — the countdown is 15s of the
  finished screen, not of a run that takes minutes. A click cancels it; the navigation is
  one-shot, so neither path can fire twice.
- **Each `recipe_discovery` entry is a REQUEST, and its `recipes` are what matched it.** The row
  reads as a header — name, `N found · N saved` — with the saved dishes listed beneath it.
  Absent fields are simply not rendered: mid-run an entry has only `name` and `status`, and some
  finished ones never report `saved`/`recipes` at all.
- **The marks sit at two different levels, and that is the point.** A request carries its own
  state on the left; a *recipe* carries a trailing green tick meaning "found and saved".

| Where | State | Mark |
|---|---|---|
| request (leading) | `failed` | red cross, plus the entry's own `error` string |
| request (leading) | `in progress` | spinner |
| request (leading) | `waiting`, or anything unrecognised | hollow dot |
| request (leading) | `complete` | **nothing** — see below |
| recipe (trailing) | `saved: true` | green check |

**A completed request gets no mark of its own.** What it produced is the list beneath it, and
each of those carries a tick. Ticking both would say "done" twice, and would make a request that
completed having saved nothing look identical to one that found two dishes — so that case gets
an explicit "No matches saved for this one" line instead. The empty icon slot is still rendered,
so every request name starts at the same x.

## Exceptions & gotchas

**Only `complete` and `failed` have been observed live.** `in progress` and `waiting` come from
the spec, unverified. `requestState` therefore normalises case and strips
spaces/underscores/hyphens before matching rather than trusting the exact strings. Anything it
does not recognise reads as *waiting* — the neutral state, never a false green tick.

**A run completes overall while individual requests fail**, and a failed one carries its own
`error` (`"Explore failed: The operation was aborted due to timeout"`). That string is rendered
verbatim — it says more than any copy written here could. The gate keys off the overall status
only, so the button opens and the failed rows stay red.

**A run takes 3–7 minutes, not the ~1:30 estimated.** Measured over three real runs
(`recipe_discovery_run` → the `recipe_discovery_complete` entry's `time`): 2m58s, 3m28s, 7m07s.
The copy says "a few minutes" for that reason, and the 10s poll means ~42 requests on a long run.

**The stall escape is an addition, not in the spec.** The gate depends on a status written by a
job this app neither starts nor monitors, so without it a job that dies leaves the user on a
dead-end screen at the very end of onboarding with the profile already committed. A quiet
"Continue without waiting" appears after **18 consecutive polls that told us nothing new**
(3 minutes). It keys on *silence*, not on emptiness: a job that writes two requests and then
dies strands the user exactly as thoroughly as one that never starts, and a 401 or a 500ing
route strands them without writing anything at all — so a failed poll counts as silence too.
The comparison is against the whole block, since a run grinding through one request updates its
counts without the list growing. Any change resets the counter, so the escape disappears again
if the job recovers.

**3 minutes is measured, not guessed.** The longest gap between two writes inside a healthy run
is 92s (three runs, 20 writes), so the threshold is ~2x the worst legitimate silence. Too low
and a slow request offers an escape into the empty plan this screen exists to prevent.

**A committed profile with an empty `flow_position` is a finished session, not a new one.**
`commitUserMemory` clears the stack, so without an explicit check in `resolveResumeTarget` a
reload of `/onboarding` after completion is indistinguishable from a first visit: `entryPoint`
reopens `n_welcome` (a plain `system` node — `checkSkip` has no "already answered" rule) and the
state route *persists* that fresh entry, durably parking the user at the start of the flow with
blank forms. This screen is what made that reachable in practice — it asks the user to wait
minutes, so a mid-wait refresh is ordinary. `resolveResumeTarget` now returns terminal for any
account carrying `profile.onboarding_completed_at`, which lands them back here. An open entry
still wins, so a genuine mid-flow resume is untouched. Smoke-test scenario X.

**`memory_json` is written as one blob.** `commitUserMemory` overwrites the whole column from the
draft it loaded, so anything the discovery job writes into `onboarding` between that load and
that write is lost. The window is one read plus one write, and in practice discovery has not been
seen to start before the commit — but the two writers share a column with no merge on either side.

## Depends on

- `tbl_user_memory.memory_json.onboarding` — `{ status[], recipe_discovery[], recipe_discovery_run }`,
  written by the backend discovery job
- `app/onboarding/OnboardingFlow.tsx` — renders this in place of `done`

## Writes

Nothing. The only side effect is `router.replace("/zestil")`.
