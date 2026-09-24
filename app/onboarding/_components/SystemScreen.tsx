"use client";

import { PrimaryButton, Prompt, ScreenShell, type NodeScreenProps } from "./shared";

// n_welcome, the only `type: system` screen a user sees. n_compile is auto-committed by
// OnboardingFlow the moment it's reached — "not a user-facing node," per the design doc — so
// this component never needs to render it, and n_summary has its own type and component
// (SummaryScreen.tsx) since its body is fetched, not content.
export function SystemScreen({ node, showBack, submitting, onAnswer, onBack }: NodeScreenProps) {
  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} />
      <PrimaryButton onClick={() => onAnswer({})} loading={submitting}>
        Get started
      </PrimaryButton>
    </ScreenShell>
  );
}
