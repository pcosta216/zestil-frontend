#!/usr/bin/env node
// Static cross-reference check for content/onboarding/*.yaml — catches
// typos in node ids, DB section references, and memory paths before any
// UI/engine work is built on top of them. Doesn't touch the DB (works
// whether or not the migration has been applied yet); the seed row/option
// COUNTS are separately verified against the live DB after migrating (see
// the plan's Verification section).
//
//   node scripts/onboarding-seed/validate-flow.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(here, "..", "..", "content", "onboarding");
const load = (name) => parse(readFileSync(path.join(contentDir, name), "utf8"));

const flow = load("flow-structure.yaml");
const nodeCopy = load("node_copy.yaml");
const cuisine = load("cuisine_curated_data.yaml");
const intolerance = load("intolerance_curated_data.yaml");
const pairing = load("pairing_curated_data.yaml");
const dietMacro = load("diet_macro_curated_data.yaml");
const allergyMacro = load("allergy_macro_curated_data.yaml");
const intoleranceMacro = load("intolerance_macro_curated_data.yaml");

const errors = [];
const nodeIds = new Set(flow.nodes.map((n) => n.id));

// Known DB section ids, derived the same way generate-seed-sql.mjs builds them.
const knownSections = new Set([
  "content:days_of_week",
  ...flow.nodes.map((n) => `node:${n.id}`),
  "curated:cuisine.sub_cuisines",
  "curated:cuisine.dishes",
  "curated:intolerance.common",
  "curated:intolerance.by_allergen",
  "curated:pairing.sides",
  "curated:diet_macro.exclusions",
  "curated:allergy_macro.exclusions",
  "curated:intolerance_macro.exclusions",
]);

const TOP_LEVEL_KEYS = new Set([
  "profile", "taste_profile", "dietary", "cooking_profile",
  "meal_planning_preferences", "explorer_handoff", "planning_history",
]);

function checkPath(p, ctx) {
  if (typeof p !== "string") return;
  const first = p.split(".")[0];
  if (!TOP_LEVEL_KEYS.has(first)) errors.push(`${ctx}: unknown top-level memory key "${first}" in path "${p}"`);
}

for (const node of flow.nodes) {
  const ctx = `node "${node.id}"`;

  // next / branches
  if (node.next && node.next !== null && !nodeIds.has(node.next)) {
    errors.push(`${ctx}: next "${node.next}" is not a known node id`);
  }
  for (const b of node.branches ?? []) {
    if (!nodeIds.has(b.next)) errors.push(`${ctx}: branch next "${b.next}" is not a known node id`);
  }

  // writes_to / repeat_for / skip_if-ish paths
  if (typeof node.writes_to === "string") checkPath(node.writes_to, ctx);
  else if (node.writes_to && typeof node.writes_to === "object") {
    for (const v of Object.values(node.writes_to)) checkPath(v, ctx);
  }
  if (node.repeat_for) checkPath(node.repeat_for, ctx);
  if (node.free_text_note_field) checkPath(node.free_text_note_field, ctx);
  for (const p of node.editable_fields ?? []) checkPath(p, ctx);
  for (const inf of node.infer ?? []) checkPath(inf.path, ctx);

  // options_filter
  if (node.options_filter) {
    checkPath(node.options_filter.exclude_source, ctx);
    if (!knownSections.has(node.options_filter.lookup_section)) {
      errors.push(`${ctx}: options_filter.lookup_section "${node.options_filter.lookup_section}" not a known DB section`);
    }
    for (const source of node.options_filter.hard_exclude_sources ?? []) {
      checkPath(source.exclude_source, ctx);
      if (!knownSections.has(source.lookup_section)) {
        errors.push(`${ctx}: options_filter.hard_exclude_sources lookup_section "${source.lookup_section}" not a known DB section`);
      }
    }
  }

  // sample_from
  if (node.sample_from) {
    checkPath(node.sample_from.source, ctx);
    checkPath(node.sample_from.sample_field, ctx);
    checkPath(node.sample_from.source_snapshot_field, ctx);
    if (!knownSections.has(node.sample_from.pool_section)) {
      errors.push(`${ctx}: sample_from.pool_section "${node.sample_from.pool_section}" not a known DB section`);
    }
    if (node.repeat_for !== node.sample_from.sample_field) {
      errors.push(`${ctx}: repeat_for "${node.repeat_for}" must match sample_from.sample_field "${node.sample_from.sample_field}"`);
    }
  }

  // options_source: resolution_order / always_merge / section / from_node_options
  const os = node.options_source;
  if (os) {
    for (const tier of os.resolution_order ?? []) {
      if (tier.type === "curated_lookup" && !knownSections.has(tier.section)) {
        errors.push(`${ctx}: resolution_order curated_lookup section "${tier.section}" not a known DB section`);
      }
    }
    if (os.always_merge && !knownSections.has(os.always_merge.section)) {
      errors.push(`${ctx}: always_merge.section "${os.always_merge.section}" not a known DB section`);
    }
    if (os.section && !knownSections.has(os.section)) {
      errors.push(`${ctx}: options_source.section "${os.section}" not a known DB section`);
    }
    if (os.from_node_options && !nodeIds.has(os.from_node_options)) {
      errors.push(`${ctx}: options_source.from_node_options "${os.from_node_options}" not a known node id`);
    }
    if (os.from_memory_list) checkPath(os.from_memory_list.path, ctx);
  }

  // fields (biometrics_form / day_meal_picker)
  for (const field of node.fields ?? []) {
    const fos = field.options_source;
    if (fos?.section && !knownSections.has(fos.section)) {
      errors.push(`${ctx}: field "${field.name}" options_source.section "${fos.section}" not a known DB section`);
    }
    if (fos?.from_node_options && !nodeIds.has(fos.from_node_options)) {
      errors.push(`${ctx}: field "${field.name}" options_source.from_node_options "${fos.from_node_options}" not a known node id`);
    }
    if (fos?.from_memory_list) checkPath(fos.from_memory_list.path, `${ctx} field "${field.name}"`);
  }

  // every node must have a node_copy entry (content row)
  if (!nodeCopy.nodes[node.id]) errors.push(`${ctx}: no matching entry in node_copy.yaml`);
}

