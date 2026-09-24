"use client";

import { PrimaryButton, Prompt, ScreenShell, type NodeScreenProps } from "./shared";

// n_allergy_confirm — the one node in the flow with an explicit
// confirm-before-write step (design doc §4a). recap_values holds the
// ACTUAL current value at each editable_fields path (see engine.ts's
// renderNode), not just static copy, since a wrong guess here is a safety
// issue, not a bad recipe suggestion.
export function ConfirmEdit({ node, showBack, submitting, onAnswer, onBack }: NodeScreenProps) {
  const entries = Object.entries(node.recap_values ?? {});

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} />
      <div className="rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-3 mb-6">
        {entries.map(([path, value]) => (
          <p key={path} className="text-sm text-text-main">
            {Array.isArray(value) && value.length > 0
              ? value.join(", ")
              : Array.isArray(value)
                ? "None"
                : String(value ?? "—")}
          </p>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <PrimaryButton onClick={() => onAnswer({ confirm_edit_action: "confirm" })} loading={submitting}>
          Looks right
        </PrimaryButton>
        <button
          type="button"
          onClick={() => !submitting && onAnswer({ confirm_edit_action: "edit" })}
          className="w-full text-center text-sm text-text-muted hover:text-text-main transition-colors py-2.5"
        >
          Something&apos;s missing or wrong
        </button>
      </div>
    </ScreenShell>
  );
}
