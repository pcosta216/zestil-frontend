import type { Gender, RenderedField, Units, UserMemory } from "@/lib/onboarding/types";

// The Profile tab's two edits: the display name (tbl_user_profiles) and the five biometrics
// fields of memory_json (profile.locale.units, profile.biometrics.{gender,age,height,weight}).
// Shared by the tab (app/zestil/) and its route (app/api/profile/), so both sides agree on the
// shapes and the name rules. Client-safe: no server imports.

export const DISPLAY_NAME_MAX = 60;

/** Trimmed; an empty name clears it (null), which the tab shows as "No name set". */
export function normalizeDisplayName(raw: string): string | null {
  return raw.trim() || null;
}

export interface BiometricsValues {
  units: Units | null;
  gender: Gender | null;
  age: number | null;
  height: number | null;
  weight: number | null;
}

/** The biometrics card's data: n_biometrics' own fields (labels, options, bounds) and the stored values. */
export interface ProfileBiometrics {
  fields: RenderedField[];
  values: BiometricsValues;
}

/**
 * One row of a read-only card: `items` show as chips, `text` as plain text, and a row with neither
 * shows `empty` ("None", "Not set"). Built on the server with labels already resolved.
 */
export interface ProfileRow {
  label: string;
  text?: string;
  items?: string[];
  empty: string;
}

export interface ProfileSection {
  title: string;
  rows: ProfileRow[];
}

export function biometricsFromMemory(memory: UserMemory): BiometricsValues {
  const { biometrics, locale } = memory.profile;
  return {
    units: locale.units,
    gender: biometrics.gender,
    age: biometrics.age,
    height: biometrics.height,
    weight: biometrics.weight,
  };
}

const CM_PER_IN = 2.54;
const LB_PER_KG = 2.20462;

/**
 * A height or weight typed under one unit system, in the other, to the nearest whole unit:
 * what the editor shows when units switch (180 cm → 71 in → 180 cm). Blank or non-numeric
 * input, and any other field, comes back unchanged.
 */
export function convertMeasurement(field: string, value: string, to: Units): string {
  const n = Number(value.trim());
  if (!value.trim() || !Number.isFinite(n)) return value;
  let converted: number;
  if (field === "height") converted = to === "imperial" ? n / CM_PER_IN : n * CM_PER_IN;
  else if (field === "weight") converted = to === "imperial" ? n * LB_PER_KG : n / LB_PER_KG;
  else return value;
  return String(Math.round(converted));
}

async function patchProfile<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
  return data as T;
}

/** Returns the name as stored: trimmed, or null when cleared. */
export async function saveDisplayName(name: string): Promise<string | null> {
  const data = await patchProfile<{ display_name: string | null }>({ display_name: name });
  return data.display_name;
}

export async function saveBiometrics(values: BiometricsValues): Promise<BiometricsValues> {
  const data = await patchProfile<{ biometrics: BiometricsValues }>({ biometrics: values });
  return data.biometrics;
}
