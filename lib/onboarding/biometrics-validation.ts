import type { FieldStructure } from "./types";

// Shared by BiometricsForm.tsx (inline errors + disabled Continue) and engine.ts (refuses to
// write anything that fails). Deliberately dependency-free — no server-only imports — so the
// exact same rules run on both sides rather than the client's being the only gate. Returns
// structured issues rather than prose so the copy stays in the component; the engine only
// cares whether a field has an issue at all.

export type BiometricsIssue =
  | { field: string; kind: "required" }
  | { field: string; kind: "out_of_range"; min: number; max: number; unitLabel?: string };

/** Resolves a number field's bounds — fixed (age) or per-unit (height/weight). Undefined when the field has none, or when a per-unit field has no units picked yet to resolve against. */
function boundsFor(field: FieldStructure, units: unknown): { min: number; max: number; label?: string } | undefined {
  if (field.range_by_unit) {
    if (typeof units !== "string") return undefined; // units not chosen yet — flagged on its own field
    return field.range_by_unit[units];
  }
  if (field.min !== undefined && field.max !== undefined) {
    return { min: field.min, max: field.max };
  }
  return undefined;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * `values` is the raw per-field map (strings straight off the inputs, or already-coerced
 * numbers from a submitted answer) keyed by field name.
 */
export function validateBiometrics(fields: FieldStructure[], values: Record<string, unknown>): BiometricsIssue[] {
  const issues: BiometricsIssue[] = [];
  const units = values.units;

  for (const field of fields) {
    const value = values[field.name];

    if (isBlank(value)) {
      if (!field.optional) issues.push({ field: field.name, kind: "required" });
      continue; // an optional field left blank is fine — nothing to range-check
    }

    if (field.type !== "number") continue;

    const numeric = typeof value === "number" ? value : Number(String(value).trim());
    const bounds = boundsFor(field, units);
    if (!Number.isFinite(numeric)) {
      // Not a usable number at all. Report it against whatever bounds exist so the message can
      // still say what's expected; fall back to a bare required-style complaint if it has none.
      if (bounds) issues.push({ field: field.name, kind: "out_of_range", min: bounds.min, max: bounds.max, unitLabel: bounds.label });
      else issues.push({ field: field.name, kind: "required" });
      continue;
    }
    if (!bounds) continue;
    if (numeric < bounds.min || numeric > bounds.max) {
      issues.push({ field: field.name, kind: "out_of_range", min: bounds.min, max: bounds.max, unitLabel: bounds.label });
    }
  }

  return issues;
}
