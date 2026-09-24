// Re-keys curated:pairing.sides' top-level region keys onto the single region vocabulary now
// used by n_cuisine_broad, tbl_cuisines_onboarding and the validator agent.
//
// Only the TOP-LEVEL keys move. flattenCuisinePool (lib/onboarding/pairing.ts) reads
// section[region] and flattens everything below it, so the sub-cuisine keys underneath are
// organisational and stay as they are.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const RENAME = {
  asian: "asia_oceania",
  latin_american: "central_latin_america",
  middle_eastern: "middle_east",
  african: "africa",
  european: "europe",
  american: "north_america",
};

const { data: row, error: readErr } = await supabase
  .from("tbl_onboarding_content")
  .select("data")
  .eq("section_id", "curated:pairing.sides")
  .single();
if (readErr) throw readErr;

const before = Object.keys(row.data);
console.log("BEFORE keys:", JSON.stringify(before));

// Idempotent: a key already in the new vocabulary is carried over untouched.
const next = {};
let renamed = 0;
for (const [key, value] of Object.entries(row.data)) {
  const target = RENAME[key] ?? key;
  if (target !== key) renamed++;
  if (next[target]) throw new Error(`refusing to write: "${target}" would collide`);
  next[target] = value;
}

if (renamed === 0) {
  console.log("nothing to rename — already on the new vocabulary");
  process.exit(0);
}

// Dish counts must survive the rename exactly; a mismatch means data was lost.
const countDishes = (section) =>
  Object.values(section).reduce(
    (total, narrowMap) => total + Object.values(narrowMap).reduce((n, dishMap) => n + Object.keys(dishMap).length, 0),
    0
  );
const beforeCount = countDishes(row.data);
const afterCount = countDishes(next);
if (beforeCount !== afterCount) throw new Error(`dish count changed: ${beforeCount} -> ${afterCount}`);

const { error: writeErr } = await supabase
  .from("tbl_onboarding_content")
  .update({ data: next, updated_at: new Date().toISOString() })
  .eq("section_id", "curated:pairing.sides");
if (writeErr) throw writeErr;

const { data: after } = await supabase
  .from("tbl_onboarding_content")
  .select("data")
  .eq("section_id", "curated:pairing.sides")
  .single();
console.log("AFTER  keys:", JSON.stringify(Object.keys(after.data)));
console.log(`renamed ${renamed} key(s); dishes preserved: ${countDishes(after.data)} (was ${beforeCount})`);
