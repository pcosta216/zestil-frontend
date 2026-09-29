"use client";

import { useState, type ReactNode } from "react";
import { OptionButton, PrimaryButton, Prompt, ScreenShell, type NodeScreenProps } from "./shared";

// n_pairing_cards — one screen per sampled dish (node.prompt is the dish's own label, e.g.
// "Falafel"), two independent checked-side questions sharing the same 4 curated options.
// Checking a side in one question clears it from the other — checking the same side as both
// "goes well with" and "never pair with" would be a contradictory submission; not something the
// design doc explicitly calls out, but a plain UX safeguard in the same spirit as
// MultiSelect.tsx's exclusive_value handling. Submitting nothing in either question is valid
// (no opinion on this particular dish) — Continue is never disabled here, matching
// n_cuisine_narrow/n_dishes' "soft ask" precedent for other repeat_for screens.
//
// No Skip button — pairing reactions are data this product needs, not an optional aside (see
// flow-structure.yaml: n_pairing_cards is no longer `optional`). Declining a SPECIFIC dish (no
// opinion either way) is still fine via a bare Continue; there's just no one-tap way to bail on
// the whole sampled sequence anymore.

/** Wraps the first case-insensitive match of `phrase` inside `text` in a styled span — everything else renders as plain text. */
function highlightPhrase(text: string, phrase: string, className: string): ReactNode {
  const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className={className}>{text.slice(idx, idx + phrase.length)}</span>
      {text.slice(idx + phrase.length)}
    </>
  );
}

export function PairingCards({ node, showBack, submitting, previousAnswer, onAnswer, onBack }: NodeScreenProps) {
  // Back re-checks both sides as they were left — these screens repeat per sampled dish, so
  // without it there's no way to tell which dish's answer you're looking at once you step back.
  const [preferred, setPreferred] = useState<Set<unknown>>(() => new Set(previousAnswer?.values ?? []));
  const [forbidden, setForbidden] = useState<Set<unknown>>(() => new Set(previousAnswer?.left_values ?? []));

  const toggle = (group: "preferred" | "forbidden", value: unknown) => {
    const [mine, other, setMine, setOther] = group === "preferred" ? [preferred, forbidden, setPreferred, setForbidden] : [forbidden, preferred, setForbidden, setPreferred];
    const next = new Set(mine);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
      if (other.has(value)) {
        const clearedOther = new Set(other);
        clearedOther.delete(value);
        setOther(clearedOther);
      }
    }
    setMine(next);
  };

  const submit = () => onAnswer({ values: [...preferred], left_values: [...forbidden] });

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} />
      {node.preferred_prompt && (
        <p className="text-sm text-text-main mb-2">{highlightPhrase(node.preferred_prompt, "goes well", "font-bold text-green-primary")}</p>
      )}
      <div className="flex flex-col gap-2 mb-5">
        {(node.options ?? []).map((opt) => (
          <OptionButton
            key={`preferred-${String(opt.value)}`}
            label={opt.label}
            selected={preferred.has(opt.value)}
            onClick={() => toggle("preferred", opt.value)}
          />
        ))}
      </div>
      {node.forbidden_prompt && (
        <p className="text-sm text-text-main mb-2">{highlightPhrase(node.forbidden_prompt, "never pair", "font-bold text-red-600")}</p>
      )}
      <div className="flex flex-col gap-2 mb-4">
        {(node.options ?? []).map((opt) => (
          <OptionButton
            key={`forbidden-${String(opt.value)}`}
            label={opt.label}
            selected={forbidden.has(opt.value)}
            onClick={() => toggle("forbidden", opt.value)}
          />
        ))}
      </div>
      <PrimaryButton onClick={submit} loading={submitting}>
        Continue
      </PrimaryButton>
    </ScreenShell>
  );
}
