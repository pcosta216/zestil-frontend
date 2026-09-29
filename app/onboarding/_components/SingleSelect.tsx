"use client";

import { useState } from "react";
import { OptionButton, PrimaryButton, Prompt, ScreenShell, SkipButton, type NodeScreenProps } from "./shared";

// n_goal, n_leftovers — tap to highlight, Continue to submit, consistent with every other
// select-type screen in the flow (previously tapped an option and advanced immediately with no
// visible selection state, the odd one out). n_leftovers' option values are native booleans
// (true/false), not string slugs — see the options-contract exception note in
// flow-structure.yaml — so `NONE` (rather than `undefined`, which a real `false` would trip)
// marks "nothing chosen yet."
const NONE = Symbol("none");

export function SingleSelect({ node, showBack, submitting, previousAnswer, onAnswer, onBack }: NodeScreenProps) {
  // Back lands here with the earlier pick already highlighted. Length-checked rather than
  // `?? NONE` for the same reason NONE exists: a genuine `false` (n_leftovers) is a real answer.
  const [selected, setSelected] = useState<unknown>(() =>
    previousAnswer?.values?.length ? previousAnswer.values[0] : NONE
  );

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} instructions={node.prompt_instructions} />
      <div className="flex flex-col gap-2 mb-4">
        {(node.options ?? []).map((opt) => (
          <OptionButton
            key={String(opt.value)}
            label={opt.label}
            selected={selected === opt.value}
            onClick={() => setSelected(opt.value)}
          />
        ))}
      </div>
      <PrimaryButton onClick={() => onAnswer({ values: [selected] })} disabled={selected === NONE} loading={submitting}>
        Continue
      </PrimaryButton>
      {node.optional && <SkipButton onClick={() => onAnswer({ skipped: true })} label={node.skip_label} loading={submitting} />}
    </ScreenShell>
  );
}
