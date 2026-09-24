// Which `section` string does the deployed agent actually dispatch on for the new eating-styles
// rules? The config key is `Eating_Styles`, its prompt text says `SECTION: diet_styles`, and the
// flow YAML currently sends `diet_style`. Ask the function rather than guess.
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

// `intolerances` is the control — it proves auth + payload are fine and that any 400 below is
// specifically the function's section allowlist. Re-run this after the allowlist ships.
const candidates = ["intolerances", "diet_style", "diet_styles", "Eating_Styles", "eating_styles"];
const entries = ["paleo", "carnivore diet", "chair"];

for (const section of candidates) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId, section, context: {}, entries }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 300);
  }
  const summary = parsed?.results
    ? parsed.results.map((r) => `${r.entry}=${r.verdict}${r.value ? `(${r.value})` : ""}`).join(", ")
    : JSON.stringify(parsed).slice(0, 300);
  console.log(`${String(section).padEnd(16)} HTTP ${res.status}  ${summary}`);
}