// node_copy shouldn't have orphan entries either
for (const id of Object.keys(nodeCopy.nodes)) {
  if (!nodeIds.has(id)) errors.push(`node_copy.yaml has entry "${id}" with no matching node in flow-structure.yaml`);
}

// curated tables: every sub_cuisine key referenced by cuisine.dishes should exist in sub_cuisines (minus "other")
const allSubCuisineValues = new Set(
  Object.values(cuisine.sub_cuisines).flat().map((o) => o.value).filter((v) => v !== "other")
);
for (const key of Object.keys(cuisine.dishes)) {
  if (!allSubCuisineValues.has(key)) errors.push(`cuisine_curated_data.yaml: dishes key "${key}" has no matching sub_cuisines value`);
}
for (const v of allSubCuisineValues) {
  if (!cuisine.dishes[v]) errors.push(`cuisine_curated_data.yaml: sub_cuisines value "${v}" has no matching dishes entry`);
}

// pairing.sides: fully independent of cuisine_curated_data.yaml's own dishes table (see
// pairing_curated_data.yaml's header — n_pairing_cards samples its OWN curated pool, never
// reads favorite_dishes) — so top-level keys are checked against the broad-cuisine set instead
// (sub_cuisines' own top-level keys, per that file's "7 broad cuisines" convention), every dish
// key must be unique across the WHOLE file (sample_from caches a bare dish value with no
// cuisine qualifier — see types.ts's SampleFromStructure), and every dish must have exactly 4
// options (the format this node's two-question multi_select screen was sized for).
const knownBroadCuisines = new Set(Object.keys(cuisine.sub_cuisines));
const seenPairingDishKeys = new Map(); // dish key -> "broad/narrow" path, for a useful duplicate message
for (const [broadCuisine, narrowMap] of Object.entries(pairing.sides)) {
  if (!knownBroadCuisines.has(broadCuisine)) {
    errors.push(`pairing_curated_data.yaml: top-level key "${broadCuisine}" is not a broad cuisine in cuisine_curated_data.yaml`);
  }
  for (const [narrowCuisine, dishMap] of Object.entries(narrowMap)) {
    for (const [dish, entry] of Object.entries(dishMap)) {
      const path = `${broadCuisine}.${narrowCuisine}`;
      if (seenPairingDishKeys.has(dish)) {
        errors.push(`pairing_curated_data.yaml: dish key "${dish}" appears more than once (${seenPairingDishKeys.get(dish)} and ${path}) — must be unique across the whole file`);
      } else {
        seenPairingDishKeys.set(dish, path);
      }
      if (!Array.isArray(entry.options) || entry.options.length !== 4) {
        errors.push(`pairing_curated_data.yaml: dish "${dish}" (${path}) has ${entry.options?.length ?? 0} options, expected exactly 4`);
      }
    }
  }
}

