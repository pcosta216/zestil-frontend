"use client";

import { useState } from "react";
import { PrimaryButton, Prompt, ScreenShell, type NodeScreenProps } from "./shared";

// n_health_condition_note. A blank submission is fine — the copy itself
// says "optional, just for context" — the engine only writes non-empty text.
export function FreeText({ node, showBack, submitting, previousAnswer, onAnswer, onBack }: NodeScreenProps) {
  const [text, setText] = useState(previousAnswer?.text ?? "");

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Type here…"
        className="w-full bg-white border border-[rgba(0,0,0,0.1)] rounded-xl px-4 py-3 text-sm text-text-main outline-none focus:border-green-mid transition-colors placeholder:text-text-muted mb-4 resize-none"
      />
      <PrimaryButton onClick={() => onAnswer({ text })} loading={submitting}>
        Continue
      </PrimaryButton>
    </ScreenShell>
  );
}
