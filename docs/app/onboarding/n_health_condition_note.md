# n_health_condition_note — free-text note about a tracked condition

Status: implemented; **currently unreachable** (see below) · Last verified: 2026-09-21
Component: `app/onboarding/_components/FreeText.tsx` · Config: `content/onboarding/flow-structure.yaml`
Verify: **no script exercises this node** — not `scripts/onboarding-seed/smoke-test.ts`, not any
`verify-*`/`repro-*` script. Nothing in `scripts/` references `n_health_condition_note` or
`dietary.health_condition_notes`.

`type: free_text`. A four-row textarea and a Continue button — the only `free_text` node in the
flow. Reached conditionally from `n_goal`.

## Reachability

`n_goal` declares the branch `when: "answer == 'manage_a_health_condition'"`. That option value
exists in `content/onboarding/node_copy.yaml` and in the seed migration
`supabase/migrations/20260915_onboarding_flow_position_and_content.sql` (`id_order` 50), **but
not in the live `node:n_goal` row in `tbl_onboarding_content`**, which carries four options
ending at `eat_healthier_balanced`. Content is read from the DB at runtime; `node_copy.yaml` is
only a seed source, never merged in by `render-node.ts`. So no rendered option can satisfy the
branch and this screen cannot be reached through the UI as things stand.

The branch itself works — driving `applyAnswer` on `n_goal` with
`{ values: ["manage_a_health_condition"] }` returns `next: { nodeId: "n_health_condition_note" }`.
Restoring the screen is a content edit to that one row (a Supabase write, so it needs explicit
approval), not a code change. `scripts/onboarding-seed/validate-flow.mjs` compares
`flow-structure.yaml` against `node_copy.yaml` only, so it does not catch this drift.

## Behaviour

- **A blank submission is valid.** The copy says "(optional, just for context)". The node is
  *not* `optional` in YAML, so `FreeText` renders no skip button — Continue with an empty
  textarea is the skip.
- **Only non-empty text is written.** `writeNodeAnswer`'s `free_text` branch guards on
  `if (answer.text)`, so a blank or unsubmitted note leaves `dietary.health_condition_notes` at
  its skeleton `null`. Whitespace-only text is **not** trimmed and will be written as-is.
- **No validator gate.** This is free text that never reaches the Onboarding Validator Agent —
  the node declares no `validation` and no `other_capture`, and `health_condition_notes` is not
  in `lib/onboarding/validator-sections.ts`. It is stored verbatim and staged nowhere.
- **`next: n_allergies`** — the same target as `n_goal`'s default `next`, so the node is a
  pure insertion into the flow, not a fork with its own tail.
- **Back** from `n_allergies` lands here (no `confirm_edit` in between) and reverts
  `dietary.health_condition_notes`; Back again lands on `n_goal`.

## Exceptions & gotchas

**`dietary.health_condition_notes` is deliberately not `dietary.notes`.** `n_intolerances` owns
`dietary.notes` through its `free_text_note_field`. The two are separate fields carrying
different meanings; don't collapse them.

**Nothing downstream reads it.** `dietary.health_condition_notes` appears only in
`memory-skeleton.ts`, `types.ts`, and this node's `writes_to`. No options filter, no curated
lookup, no exclusion source consumes it — it is captured for a future consumer.

## Depends on

- Content: `node:n_health_condition_note` — `prompt` only. The row exists and is populated; it is
  `node:n_goal`'s option list that gates reachability.
- The placeholder (`"Type here…"`) and the Continue label are hardcoded in `FreeText.tsx`.

## Writes

- `dietary.health_condition_notes` — the raw textarea string (`setPath`; re-answering replaces)
