import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const NEW_PROMPT =
  "A few numbers help us size your macros properly. Units and gender we need; age, height and weight you can leave blank if you'd rather not share. (Used only to shape your meal plan, never sold or shared.)\n";

const { data: row, error: readErr } = await supabase
  .from("tbl_onboarding_content")
  .select("data")
  .eq("section_id", "node:n_biometrics")
  .single();
if (readErr) throw readErr;

console.log("BEFORE prompt:", JSON.stringify(row.data.prompt));
const fieldKeysBefore = Object.keys(row.data.fields ?? {});

// Read-modify-write the whole `data` object so the fields map is carried over untouched.
const next = { ...row.data, prompt: NEW_PROMPT };

const { error: writeErr } = await supabase
  .from("tbl_onboarding_content")
  .update({ data: next, updated_at: new Date().toISOString() })
  .eq("section_id", "node:n_biometrics");
if (writeErr) throw writeErr;

const { data: after, error: verifyErr } = await supabase
  .from("tbl_onboarding_content")
  .select("data")
  .eq("section_id", "node:n_biometrics")
  .single();
if (verifyErr) throw verifyErr;

console.log("AFTER  prompt:", JSON.stringify(after.data.prompt));
const fieldKeysAfter = Object.keys(after.data.fields ?? {});
console.log("fields preserved:", JSON.stringify(fieldKeysBefore) === JSON.stringify(fieldKeysAfter), fieldKeysAfter);
