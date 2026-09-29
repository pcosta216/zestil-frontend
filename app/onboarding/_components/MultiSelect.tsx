"use client";

import { useState } from "react";
import { TOTAL_FAILURE_REASON } from "@/lib/onboarding/validator-sections";
import { DisclosureBanner, ExclusionReasons, GridOptionTile, OptionButton, OtherCaptureField, PrimaryButton, Prompt, ScreenShell, SkipButton, SmallButton, ValidatedEntryRow, type NodeScreenProps } from "./shared";

interface ValidatorEntryResult {
  entry: string;
  verdict: "valid" | "flag" | "invalid";
  value: string | null;
  label: string | null;
  reason: string | null;
}

type OtherEntry = { entry: string; value: string | null; label: string | null };

// A batch can come back mixed ("kketo" flagged, "silver surfer" invalid), so the whole batch
// can't share one verdict-shaped outcome. This holds the batch mid-review: `accepted` is
// everything that already passed and is just waiting on its neighbours, `problems` is what the
// user still has to decide on, one entry at a time.
interface ReviewState {
  extraSelections: unknown[];
  accepted: OtherEntry[];
  problems: ValidatorEntryResult[];
}

/** Per-entry outcome during review. `invalid` entries can only ever reach "removed". */
type Decision = "approved" | "removed";

/** An entry the validator didn't cover — same shape (and same copy) as a server-side failure. */
function unchecked(entry: string): ValidatorEntryResult {
  return { entry, verdict: "flag", value: null, label: null, reason: TOTAL_FAILURE_REASON };
}