// diet_macro should cover exactly the 9 n_diet_style_cards option values
const dietStyleValues = new Set(nodeCopy.nodes.n_diet_style_cards.options.map((o) => o.value));
const dietMacroKeys = new Set(Object.keys(dietMacro.diet_macro_exclusions));
for (const v of dietStyleValues) {
  if (!dietMacroKeys.has(v)) errors.push(`diet_macro_curated_data.yaml: missing entry for diet style "${v}"`);
}
for (const k of dietMacroKeys) {
  if (!dietStyleValues.has(k)) errors.push(`diet_macro_curated_data.yaml: entry "${k}" is not a value in n_diet_style_cards' options`);
}

// allergy_macro should cover exactly the n_allergies option values
const allergyValues = new Set(nodeCopy.nodes.n_allergies.options.map((o) => o.value));
const allergyMacroKeys = new Set(Object.keys(allergyMacro.allergy_macro_exclusions));
for (const v of allergyValues) {
  if (!allergyMacroKeys.has(v)) errors.push(`allergy_macro_curated_data.yaml: missing entry for allergy "${v}"`);
}
for (const k of allergyMacroKeys) {
  if (!allergyValues.has(k)) errors.push(`allergy_macro_curated_data.yaml: entry "${k}" is not a value in n_allergies' options`);
}

// intolerance_macro should cover exactly every distinct value across intolerance.common + by_allergen
const intoleranceValues = new Set([
  ...intolerance.common.map((o) => o.value),
  ...Object.values(intolerance.by_allergen).flat().map((o) => o.value),
]);
const intoleranceMacroKeys = new Set(Object.keys(intoleranceMacro.intolerance_macro_exclusions));
for (const v of intoleranceValues) {
  if (!intoleranceMacroKeys.has(v)) errors.push(`intolerance_macro_curated_data.yaml: missing entry for intolerance value "${v}"`);
}
for (const k of intoleranceMacroKeys) {
  if (!intoleranceValues.has(k)) errors.push(`intolerance_macro_curated_data.yaml: entry "${k}" is not a value in intolerance_curated_data.yaml`);
}

// diet_macro's excluded+allowed must be complementary for every diet × macro — every value in
// the matching n_*_exclusion_cards option list appears in EXACTLY one of the two, no gaps, no
// overlap. Previously just a hand-verified claim in this file's header comment; checked here
// programmatically so a future addition (e.g. a new protein option) can't silently leave some
// diet's block stale.
const macroOptionValues = {
  protein: new Set(nodeCopy.nodes.n_protein_exclusion_cards.options.map((o) => o.value)),
  carbs: new Set(nodeCopy.nodes.n_carb_exclusion_cards.options.map((o) => o.value)),
  fat: new Set(nodeCopy.nodes.n_fat_exclusion_cards.options.map((o) => o.value)),
};
for (const [diet, macros] of Object.entries(dietMacro.diet_macro_exclusions)) {
  for (const [macro, allValues] of Object.entries(macroOptionValues)) {
    const block = macros[macro];
    if (!block) {
      errors.push(`diet_macro_curated_data.yaml: "${diet}" is missing a "${macro}" block`);
      continue;
    }
    const excluded = new Set(block.excluded ?? []);
    const allowed = new Set(block.allowed ?? []);
    for (const v of allValues) {
      const inExcluded = excluded.has(v);
      const inAllowed = allowed.has(v);
      if (!inExcluded && !inAllowed) errors.push(`diet_macro_curated_data.yaml: "${diet}".${macro} is missing "${v}" (not in excluded or allowed)`);
      if (inExcluded && inAllowed) errors.push(`diet_macro_curated_data.yaml: "${diet}".${macro} has "${v}" in BOTH excluded and allowed`);
    }
    for (const v of [...excluded, ...allowed]) {
      if (!allValues.has(v)) errors.push(`diet_macro_curated_data.yaml: "${diet}".${macro} has "${v}", not a real ${macro} option value`);
    }
  }
}

if (errors.length) {
  console.error(`${errors.length} problem(s) found:\n`);
  for (const e of errors) console.error(" -", e);
  process.exit(1);
} else {
  console.log(`OK — ${flow.nodes.length} nodes, ${knownSections.size} known content sections, no cross-reference errors.`);
}
