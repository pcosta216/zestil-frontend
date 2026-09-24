"use client";

import { PrimaryButton, Prompt, ScreenShell, type NodeScreenProps } from "./shared";

// n_consent — single explicit accept action, no dark patterns (design doc §—
// n_consent). The engine sets { accepted: true, accepted_at: now } regardless
// of the answer's content, so this just needs to submit *something*.
export function Consent({ node, showBack, submitting, onAnswer, onBack }: NodeScreenProps) {
  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} />
      <PrimaryButton onClick={() => onAnswer({})} loading={submitting}>
        I agree
      </PrimaryButton>
    </ScreenShell>
  );
}
