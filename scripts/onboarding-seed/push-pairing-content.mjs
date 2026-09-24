// One-off push for the 4 content sections that changed for the n_pairing_cards redesign:
// curated:pairing.sides (new nested shape), curated:cuisine.sub_cuisines + curated:cuisine.dishes
// (Angolan added), node:n_pairing_cards (new copy). Every other section generate-seed-sql.mjs
// emits is untouched by this work, so this script only pushes these 4 rather than the full 32.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "yaml";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), ".env.local") });

const here = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(here, "..", "..", "content", "onboarding");
const loadYaml = (name) => parse(readFileSync(path.join(contentDir, name), "utf8"));

function withOrder(list) {
  return list.map((opt, i) => ({ id_order: (i + 1) * 10, ...opt }));
}
function orderedMap(obj) {
  const out = {};
  for (const [key, list] of Object.entries(obj)) out[key] = withOrder(list);
  return out;
}

const nodeCopy = loadYaml("node_copy.yaml");
const cuisine = loadYaml("cuisine_curated_data.yaml");
const pairing = loadYaml("pairing_curated_data.yaml");

const pairingData = {};
for (const [broadCuisine, narrowMap] of Object.entries(pairing.sides)) {
  const narrowOut = {};
  for (const [narrowCuisine, dishMap] of Object.entries(narrowMap)) {
    const dishOut = {};
    for (const [dish, entry] of Object.entries(dishMap)) {
      dishOut[dish] = { main_label: entry.main_label, options: withOrder(entry.options) };
    }
    narrowOut[narrowCuisine] = dishOut;
  }
  pairingData[broadCuisine] = narrowOut;
}

const sections = [
  { section_id: "curated:pairing.sides", data: pairingData },
  { section_id: "curated:cuisine.sub_cuisines", data: orderedMap(cuisine.sub_cuisines) },
  { section_id: "curated:cuisine.dishes", data: orderedMap(cuisine.dishes) },
  { section_id: "node:n_pairing_cards", data: nodeCopy.nodes.n_pairing_cards },
];

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

for (const { section_id, data } of sections) {
  const { data: result, error } = await supabase
    .from("tbl_onboarding_content")
    .update({ data, updated_at: new Date().toISOString() })
    .eq("section_id", section_id)
    .select();
  if (error) {
    console.error(`FAILED ${section_id}:`, error.message);
    process.exit(1);
  }
  console.log(`OK ${section_id} — ${result.length} row(s) updated`);
}