function splitOtherText(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// n_cuisine_narrow, n_dishes, n_allergies, n_intolerances, n_active_slots,
// n_cuisine_broad, n_diet_style_cards, n_protein/carb/fat_exclusion_cards.
// Zero selections is a valid submission by default (repeat_for-scoped nodes
// like n_cuisine_narrow/n_dishes have no `optional` flag but are still a
// soft ask — "anything specific?" — so Continue stays enabled there) —
// `require_selection` opts a node OUT of that default (n_allergies: there's
// always a valid pick, "None of these" included, so submitting nothing is
// never actually meaningful).
export function MultiSelect({ node, item, showBack, submitting, previousAnswer, onAnswer, onBack }: NodeScreenProps) {
  // select_all_by_default (n_protein/carb/fat_exclusion_cards): opt-OUT framing — every
  // SELECTABLE tile starts selected ("I eat this"), tapping one off marks it excluded. A
  // filter-disabled tile (opt.disabled — doesn't fit the user's diet/allergies/intolerances)
  // never starts selected, since it can't be toggled at all. Lazy init so this only runs once
  // per mount; OnboardingFlow's key={node.id+item} already forces a fresh mount (and fresh
  // useState) on every node change, so there's no stale-selection risk switching decks.
  //
  // Coming back to an already-answered screen (Back, or confirm_edit's rewind) overrides both
  // defaults with what was actually submitted — including on an opt-out deck, where the earlier
  // answer IS the selected set. Recalled values are filtered to options that are still on screen
  // and still selectable: a value that can't be rendered would sit invisibly in `selected` and
  // get resubmitted with no way to see or remove it.
  const [selected, setSelected] = useState<Set<unknown>>(() => {
    const recalled = previousAnswer?.values;
    if (recalled) {
      const selectable = new Set((node.options ?? []).filter((o) => !o.disabled).map((o) => o.value));
      return new Set(recalled.filter((v) => selectable.has(v)));
    }
    return node.select_all_by_default ? new Set((node.options ?? []).filter((o) => !o.disabled).map((o) => o.value)) : new Set();
  });
  const [otherText, setOtherText] = useState("");
  // Custom entries from the earlier submission. They're kept as already-resolved entries rather
  // than dropped back into the text box: the box is the *unvalidated* input, and re-seeding it
  // would send text through the validator a second time (and re-open a review the user already
  // settled). Listed below the box, each removable — the whole point of showing them is that a
  // typed-in allergy is otherwise impossible to take back without restarting the flow.
  const [keptEntries, setKeptEntries] = useState<OtherEntry[]>(() => previousAnswer?.other_entries ?? []);
  const removeKeptEntry = (entry: string) => setKeptEntries((e) => e.filter((k) => k.entry !== entry));
  const [checkingOther, setCheckingOther] = useState(false);
  // Held between "validation came back with something to resolve" and the user's decisions, so
  // committing submits the SAME resolved entries that were validated — never a re-derivation.
  const [review, setReview] = useState<ReviewState | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const clearReview = () => {
    setReview(null);
    setDecisions({});
  };
  const decide = (entry: string, decision: Decision) => setDecisions((d) => ({ ...d, [entry]: decision }));
  const undecide = (entry: string) =>
    setDecisions((d) => {
      const next = { ...d };
      delete next[entry];
      return next;
    });

  // exclusive_value ("none of the above"-style option, e.g. balanced_no_specific_style):
  // symmetric — picking it clears every other selection (and they become disabled, not just
  // visually deselected, so there's no way to re-add one without first un-picking this); picking
  // any OTHER option clears this one back. Keeps the field internally consistent without needing
  // server-side validation — the two states can never coexist in what gets submitted.
  // Per-option `allows` (e.g. Halal only allows [halal, ramadan_fasting, ..., other]): a
  // compatibility whitelist rather than a conflict blacklist. An option with no `allows` is
  // unrestricted. Two options may coexist only if EVERY side that declares a list includes the
  // other — a mutual/AND check, so a restriction only needs to be written once, on the option
  // that actually has it, with no need to also add the reverse entry on every partner it rules out.
  const findOption = (value: unknown) => (node.options ?? []).find((o) => o.value === value);
  const mutuallyAllowed = (a: unknown, b: unknown): boolean => {
    const optA = findOption(a);
    const optB = findOption(b);
    if (optA?.allows && !optA.allows.includes(b)) return false;
    if (optB?.allows && !optB.allows.includes(a)) return false;
    return true;
  };
  const conflictsWithSelection = (value: unknown): boolean => {
    for (const s of selected) {
      if (s === value) continue;
      if (!mutuallyAllowed(value, s)) return true;
    }
    return false;
  };

  const toggle = (value: unknown) => {
    if (findOption(value)?.disabled) return; // filter-excluded — never toggleable, regardless of what triggered the click
    setSelected((prev) => {
      const next = new Set(prev);
      const exclusive = node.exclusive_value;
      if (next.has(value)) {
        next.delete(value);
      } else if (exclusive !== undefined && value === exclusive) {
        next.clear();
        next.add(value);
      } else if (!conflictsWithSelection(value)) {
        if (exclusive !== undefined) next.delete(exclusive);
        next.add(value);
      }
      return next;
    });
  };

  // Symmetric in both directions: picking the exclusive value must disable everything else,
  // AND picking anything else must disable the exclusive value back — a one-directional check
  // here previously left "None of these"-style options selectable after a real pick (bug).
  const exclusiveActive = node.exclusive_value !== undefined && selected.has(node.exclusive_value);
  const hasNonExclusiveSelection =
    node.exclusive_value !== undefined && [...selected].some((v) => v !== node.exclusive_value);
  const isDisabled = (value: unknown) => {
    if (findOption(value)?.disabled) return true; // options_filter: doesn't fit diet/allergies/intolerances — see exclusion_disclaimer
    if (exclusiveActive && value !== node.exclusive_value) return true;
    if (hasNonExclusiveSelection && value === node.exclusive_value) return true;
    return !selected.has(value) && conflictsWithSelection(value);
  };

  // needsAlternative (n_protein/carb/fat_exclusion_cards): nothing is currently allowed, either
  // because options_filter disabled every fixed category (e.g. vegan + a soy allergy leaves no
  // protein option at all) or because the user manually deselected every SELECTABLE one — "I eat
  // none of these" is the same dead end (an empty allowed rotation) either way. Computed purely
  // from the selectable (non-filter-disabled) subset, so a filter-disabled tile never counts
  // toward "the user chose to deselect everything." Forces the other_capture field open (there's
  // no "Other" tile in these fixed lists to select the usual way) and requires real input before
  // Continue re-enables — an empty Continue click would otherwise silently resolve to the same
  // "write nothing" outcome as before. The grid itself always stays visible (disabled tiles show
  // WHY they're unavailable; re-selecting a still-selectable one is also a valid way out).
  const selectableOptions = (node.options ?? []).filter((o) => !o.disabled);
  // Gated on other_capture existing at all: this state's whole purpose is to force that escape
  // hatch open, so on a select_all_by_default node WITHOUT one (n_active_slots) it would
  // otherwise disable Continue with nothing the user could possibly type to satisfy it — a dead
  // end reachable just by unticking every option.
  const needsAlternative =
    Boolean(node.select_all_by_default) &&
    Boolean(node.other_capture) &&
    selectableOptions.every((o) => !selected.has(o.value));
  // `keptEntries.length` is the third way in: a recalled answer always re-selects the "Other"
  // tile with it (the trigger value was part of the submission), but on a needsAlternative deck
  // there is no such tile, and un-tapping it elsewhere must not hide entries that are still
  // going to be submitted. Removing them is what gets rid of them.
  const otherActive =
    Boolean(node.other_capture) && (needsAlternative || selected.has(node.other_capture!.trigger_value) || keptEntries.length > 0);
  // "Other" selected with no text typed submits nothing for it (see submit()/engine.ts — the
  // placeholder gets filtered out) — doesn't count as a real selection for require_selection.
  // Entries recalled from the earlier answer are content just as much as freshly typed text.
  const otherHasContent = Boolean(otherText.trim()) || keptEntries.length > 0;
  const meaningfulSelectionCount = otherActive && !otherHasContent ? selected.size - 1 : selected.size;
  // While a batch is under review, Continue commits the per-entry decisions rather than
  // re-validating — and stays disabled until every problem entry has one, so an unresolved
  // `invalid` can never be tapped past. Editing the text box exits review entirely (see
  // OtherCaptureField's onChange) and the next Continue re-validates from scratch.
  const inReview = review !== null;
  const undecidedCount = review ? review.problems.filter((r) => decisions[r.entry] === undefined).length : 0;
  const survivingCount = review
    ? keptEntries.length +
      review.extraSelections.length +
      review.accepted.length +
      review.problems.filter((r) => decisions[r.entry] === "approved").length
    : 0;
  const continueDisabled =
    (node.require_selection === true && meaningfulSelectionCount === 0) ||
    (needsAlternative && !otherHasContent) ||
    // Removing every entry on a deck that has nothing else selectable is the same dead end
    // needsAlternative exists to prevent — don't let review be the back door into it.
    (inReview && (undecidedCount > 0 || (needsAlternative && survivingCount === 0)));
  // The normal prompt ("Any proteins you'd never eat?") would be misleading once nothing's
  // allowed — swap to the honest content field when defined. No skip-button equivalent: that
  // case hides the skip button entirely (see the render below) instead of relabeling it, since
  // any escape hatch there would defeat the point of forcing a real other_capture answer.
  const promptText = needsAlternative && node.no_options_message ? node.no_options_message : node.prompt;
  const hasDisabledOption = (node.options ?? []).some((o) => o.disabled);

  // Every submission path goes through here, so entries recalled from the earlier answer are
  // folded in once, in one place, rather than at each of the three call sites. Deduped on the
  // written form (the agent's normalized `value`, or the raw text when it has none) so retyping
  // something already listed doesn't submit it twice.
  const sendAnswer = (extraSelections: unknown[], otherEntries: OtherEntry[]) => {
    const merged = new Map<string, OtherEntry>();
    for (const e of [...keptEntries, ...otherEntries]) merged.set(e.value ?? e.entry.trim().toLowerCase(), e);
    const entries = [...merged.values()];
    onAnswer({
      values: [...new Set([...selected, ...extraSelections])],
      other_entries: entries.length > 0 ? entries : undefined,
    });
  };

  // "Other" free text goes through the Onboarding Validator Agent (one batched call for the
  // whole submission — see lib/onboarding/validate-other.ts) BEFORE it's submitted as an
  // answer, not as part of applyAnswer itself — keeps the engine pure and this a pre-submit
  // gate. Anything not `valid` blocks submission and shows the agent's own `reason` as the
  // confirm copy; "confirm" submits the entries as validated (using the agent's normalization,
  // NOT the raw text — see ONBOARDING_VALIDATOR_AGENT_CONTRACT.md §3 step 2), "correct" is
  // just editing the text field and hitting Continue again, which re-validates naturally.
  const submit = async () => {
    const trimmedOther = otherActive ? otherText.trim() : "";
    if (!trimmedOther || !node.other_capture?.validation) {
      clearReview();
      sendAnswer([], []);
      return;
    }

    const options = node.options ?? [];
    // Pre-check: a typed piece that already matches a rendered option's label isn't a custom
    // entry at all — it's a plain selection the user typed instead of tapping. Never sent to
    // the agent (design doc §7 item 1).
    const extraSelections: unknown[] = [];
    const needsValidation: string[] = [];
    for (const piece of splitOtherText(trimmedOther)) {
      const match = options.find((o) => !o.disabled && o.label.trim().toLowerCase() === piece.toLowerCase());
      if (match) extraSelections.push(match.value);
      else needsValidation.push(piece);
    }

    let results: ValidatorEntryResult[] = [];
    if (needsValidation.length > 0) {
      setCheckingOther(true);
      try {
        const res = await fetch("/api/onboarding/validate-other", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ node_id: node.id, item, entries: needsValidation }),
        });
        const data: { results?: ValidatorEntryResult[] } = res.ok ? await res.json() : {};
        // Match results to entries BY ENTRY TEXT, not by position or on a length check.
        // Observed in tbl_agent_debug_log: the model returns fewer results than it was given
        // entries on roughly 5% of multi-entry calls ("keto | atkins" -> one result). The Edge
        // Function currently repairs that before responding (60/60 final responses had the
        // right count), so this is belt-and-braces — but the previous length-equality check
        // meant ONE short response silently downgraded the WHOLE batch to "valid, value null",
        // which writes raw typed text and skips validation entirely. Failing closed per-entry
        // is the safer shape: anything the response didn't cover becomes a flag the user sees.
        const byEntry = new Map((data.results ?? []).map((r) => [r.entry, r]));
        results = needsValidation.map((entry) => byEntry.get(entry) ?? unchecked(entry));
      } catch {
        // Couldn't reach our own route at all. Flag rather than accept: the entry is unvalidated
        // either way, and `flag` still lets the user confirm it in one tap.
        results = needsValidation.map(unchecked);
      }
      setCheckingOther(false);
    }

    // Post-normalization dedupe: the agent normalized to a slug that IS already a rendered
    // option (typed "thai food" -> `thai`, which is on screen) — select that instead of
    // appending a redundant custom entry (design doc §7 item 2).
    //
    // Entries are sorted into three buckets, NOT one batch-wide outcome: a submission like
    // "kketo, silver surfer" is genuinely mixed (one flag, one invalid) and collapsing it to
    // the worst verdict used to force the user to retype the good entry alongside the bad one.
    // Each problem entry now carries its own resolution (see the review block in the render).
    //
    // `invalid` still never gets an approve option, only `flag` does — a deliberate departure
    // from the design doc (which treats the two identically). Every section's own criteria draw
    // `invalid` as "not even the right KIND of answer for this field" (a cuisine typed as a
    // dish, gibberish, ...) — forcing that through writes the wrong shape of data. `flag` means
    // the entry genuinely is the right kind of thing and the model just isn't sure it's a good
    // fit (wrong-branch cuisine, diet contradiction) — exactly the case where the user
    // legitimately might know better.
    //
    // This applies to `allergies` too, deliberately. That section USED to be guaranteed never
    // to emit `invalid` (its prompt said so outright), which would have made the block a no-op
    // there; that guarantee is gone — the allergies prompt now has a real `invalid` branch for
    // entries that name nothing usable, and gibberish shouldn't be recordable as an allergy
    // either. Considered and rejected: a carve-out downgrading `invalid` to `flag` on allergies
    // as a hedge against the model wrongly rejecting a genuine allergy. Product decision was to
    // keep the rule strictly uniform — don't re-add a section-specific exemption here without
    // revisiting that call.
    const accepted: OtherEntry[] = [];
    const problems: ValidatorEntryResult[] = [];
    for (const r of results) {
      const curated = r.value !== null ? options.find((o) => !o.disabled && o.value === r.value) : undefined;
      if (curated) {
        extraSelections.push(curated.value);
        continue;
      }
      if (r.verdict === "valid") accepted.push({ entry: r.entry, value: r.value, label: r.label });
      else problems.push(r);
    }

    if (problems.length > 0) {
      setReview({ extraSelections, accepted, problems });
      setDecisions({});
      return;
    }
    clearReview();
    sendAnswer(extraSelections, accepted);
  };

  /** Submits the reviewed batch: everything that passed, plus the flags the user approved. */
  const commitReview = () => {
    if (!review) return;
    const approved = review.problems
      .filter((r) => decisions[r.entry] === "approved")
      .map((r) => ({ entry: r.entry, value: r.value, label: r.label }));
    clearReview();
    sendAnswer(review.extraSelections, [...review.accepted, ...approved]);
  };

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={promptText} instructions={node.prompt_instructions} />
      <DisclosureBanner text={node.disclosure_text} />
      {hasDisabledOption && (
        <DisclosureBanner text={node.exclusion_disclaimer}>
          <ExclusionReasons reasons={node.exclusion_reasons} />
        </DisclosureBanner>
      )}
      {node.layout === "grid" ? (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(node.options ?? []).map((opt) => (
            <GridOptionTile
              key={String(opt.value)}
              label={opt.label}
              selected={selected.has(opt.value)}
              disabled={isDisabled(opt.value)}
              onClick={() => toggle(opt.value)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-4">
          {(node.options ?? []).map((opt) => (
            <OptionButton
              key={String(opt.value)}
              label={opt.label}
              selected={selected.has(opt.value)}
              disabled={isDisabled(opt.value)}
              onClick={() => toggle(opt.value)}
            />
          ))}
        </div>
      )}
      {otherActive && node.other_capture?.prompt && (
        <div className="mb-4">
          <OtherCaptureField
            prompt={node.other_capture.prompt}
            value={otherText}
            onChange={(v) => {
              setOtherText(v);
              clearReview(); // editing invalidates the whole reviewed batch and its decisions
            }}
          />
          {/* What was typed here last time, still on the answer and still removable. Rendered
              as rows rather than back inside the box: these are settled entries (validated,
              possibly renamed by the agent), and the box is for new input. */}
          {keptEntries.length > 0 && (
            <div className="flex flex-col gap-2 mt-3">
              {keptEntries.map((e) => (
                <div
                  key={e.entry}
                  className="flex items-center justify-between rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-2.5 text-sm"
                >
                  <span className="text-text-main">{e.label ?? e.entry}</span>
                  <button
                    type="button"
                    onClick={() => removeKeptEntry(e.entry)}
                    className="text-text-muted hover:text-text-main text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {review && (
        <div className="mb-4">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
            {review.problems.length === 1 ? "One entry needs a look" : `${review.problems.length} entries need a look`}
          </p>
          {review.problems.map((r) => {
            // The agent's own `reason` IS the copy — the node's static on_invalid_message is
            // only the fallback for when reason comes back null (a backend failure or the 8s
            // timeout). See ONBOARDING_VALIDATOR_AGENT_CONTRACT.md §3.
            const reason =
              r.reason ?? node.other_capture?.on_invalid_message ?? `Just double-checking — is "${r.entry}" right?`;
            const decision = decisions[r.entry];
            if (decision) {
              return (
                <ValidatedEntryRow
                  key={r.entry}
                  entry={r.entry}
                  tone={r.verdict === "invalid" ? "invalid" : "flag"}
                  reason={reason}
                  resolution={
                    decision === "removed"
                      ? "Removed — it won't be saved."
                      : `Saving as "${r.label ?? r.entry}".`
                  }
                >
                  <SmallButton onClick={() => undecide(r.entry)}>Undo</SmallButton>
                </ValidatedEntryRow>
              );
            }
            return (
              <ValidatedEntryRow
                key={r.entry}
                entry={r.entry}
                tone={r.verdict === "invalid" ? "invalid" : "flag"}
                reason={
                  r.verdict === "invalid"
                    ? // Name the entry explicitly — in a mixed batch it must be unmistakable
                      // WHICH input is the problem, not just that something was wrong.
                      `${reason} Please fix “${r.entry}” in the box above, or remove it.`
                    : reason
                }
              >
                {/* flag only: approving takes the agent's own normalization when it has one
                    (`label`/`value`), and otherwise keeps the text as typed — the total-failure
                    fallback comes back as a flag with both null, and that still has to be
                    approvable or a backend blip would strand the user. */}
                {r.verdict === "flag" && (
                  <SmallButton variant="primary" onClick={() => decide(r.entry, "approved")}>
                    {r.label ? `Yes — use “${r.label}”` : `Yes — keep “${r.entry}”`}
                  </SmallButton>
                )}
                <SmallButton onClick={() => decide(r.entry, "removed")}>Remove this one</SmallButton>
              </ValidatedEntryRow>
            );
          })}
        </div>
      )}
      <PrimaryButton
        onClick={inReview ? commitReview : submit}
        disabled={continueDisabled}
        loading={submitting || checkingOther}
      >
        Continue
      </PrimaryButton>
      {node.optional && !needsAlternative && (
        <SkipButton
          onClick={() => onAnswer({ skipped: true })}
          label={node.skip_label}
          disabled={hasDisabledOption} // "I can eat everything" would contradict what filtering already ruled out
          loading={submitting || checkingOther}
        />
      )}
    </ScreenShell>
  );
}
