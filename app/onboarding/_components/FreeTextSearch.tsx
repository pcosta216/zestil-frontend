"use client";

import { useState } from "react";
import { TOTAL_FAILURE_REASON } from "@/lib/onboarding/validator-sections";
import { PrimaryButton, Prompt, ScreenShell, SkipButton, SmallButton, ValidatedEntryRow, type NodeScreenProps } from "./shared";

interface ValidatorEntryResult {
  entry: string;
  verdict: "valid" | "flag" | "invalid";
  value: string | null;
  label: string | null;
  reason: string | null;
  // Optional, and only ever set on a `flag`: the agent's own breakdown of a compound entry
  // ("butter chicken and pizza" -> ["Butter Chicken", "Pizza"]). Absent or short = the entry
  // stays a plain rewrite-or-remove flag, so this is inert until the agent starts emitting it.
  //
  // The split is deliberately NOT done client-side: "and" is load-bearing in real dish names
  // (macaroni and cheese, fish and chips, sweet and sour pork), so only the model can tell a
  // compound entry from a single dish that happens to contain the word.
  split_into?: string[] | null;
}

/** The agent's compound-entry breakdown, when it gave a usable one (2+ non-empty pieces). */
function splitPiecesOf(r: ValidatorEntryResult): string[] | null {
  if (r.verdict !== "flag" || !Array.isArray(r.split_into)) return null;
  const pieces = r.split_into.map((s) => String(s).trim()).filter(Boolean);
  return pieces.length >= 2 ? pieces : null;
}

interface ReviewState {
  accepted: { label: string }[];
  problems: ValidatorEntryResult[];
}

/** An entry the validator didn't cover — same shape (and copy) as a server-side failure. */
function unchecked(entry: string): ValidatorEntryResult {
  return { entry, verdict: "flag", value: null, label: null, reason: TOTAL_FAILURE_REASON };
}

// On THIS section a `flag` is not an "are you sure?" — the agent's prompt defines it as "the
// entry reads as a category rather than a specific recipe ... a friendly, specific nudge toward
// naming the particular dish or version meant". Approving such a flag as typed writes back the
// exact text the agent just said was too vague ("butter chicken and pizza" landing as ONE
// recipe title), so there is no approve affordance for a real flag here — only rewrite or drop.
//
// The one exception is OUR OWN failure fallback: a timeout or unreachable route synthesizes a
// flag that means "we couldn't check this", which genuinely is confirm-or-correct. It's
// identifiable because both sides build it from the same constant.
function isOurFailure(r: ValidatorEntryResult): boolean {
  return r.reason === TOTAL_FAILURE_REASON;
}

