"use client";

import type { Answer, RenderedNode } from "@/lib/onboarding/types";

/** Every node-type component (SingleSelect, MultiSelect, PairingCards, ...) shares this contract. */
export interface NodeScreenProps {
  node: RenderedNode;
  item?: string;
  showBack: boolean;
  submitting: boolean;
  // What this person answered here last time, when they arrived by going Back (or via
  // confirm_edit's "something's wrong" rewind). Screens initialise their state from it so the
  // answer is visible and editable rather than silently gone — the write itself was reverted
  // on the way in, so a blank screen would be the only record that anything was ever chosen.
  // Undefined on a first visit, and after a skip. See HistoryEntry.answer in types.ts.
  previousAnswer?: Answer;
  onAnswer: (answer: Answer) => void;
  onBack: () => void;
}

// Shared primitives for onboarding node-type screens — mirrors the styling
// conventions in app/(auth)/_components/form.tsx (Field/FormError/SubmitButton)
// and the color/font tokens in app/globals.css (bg-warm, green-*, font-display).

export function ScreenShell({
  onBack,
  showBack,
  children,
}: {
  onBack?: () => void;
  showBack: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-sm mx-auto">
      {showBack && (
        <button
          type="button"
          onClick={onBack}
          className="fixed top-4 right-4 z-10 text-sm text-text-muted hover:text-text-main hover:bg-black/5 transition-colors rounded-lg px-3 py-2"
        >
          ← Back
        </button>
      )}
      {children}
    </div>
  );
}

export function Prompt({ text, instructions }: { text?: string; instructions?: string }) {
  return (
    <div className="mb-6">
      {text && <h1 className="font-display text-2xl text-text-main tracking-tight leading-snug">{text}</h1>}
      {instructions && <p className="text-[11px] uppercase tracking-wide text-text-muted mt-2">{instructions}</p>}
    </div>
  );
}

export function PrimaryButton({
  onClick,
  disabled,
  loading,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full bg-green-primary text-white rounded-xl py-3 text-sm font-medium hover:bg-green-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? "…" : children}
    </button>
  );
}

export function SkipButton({
  onClick,
  label,
  disabled,
  loading,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean; // structurally unavailable right now (e.g. would contradict known info) — stays legible, just unclickable
  loading?: boolean; // a request is in flight — shows "…" instead of the label, same as PrimaryButton
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full text-center text-sm text-text-muted hover:text-text-main transition-colors py-2.5 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? "…" : (label ?? "Skip")}
    </button>
  );
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4">
      {children}
    </p>
  );
}

// One row per problematic "Other" entry, so a mixed batch ("kketo, silver surfer") resolves
// entry-by-entry instead of all-or-nothing. `tone` follows the verdict: "flag" is recoverable
// (the user can approve the agent's suggestion), "invalid" is not (the only way out is fixing
// or dropping that specific entry) — the two must never look alike, or the distinction the
// verdict draws is invisible.
export function ValidatedEntryRow({
  entry,
  tone,
  reason,
  resolution,
  children,
}: {
  entry: string;
  tone: "flag" | "invalid";
  reason: string;
  resolution?: string;
  children?: React.ReactNode;
}) {
  const box =
    tone === "invalid"
      ? "bg-red-50 border-red-200"
      : "bg-amber-50 border-amber-200";
  const reasonColor = tone === "invalid" ? "text-red-700" : "text-amber-800";
  return (
    <div className={`rounded-xl border px-4 py-3 mb-2 ${box}`}>
      <p className="text-sm font-medium text-text-main">&ldquo;{entry}&rdquo;</p>
      <p className={`text-xs mt-1 leading-relaxed ${reasonColor}`}>{reason}</p>
      {resolution ? (
        <p className="text-xs mt-2 text-text-muted italic">{resolution}</p>
      ) : (
        children && <div className="flex flex-wrap gap-2 mt-2.5">{children}</div>
      )}
    </div>
  );
}

export function SmallButton({
  onClick,
  children,
  variant = "plain",
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "primary" | "plain";
}) {
  const style =
    variant === "primary"
      ? "bg-green-primary text-white border-green-primary hover:bg-green-dark"
      : "bg-white text-text-muted border-[rgba(0,0,0,0.12)] hover:text-text-main";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${style}`}
    >
      {children}
    </button>
  );
}

export function DisclosureBanner({ text, children }: { text?: string; children?: React.ReactNode }) {
  if (!text && !children) return null;
  return (
    <div className="text-xs text-text-muted bg-green-light border border-green-border rounded-xl px-4 py-2.5 mb-4">
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

// Which answer greyed out which tiles. The banner text above can only name the three KINDS of
// answer that filter this screen ("your diet, allergy, or intolerance answers"); these lines
// name the specific one, so "why is Butter greyed?" is answerable without guessing — and so the
// banner's own advice ("tap Back to change those") points somewhere in particular.
export function ExclusionReasons({ reasons }: { reasons?: { cause: string; labels: string[] }[] }) {
  if (!reasons?.length) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {reasons.map((r) => (
        <li key={r.cause}>
          <span className="font-medium text-text-main">{r.cause}:</span> {r.labels.join(", ")}
        </li>
      ))}
    </ul>
  );
}

const optionButtonBase =
  "w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors";

export function OptionButton({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        disabled
          ? `${optionButtonBase} bg-white border-[rgba(0,0,0,0.06)] text-text-muted opacity-50 cursor-not-allowed`
          : selected
            ? `${optionButtonBase} bg-green-light border-green-border text-text-main`
            : `${optionButtonBase} bg-white border-[rgba(0,0,0,0.08)] text-text-main hover:border-green-border`
      }
    >
      {label}
    </button>
  );
}

// 2-column tap grid — for a multi_select node whose options are short, single-choice-feeling
// items (see node.layout: "grid" in engine types). Centered text, square-ish tiles, same
// selected/unselected treatment as OptionButton so the two layouts read as the same system.
export function GridOptionTile({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        disabled
          ? "rounded-xl border px-3 py-4 text-sm text-center transition-colors bg-white border-[rgba(0,0,0,0.06)] text-text-muted opacity-50 cursor-not-allowed"
          : selected
            ? "rounded-xl border px-3 py-4 text-sm text-center transition-colors bg-green-light border-green-border text-text-main"
            : "rounded-xl border px-3 py-4 text-sm text-center transition-colors bg-white border-[rgba(0,0,0,0.08)] text-text-main hover:border-green-border"
      }
    >
      {label}
    </button>
  );
}

// The hint is hardcoded rather than DB content on purpose: it describes a mechanic of the
// field itself (what the engine does with the text — see MultiSelect.tsx's splitOtherText and
// engine.ts's matching split), not question copy, so it's identical on every screen this
// renders on and shouldn't drift per-node. Same reasoning as the "Skip"/"continue anyway"
// button text being hardcoded. Commas are what's advertised; `;` and newlines split too, but
// naming all three reads as noise for no real gain.
export function OtherCaptureField({
  prompt,
  value,
  onChange,
}: {
  prompt: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mt-3">
      <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">{prompt}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type here…"
        className="w-full bg-white border border-[rgba(0,0,0,0.1)] rounded-xl px-4 py-3 text-sm text-text-main outline-none focus:border-green-mid transition-colors placeholder:text-text-muted"
      />
      <p className="text-[11px] text-text-muted mt-1.5">Adding more than one? Separate them with commas.</p>
    </div>
  );
}
