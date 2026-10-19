import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderNodeBase } from "@/lib/onboarding/render-node";
import { validateBiometrics } from "@/lib/onboarding/biometrics-validation";
import { DISPLAY_NAME_MAX, normalizeDisplayName, type BiometricsValues } from "@/lib/profile";

const BIOMETRICS_FIELDS = ["units", "gender", "age", "height", "weight"] as const;

// PATCH /api/profile — the Profile tab's two edits, one per request:
//  - { display_name }  → tbl_user_profiles.display_name, trimmed; "" clears it to null
//  - { biometrics: { units, gender, age, height, weight } } → those five fields of memory_json
//    via update_memory_biometrics, which writes nothing else in it. null clears an optional one.
// Biometrics are checked against n_biometrics' own fields, the bounds the onboarding form and
// engine use, plus the units/gender option lists, which the onboarding write path never checks.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }
  const hasName = "display_name" in body;
  const hasBiometrics = "biometrics" in body;
  if (hasName === hasBiometrics) {
    return NextResponse.json({ error: "Send either display_name or biometrics" }, { status: 400 });
  }

  try {
    if (hasName) {
      const raw = (body as { display_name: unknown }).display_name;
      if (typeof raw !== "string") return NextResponse.json({ error: "display_name must be a string" }, { status: 400 });
      const name = normalizeDisplayName(raw);
      if (name && name.length > DISPLAY_NAME_MAX) {
        return NextResponse.json({ error: `display_name is longer than ${DISPLAY_NAME_MAX} characters` }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("tbl_user_profiles")
        .update({ display_name: name })
        .eq("account_key", user.id)
        .select("account_key");
      if (error) throw new Error(error.message);
      if (!data?.length) return NextResponse.json({ error: "No profile row for this user" }, { status: 404 });
      return NextResponse.json({ display_name: name });
    }

    const raw = (body as { biometrics: unknown }).biometrics;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "biometrics must be an object" }, { status: 400 });
    }
    const input = raw as Record<string, unknown>;
    const values: Record<string, unknown> = Object.fromEntries(BIOMETRICS_FIELDS.map((f) => [f, input[f] ?? null]));

    const { fields = [] } = await renderNodeBase("n_biometrics");
    const invalid = new Set(validateBiometrics(fields, values).map((issue) => issue.field));
    for (const field of fields) {
      const value = values[field.name];
      if (value === null || value === undefined) continue;
      if (field.type === "number" && typeof value !== "number") invalid.add(field.name);
      if (field.type === "single_select" && !(field.options ?? []).some((o) => o.value === value)) invalid.add(field.name);
    }
    if (invalid.size > 0) {
      return NextResponse.json({ error: `Invalid biometrics: ${[...invalid].join(", ")}` }, { status: 400 });
    }

    const saved = values as unknown as BiometricsValues;
    const { error } = await supabase.rpc("update_memory_biometrics", {
      p_units: saved.units,
      p_gender: saved.gender,
      p_age: saved.age,
      p_height: saved.height,
      p_weight: saved.weight,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ biometrics: saved });
  } catch (err) {
    console.error("[profile]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save profile" }, { status: 500 });
  }
}
