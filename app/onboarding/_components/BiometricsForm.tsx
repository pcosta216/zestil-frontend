"use client";

import { useState } from "react";
import { validateBiometrics, type BiometricsIssue } from "@/lib/onboarding/biometrics-validation";
import { OptionButton, PrimaryButton, Prompt, ScreenShell, SkipButton, type NodeScreenProps } from "./shared";

function issueMessage(issue: BiometricsIssue): string {
  if (issue.kind === "required") return "Pick one to continue.";
  const unit = issue.unitLabel ? ` ${issue.unitLabel}` : "";
  return `Enter a value between ${issue.min} and ${issue.max}${unit}.`;
}

// n_biometrics — whole-section skip plus independent per-field skips.
// `units` is the one field kept mandatory THE MOMENT any other field is
// filled in (cm/kg vs in/lb is meaningless otherwise) — enforced client-side
// here as a submit guard; the engine itself just writes whatever fields
// arrive, so this is a UX nicety, not a correctness requirement.
export function BiometricsForm({ node, showBack, submitting, onAnswer, onBack }: NodeScreenProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  const [touched, setTouched] = useState(false);
  const setField = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setTouched(true);
  };

  // Same rules the engine enforces on write (biometrics-validation.ts) — this side exists to
  // show them inline and keep Continue disabled, not as the only gate.
  const issues = validateBiometrics(node.fields ?? [], values);
  const issueFor = (name: string) => issues.find((i) => i.field === name);
  // Required-field complaints only surface once the user has interacted, so the screen doesn't
  // open pre-scolded; range errors show as soon as a bad number is typed.
  const visibleIssue = (name: string) => {
    const issue = issueFor(name);
    if (!issue) return undefined;
    return issue.kind === "required" && !touched ? undefined : issue;
  };

  const submit = () => {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!v) continue;
      fields[k] = k === "age" || k === "height" || k === "weight" ? Number(v) : v;
    }
    onAnswer({ fields });
  };

  return (
    <ScreenShell showBack={showBack} onBack={onBack}>
      <Prompt text={node.prompt} />
      <div className="flex flex-col gap-5 mb-4">
        {(node.fields ?? []).map((field) => (
          <div key={field.name}>
            <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">
              {field.label ?? field.name}
              {!field.optional && " *"}
            </label>
            {field.type === "single_select" ? (
              <div className="flex flex-col gap-2">
                {(field.options ?? []).map((opt) => (
                  <OptionButton
                    key={String(opt.value)}
                    label={opt.label}
                    selected={values[field.name] === opt.value}
                    onClick={() => setField(field.name, String(opt.value))}
                  />
                ))}
              </div>
            ) : (
              <input
                type="number"
                inputMode="decimal"
                value={values[field.name] ?? ""}
                onChange={(e) => setField(field.name, e.target.value)}
                className="w-full bg-white border border-[rgba(0,0,0,0.1)] rounded-xl px-4 py-3 text-sm text-text-main outline-none focus:border-green-mid transition-colors"
              />
            )}
            {visibleIssue(field.name) && (
              <p className="text-xs text-red-600 mt-1.5">{issueMessage(visibleIssue(field.name)!)}</p>
            )}
          </div>
        ))}
      </div>
      <PrimaryButton onClick={submit} disabled={issues.length > 0} loading={submitting}>
        Continue
      </PrimaryButton>
      {/* Gated on node.optional like every other component — n_biometrics dropped that flag when
          units/gender became required, so no skip renders here now. */}
      {node.optional && <SkipButton onClick={() => onAnswer({ skipped: true })} label={node.skip_label} loading={submitting} />}
    </ScreenShell>
  );
}
