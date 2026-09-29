// Does the deployed agent actually dispatch on `protein_source` / `carb_source` / `fat_source`?
//
// MACRO_SOURCES_FRONTEND.md §8 says the backend is built but "config not yet confirmed deployed,
// not yet live-tested from either side", and warns those exact slugs are unconfirmed. The
// function 400s on anything off its OWN hardcoded allowlist, and a 400 doesn't fail loudly here
// — validate-other.ts degrades it to a synthetic flag, so every typed entry would come back
// "we couldn't check this, mind confirming?" instead of a verdict. Ask the function first.
//
// Same shape as probe-diet-style-section.mjs. Re-run after any allowlist change.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding-validator-agent`;
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data: auth, error } = await anon.auth.signInWithPassword({
  email: "doe@gmail.com",
  password: "diagnostic-reset-pw-123!",
});
if (error) throw error;
const token = auth.session.access_token;
const userId = auth.user.id;

// `intolerances` is the control — it proves auth and payload are fine, so any 400 below is
// specifically the section allowlist. The rest are the documented slugs plus the names this
// flow currently sends, in case the backend settled on those instead.
const PROBES = [
  ["intolerances", {}, ["lactose", "chair"]],
  ["protein_source", { carb_sources: [], fat_sources: [] }, ["salmon", "rocks"]],
  ["carb_source", { protein_sources: [], fat_sources: [] }, ["black beans", "game meat"]],
  ["fat_source", { protein_sources: ["poultry"], carb_sources: [] }, ["olive oil", "poultry"]],
  ["accepted_protein", {}, ["salmon"]],
  ["accepted_carbs", {}, ["cassava"]],
  ["accepted_fat", {}, ["ghee"]],
];

for (const [section, context, entries] of PROBES) {
  const started = Date.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId, section, context, entries }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 300);
  }
  const summary = parsed?.results
    ? parsed.results
        .map((r) => `${r.entry}=${r.verdict}${r.value ? `(${r.value})` : ""}${r.reason ? ` "${r.reason.slice(0, 80)}"` : ""}`)
        .join("\n" + " ".repeat(34))
    : JSON.stringify(parsed).slice(0, 300);
  console.log(`${String(section).padEnd(16)} HTTP ${res.status} ${String(Date.now() - started).padStart(6)}ms  ${summary}`);
}
