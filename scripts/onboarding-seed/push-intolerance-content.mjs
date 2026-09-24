// One-off push for the 3 content sections that changed for n_intolerances' "I don't have any"
// option: curated:intolerance.common (new option), curated:intolerance_macro.exclusions (new
// entry for it), node:n_intolerances (dropped the now-dead skip_label).

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

const nodeCopy = loadYaml("node_copy.yaml");
const intolerance = loadYaml("intolerance_curated_data.yaml");
const intoleranceMacro = loadYaml("intolerance_macro_curated_data.yaml");

const sections = [
  { section_id: "curated:intolerance.common", data: { options: withOrder(intolerance.common) } },
  { section_id: "curated:intolerance_macro.exclusions", data: intoleranceMacro.intolerance_macro_exclusions },
  { section_id: "node:n_intolerances", data: nodeCopy.nodes.n_intolerances },
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
