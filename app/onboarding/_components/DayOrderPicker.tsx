"use client";

import { useState } from "react";
import { OptionButton, PrimaryButton, Prompt, ScreenShell, type NodeScreenProps } from "./shared";

// n_week_start — tap a day to make it first, highlights the choice, Continue submits —
// consistent with every other select-type screen in the flow.
export function DayOrderPicker({ node, showBack, submitting, previousAnswer, onAnswer, onBack }: NodeScreenProps) {
  const [selected, setSelected] = useState<string | undefined>(previousAnswer?.day_order_value);

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} instructions={node.prompt_instructions} />
      <div className="flex flex-col gap-2 mb-4">
        {(node.options ?? []).map((opt) => (
          <OptionButton
            key={String(opt.value)}
            label={opt.label}
            selected={selected === String(opt.value)}
            onClick={() => setSelected(String(opt.value))}
          />
        ))}
      </div>
      <PrimaryButton onClick={() => onAnswer({ day_order_value: selected })} disabled={selected === undefined} loading={submitting}>
        Continue
      </PrimaryButton>
    </ScreenShell>
  );
}
