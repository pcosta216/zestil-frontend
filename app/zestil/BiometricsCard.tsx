"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { validateBiometrics, type BiometricsIssue } from "@/lib/onboarding/biometrics-validation";
import type { RenderedField, Units } from "@/lib/onboarding/types";
import { convertMeasurement, saveBiometrics, type BiometricsValues, type ProfileBiometrics } from "@/lib/profile";
import { EditButton } from "./EditButton";
import { PROFILE_DIVIDER, PROFILE_ROW, ProfileCard } from "./ProfileCard";

// The Profile tab's "About you" card: n_biometrics' five fields, edited in place. The pencil or a
// row turns each row's value into its control, beside the same label, so the card keeps its shape.
// Labels, options and bounds are the onboarding screen's own and validateBiometrics is the same, so
// the two screens can't disagree about what's valid.

type Draft = Record<keyof BiometricsValues, string>;

const KEYS: (keyof BiometricsValues)[] = ["units", "gender", "age", "height", "weight"];
const SELECTS = new Set<keyof BiometricsValues>(["units", "gender"]);

function toDraft(values: BiometricsValues): Draft {
  return Object.fromEntries(KEYS.map((k) => [k, values[k] === null ? "" : String(values[k])])) as Draft;
}

function fromDraft(draft: Draft): BiometricsValues {
  return Object.fromEntries(
    KEYS.map((k) => {
      const v = draft[k].trim();
      return [k, !v ? null : SELECTS.has(k) ? v : Number(v)];
    })
  ) as unknown as BiometricsValues;
}

const isUnits = (v: unknown): v is Units => v === "metric" || v === "imperial";

function issueMessage(issue: BiometricsIssue): string {
  if (issue.kind === "required") return "Pick one.";
  const unit = issue.unitLabel ? ` ${issue.unitLabel}` : "";
  return `Enter a value between ${issue.min} and ${issue.max}${unit}.`;
}

/** An option's label or a measurement with its unit; null when the field has no value. */
function displayValue(field: RenderedField, values: BiometricsValues): string | null {
  const value = values[field.name as keyof BiometricsValues];
  if (value === null || value === undefined) return null;
  if (field.type === "single_select") return field.options?.find((o) => o.value === value)?.label ?? String(value);
  const unit = values.units ? field.range_by_unit?.[values.units]?.label : undefined;
  return unit ? `${value} ${unit}` : String(value);
}

export function BiometricsCard({ biometrics }: { biometrics: ProfileBiometrics | null }) {
  const router = useRouter();
  const [saved, setSaved] = useState<BiometricsValues | null>(biometrics?.values ?? null);
  const [draft, setDraft] = useState<Draft | null>(null); // null while not editing
  const [focusField, setFocusField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!biometrics || !saved) {
    return (
      <ProfileCard title="About you">
        <p className="text-sm text-text-muted mt-2">Couldn&apos;t load your details. Reload to try again.</p>
      </ProfileCard>
    );
  }

  const { fields } = biometrics;
  const issues = draft ? validateBiometrics(fields, draft) : [];
  const changed = draft ? KEYS.some((k) => fromDraft(draft)[k] !== saved[k]) : false;

  // Switching units converts the measurements already typed rather than leaving 180 (cm) to
  // read as 180 in. Only from a known system: with no units yet, the numbers have none to convert from.
  const setField = (name: keyof BiometricsValues, value: string) =>
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [name]: value };
      if (name === "units" && isUnits(d.units) && isUnits(value) && d.units !== value) {
        next.height = convertMeasurement("height", d.height, value);
        next.weight = convertMeasurement("weight", d.weight, value);
      }
      return next;
    });

  const startEditing = (field: string | null) => {
    setDraft(toDraft(saved));
    setFocusField(field);
    setError(null);
  };

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      setSaved(await saveBiometrics(fromDraft(draft)));
      setDraft(null);
      // The page's props carry the old values; a back navigation would bring them back.
      router.refresh();
    } catch {
      setError("Couldn't save your details. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // Both modes use the same row shape (PROFILE_ROW, in one PROFILE_DIVIDER wrapper), tall enough
  // for a control, so editing doesn't move the labels.
  return (
    <ProfileCard title="About you" action={!draft && <EditButton label="Edit about you" onClick={() => startEditing(null)} />}>

      <div className="mt-1">
        {fields.map((field) => {
          const name = field.name as keyof BiometricsValues;
          const label = field.label ?? field.name;

          if (!draft) {
            // Every row opens the editor too, on its own field, so tapping a value edits it.
            const shown = displayValue(field, saved);
            return (
              <div key={field.name} className={PROFILE_DIVIDER}>
                <button type="button" onClick={() => startEditing(field.name)} className={PROFILE_ROW}>
                  <span className="text-sm text-text-muted">{label}</span>
                  <span className={`text-sm text-right ${shown ? "text-text-main" : "text-text-muted"}`}>{shown ?? "Not set"}</span>
                </button>
              </div>
            );
          }

          const id = `biometrics-${field.name}`;
          const issue = issues.find((i) => i.field === field.name);
          const unit = isUnits(draft.units) ? field.range_by_unit?.[draft.units]?.label : undefined;
          return (
            <div key={field.name} className={PROFILE_DIVIDER}>
              <div className={PROFILE_ROW}>
                {field.type === "single_select" ? (
                  <>
                    <span id={id} className="text-sm text-text-muted">{label}</span>
                    <div role="group" aria-labelledby={id} className="flex flex-wrap justify-end gap-1.5">
                      {(field.options ?? []).map((opt) => {
                        const selected = draft[name] === opt.value;
                        return (
                          <button
                            key={String(opt.value)}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setField(name, String(opt.value))}
                            className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${
                              selected
                                ? "bg-green-light border-green-border text-text-main"
                                : "bg-white border-[rgba(0,0,0,0.08)] text-text-main hover:border-green-border"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <label htmlFor={id} className="text-sm text-text-muted">{label}</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id={id}
                        type="number"
                        inputMode="decimal"
                        autoFocus={focusField === field.name}
                        value={draft[name]}
                        onChange={(e) => setField(name, e.target.value)}
                        className="w-20 h-8 bg-white border border-[rgba(0,0,0,0.1)] rounded-lg px-2.5 py-0 text-sm text-right text-text-main outline-none focus:border-green-mid transition-colors"
                      />
                      {/* Kept for unitless age too, so the inputs line up. */}
                      <span className="w-6 text-sm text-text-muted">{unit}</span>
                    </div>
                  </>
                )}
              </div>
              {issue && <p className="text-xs text-red-600 text-right -mt-0.5 pb-2">{issueMessage(issue)}</p>}
            </div>
          );
        })}
      </div>

      {draft && (
        <>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          <div className="flex gap-2 mt-3 mb-1">
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={saving}
              className="flex-1 bg-white border border-[rgba(0,0,0,0.1)] text-text-main rounded-xl py-2.5 text-sm font-medium hover:border-green-border transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || issues.length > 0 || !changed}
              className="flex-1 bg-green-primary text-white rounded-xl py-2.5 text-sm font-medium hover:bg-green-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </ProfileCard>
  );
}