// n_favorite_recipes. search_recipe_db is a stub this phase (always returns
// no results — see resolvers.ts), so this is freeform-entry-only for now:
// type a title, tap Add, repeat up to max_items. Wiring in live search
// later only changes how a "pick" gets its `value` (a real recipe_uuid
// instead of undefined) — the recipe_picks shape stays the same.
//
// Unlike every other validated node, this one's validation config sits at the node's own top
// level (`validation`), not inside an other_capture block — it's a free_text_search, and its
// whole input is freeform. Everything staged via Add is batch-validated in ONE call when
// Continue is tapped, not per-Add: the contract is one call per submission. `favorite_recipes`
// is also the one section where the agent's `value` is ALWAYS null (no slug concept — the
// target is a recipe title), so only `label` is ever used here.
export function FreeTextSearch({ node, item, showBack, submitting, previousAnswer, onAnswer, onBack }: NodeScreenProps) {
  const [draft, setDraft] = useState("");
  // Back restores the staged chips — already removable, and each re-validates on the next
  // Continue exactly as it did the first time (they passed once; nothing here assumes they did).
  const [picks, setPicks] = useState<{ label: string }[]>(() =>
    (previousAnswer?.recipe_picks ?? []).map((p) => ({ label: p.label }))
  );
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "approved" | "removed">>({});
  const max = node.max_items ?? 5;

  const clearReview = () => {
    setReview(null);
    setDecisions({});
  };

  // Splits on the same delimiters every other freeform field uses (see MultiSelect.tsx's
  // splitOtherText and engine.ts's other_capture split), so "pizza, lasagna" stages two picks
  // rather than one chip holding both — which would otherwise be sent to the validator as a
  // single nonsense recipe title. Splitting here (on Add) rather than at validation time means
  // the user SEES the split land as separate chips, and max_items counts them correctly.
  /** Appends pieces as chips, honouring max_items and case-insensitive dedupe. */
  const stagePieces = (base: { label: string }[], pieces: string[]) => {
    const next = [...base];
    for (const piece of pieces) {
      if (next.length >= max) break;
      if (next.some((existing) => existing.label.toLowerCase() === piece.toLowerCase())) continue;
      next.push({ label: piece });
    }
    return next;
  };

  const draftPieces = () =>
    draft
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const add = () => {
    const pieces = draftPieces();
    if (pieces.length === 0 || picks.length >= max) return;

    setPicks((p) => stagePieces(p, pieces));
    setDraft("");
    clearReview(); // staging a new pick invalidates the whole reviewed batch
  };
  const remove = (i: number) => {
    setPicks((p) => p.filter((_, idx) => idx !== i));
    clearReview();
  };

  /** Pulls a flagged entry back into the input to be rewritten, and drops its chip. */
  const editEntry = (entry: string) => {
    setPicks((p) => p.filter((pick) => pick.label !== entry));
    setDraft(entry);
    clearReview();
  };
  const removeEntry = (entry: string) => {
    setPicks((p) => p.filter((pick) => pick.label !== entry));
    clearReview();
  };

  /**
   * Replaces one compound chip with the agent's split pieces. Deliberately does NOT submit:
   * the pieces re-enter validation as ordinary entries on the next Continue, so each dish gets
   * its own real verdict rather than inheriting the compound entry's flag.
   */
  const applySplit = (entry: string, pieces: string[]) => {
    setPicks((p) => stagePieces(p.filter((pick) => pick.label !== entry), pieces));
    clearReview();
  };

  const submit = async () => {
    // Fold any un-added draft in first. Tapping Add is a convenience, not a required ritual —
    // typing a dish and hitting Continue used to discard it silently, which is the worst
    // possible outcome for the one screen whose entire job is collecting those dishes.
    // Computed locally rather than read back from state: setPicks won't have flushed yet.
    const effectivePicks = stagePieces(picks, draftPieces());
    if (effectivePicks.length !== picks.length) {
      setPicks(effectivePicks);
      setDraft("");
    }

    if (effectivePicks.length === 0 || !node.validation) {
      clearReview();
      onAnswer({ recipe_picks: effectivePicks });
      return;
    }

    const entries = effectivePicks.map((p) => p.label);
    let results: ValidatorEntryResult[] = [];
    setChecking(true);
    try {
      const res = await fetch("/api/onboarding/validate-other", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: node.id, item, entries }),
      });
      const data: { results?: ValidatorEntryResult[] } = res.ok ? await res.json() : {};
      // Match by entry text and fail CLOSED per entry — the old length-equality check turned
      // one short or failed response into "every entry is valid with a null label", which wrote
      // raw unvalidated text straight into preferred_recipes. See MultiSelect.tsx for the
      // observed model-drop rate that makes this reachable.
      const byEntry = new Map((data.results ?? []).map((r) => [r.entry, r]));
      results = entries.map((entry) => byEntry.get(entry) ?? unchecked(entry));
    } catch {
      results = entries.map(unchecked);
    }
    setChecking(false);

    // `label` is the agent's cleaned-up title (capitalization/typo fixes) — that's what gets
    // written, not the raw typed text, whenever it came back non-null.
    const accepted: { label: string }[] = [];
    const problems: ValidatorEntryResult[] = [];
    for (const r of results) {
      if (r.verdict === "valid") accepted.push({ label: r.label ?? r.entry.trim() });
      else problems.push(r);
    }

    if (problems.length > 0) {
      setReview({ accepted, problems });
      setDecisions({});
      return;
    }
    clearReview();
    onAnswer({ recipe_picks: accepted });
  };

  /** Submits the reviewed batch: everything that passed, plus any our-failure flags confirmed. */
  const commitReview = () => {
    if (!review) return;
    const approved = review.problems
      .filter((r) => decisions[r.entry] === "approved")
      .map((r) => ({ label: r.label ?? r.entry.trim() }));
    clearReview();
    onAnswer({ recipe_picks: [...review.accepted, ...approved] });
  };

  const inReview = review !== null;
  const undecidedCount = review ? review.problems.filter((r) => decisions[r.entry] === undefined).length : 0;
  // Continue and Skip used to be indistinguishable here: with nothing staged, Continue submitted
  // an empty recipe_picks, which produces byte-identical memory, next-node and history to a Skip.
  // Two controls with one behaviour is just a coin flip for the user, so Continue now requires
  // something to submit and Skip is the explicit "I haven't got any" path. The draft counts —
  // see submit(), which folds it in — so this never greys out with text sitting in the box.
  const nothingToSubmit = picks.length === 0 && draftPieces().length === 0;

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} />
      <div className="flex gap-2 mb-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. Butter chicken"
          className="flex-1 bg-white border border-[rgba(0,0,0,0.1)] rounded-xl px-4 py-3 text-sm text-text-main outline-none focus:border-green-mid transition-colors placeholder:text-text-muted"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || picks.length >= max}
          className="px-4 rounded-xl bg-green-light border border-green-border text-sm text-text-main disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <p className="text-[11px] text-text-muted mb-3 -mt-1">Adding more than one? Separate them with commas.</p>
      {picks.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {picks.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 bg-green-light border border-green-border rounded-full px-3 py-1 text-xs text-text-main">
              {p.label}
              <button type="button" onClick={() => remove(i)} className="text-text-muted hover:text-text-main" aria-label={`Remove ${p.label}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {review && (
        <div className="mb-4">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
            {review.problems.length === 1 ? "One entry needs a look" : `${review.problems.length} entries need a look`}
          </p>
          {review.problems.map((r) => {
            const reason = r.reason ?? node.on_invalid_message ?? `Just double-checking — is "${r.entry}" right?`;
            const tone = r.verdict === "invalid" ? "invalid" : "flag";
            const decision = decisions[r.entry];
            const splitPieces = splitPiecesOf(r);
            if (decision) {
              return (
                <ValidatedEntryRow
                  key={r.entry}
                  entry={r.entry}
                  tone={tone}
                  reason={reason}
                  resolution={decision === "removed" ? "Removed — it won't be saved." : `Saving as "${r.label ?? r.entry}".`}
                >
                  <SmallButton onClick={() => setDecisions((d) => {
                    const next = { ...d };
                    delete next[r.entry];
                    return next;
                  })}>
                    Undo
                  </SmallButton>
                </ValidatedEntryRow>
              );
            }
            return (
              <ValidatedEntryRow key={r.entry} entry={r.entry} tone={tone} reason={reason}>
                {/* Confirm-as-typed exists ONLY for our own failure fallback (see isOurFailure).
                    A real flag on this section is the agent asking for a more specific dish, so
                    the way out is rewriting it — Rewrite drops the chip and puts the text back in
                    the box, where commas split it into separate recipes. When the agent supplied
                    its own split (split_into), that same outcome is one tap instead of a retype. */}
                {isOurFailure(r) ? (
                  <SmallButton variant="primary" onClick={() => setDecisions((d) => ({ ...d, [r.entry]: "approved" }))}>
                    Yes — keep &ldquo;{r.label ?? r.entry}&rdquo;
                  </SmallButton>
                ) : splitPieces ? (
                  <SmallButton variant="primary" onClick={() => applySplit(r.entry, splitPieces)}>
                    Add as {splitPieces.length} separate recipes
                  </SmallButton>
                ) : (
                  <SmallButton variant="primary" onClick={() => editEntry(r.entry)}>
                    Rewrite this one
                  </SmallButton>
                )}
                {splitPieces && !isOurFailure(r) && (
                  <SmallButton onClick={() => editEntry(r.entry)}>Rewrite instead</SmallButton>
                )}
                <SmallButton onClick={() => (isOurFailure(r) ? setDecisions((d) => ({ ...d, [r.entry]: "removed" })) : removeEntry(r.entry))}>
                  Remove this one
                </SmallButton>
              </ValidatedEntryRow>
            );
          })}
        </div>
      )}
      <PrimaryButton
        onClick={inReview ? commitReview : submit}
        disabled={inReview ? undecidedCount > 0 : nothingToSubmit}
        loading={submitting || checking}
      >
        Continue
      </PrimaryButton>
      {node.optional && <SkipButton onClick={() => onAnswer({ skipped: true })} label={node.skip_label} loading={submitting || checking} />}
    </ScreenShell>
  );
}
