// Throwaway engine smoke test — NOT committed as part of the app, not a
// permanent test suite (this repo has no test runner configured). Drives
// lib/onboarding/engine.ts through several scripted scenarios against the
// REAL seeded DB content (via a service-role client, since this runs
// outside a Next.js request context and has no user session/cookies to
// authenticate the normal RLS-scoped client with).
//
//   npx tsx scripts/onboarding-seed/smoke-test.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { __setContentClientForTesting } from "../../lib/onboarding/content";
import { applyAnswer, entryPoint, goBack, recalledAnswer, renderNode, resolveResumeTarget } from "../../lib/onboarding/engine";
import { findPairingDish } from "../../lib/onboarding/pairing";
import { emptyUserMemory, mergeIntoSkeleton } from "../../lib/onboarding/memory-skeleton";
import { getPath } from "../../lib/onboarding/paths";
import { DAYS_OF_WEEK, type Answer, type FlowPosition, type UserMemory } from "../../lib/onboarding/types";

// --- env + service-role client (read-only content table; see content.ts's test seam) ---
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
__setContentClientForTesting(supabase as never);

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error("FAIL:", msg);
  }
}
function assertEqual(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

type AnswerSource = Answer | Answer[] | ((item: string | undefined) => Promise<Answer>);

async function walk(memory: UserMemory, history: FlowPosition, answers: Record<string, AnswerSource>) {
  let target = await entryPoint(memory, history);
  const perNodeIndex: Record<string, number> = {};

  while (!("terminal" in target)) {
    const { nodeId, item } = target;
    const key = item ? `${nodeId}[${item}]` : nodeId;
    let answer = answers[key] ?? answers[nodeId];
    if (typeof answer === "function") {
      // n_pairing_cards: `item` is a randomly sampled dish, unknowable ahead of time — the
      // responder looks up whatever dish actually got sampled and answers it for real.
      answer = await answer(item);
    } else if (Array.isArray(answer)) {
      const idx = perNodeIndex[nodeId] ?? 0;
      perNodeIndex[nodeId] = idx + 1;
      answer = answer[idx];
    }
    if (!answer) {
      // No scripted answer for this node — render it (exercises resolvers/options_filter) then skip.
      await renderNode(nodeId, item, memory);
      answer = { skipped: true };
    }
    const result = await applyAnswer({ nodeId, item, answer, memory, history });
    memory = result.memory;
    history = result.history;
    target = result.next;
  }
  return { memory, history };
}

/**
 * Skips forward until `nodeId` is the current target, whatever is in between.
 *
 * Scenarios care about ONE node's behaviour, not about how many screens precede it, so they say
 * where they want to be rather than listing every node to skip. A hardcoded skip list silently
 * lands on the wrong node the moment the flow is reordered; this can't.
 */
async function skipUntil(nodeId: string, memory: UserMemory, history: FlowPosition, from?: FlowTargetish) {
  let mem = memory;
  let h = history;
  let target = from ?? (await entryPoint(mem, h));
  for (let i = 0; i < 30; i++) {
    if ("terminal" in target) throw new Error(`skipUntil: hit terminal before ${nodeId}`);
    if (target.nodeId === nodeId) return { mem, h, target };
    const r = await applyAnswer({ nodeId: target.nodeId, item: target.item, answer: { skipped: true }, memory: mem, history: h });
    mem = r.memory;
    h = r.history;
    target = r.next;
  }
  throw new Error(`skipUntil: never reached ${nodeId}`);
}
type FlowTargetish = { terminal: true } | { nodeId: string; item?: string };

async function scenarioFullWalkthrough() {
  console.log("\n=== Scenario A: full realistic walkthrough ===");
  const memory = emptyUserMemory();
  const history: FlowPosition = [];

  const answers: Record<string, AnswerSource> = {
    n_consent: { values: ["accept"] },
    n_biometrics: { skipped: true },
    n_goal: { values: ["lose_weight_lean_out"] },
    n_diet_style_cards: { values: ["pescatarian", "mediterranean"] }, // now multi_select/grid — preferred only, no to_avoid signal
    n_cuisine_broad: { values: ["asia_oceania"] },
    // Slugs come from tbl_cuisines_onboarding now (`thai_cuisine`, not `thai`) — see cuisines.ts.
    "n_cuisine_narrow[asia_oceania]": { values: ["thai_cuisine", "indian_cuisine"] },
    "n_dishes[thai_cuisine]": { values: ["pad_thai"] },
    "n_dishes[indian_cuisine]": { values: ["biryani"] },
    n_allergies: { values: ["nuts"] },
    n_allergy_confirm: { confirm_edit_action: "confirm" },
    n_intolerances: { values: ["lactose"], text: "small amounts of hard cheese ok" },
    n_favorite_recipes: { recipe_picks: [{ label: "Pad Thai" }, { label: "Biryani" }] },
    // sample_from picks a RANDOM dish per repeat_for iteration (see engine.ts's
    // ensureSampleComputed) — this responder answers whatever actually gets sampled rather
    // than a hardcoded dish, checking that dish's first curated side as "goes well" and its
    // second (when it has one) as "never pair", real values either way.
    n_pairing_cards: async (item) => {
      const dish = await findPairingDish(item!);
      const opts = dish?.options ?? [];
      return { values: opts[0] ? [opts[0].value] : [], left_values: opts[1] ? [opts[1].value] : [] };
    },
    // now multi_select/grid, select_all_by_default — `values` IS "I eat this" (allowed);
    // everything else in the shown (options_filter-narrowed) list becomes excluded. No more
    // left_values side to answer — poultry/red_meat/pork end up excluded here simply by NOT
    // being in values (same for bread/pasta, lard/tallow/seed_oil below).
    n_protein_exclusion_cards: { values: ["seafood", "shellfish", "plant_based_tofu", "eggs", "dairy_protein"] },
    n_carb_exclusion_cards: { values: ["rice", "potatoes", "oats", "quinoa", "corn", "legumes"] },
    n_fat_exclusion_cards: { values: ["olive_oil", "butter", "ghee", "coconut_oil", "nut_seed_fats"] },
    n_active_slots: { values: ["breakfast", "lunch", "dinner"] },
    n_week_start: { day_order_value: "monday" },
    n_fixed_meals: { day_meal_entries: [{ day_of_week: "tuesday", meal_slot: "dinner", dish_label: "Pizza" }] },
    n_summary: {},
  };

  const { memory: final } = await walk(memory, history, answers);

  assertEqual(final.taste_profile.cuisines, ["asia_oceania"], "cuisines");
  assertEqual(final.taste_profile.sub_cuisines, ["thai_cuisine", "indian_cuisine"], "sub_cuisines hold cuisine_slug values");
  assertEqual(final.taste_profile.favorite_dishes, ["pad_thai", "biryani"], "favorite_dishes");
  assertEqual(final.dietary.diet_type.preferred, ["pescatarian", "mediterranean"], "diet_type.preferred");
  assertEqual(final.dietary.diet_type.to_avoid, [], "diet_type.to_avoid stays empty — n_diet_style_cards no longer writes it (see product decision in flow-structure.yaml)");
  assertEqual(final.dietary.allergies, ["nuts"], "allergies");
  assertEqual(final.dietary.intolerances, ["lactose"], "intolerances");
  assertEqual(final.dietary.notes, "small amounts of hard cheese ok", "notes");
  assert(final.meal_planning_preferences.preferred_recipes.length === 2, "2 preferred_recipes");
  assert(final.meal_planning_preferences.preferred_recipes[0].recipe_uuid === null, "recipe_uuid null this phase (no resolve tool yet)");
  assert(final.meal_planning_preferences.macro_priority.join(",") === "protein,fat,carbs", "lose_weight macro_priority");
  assertEqual(final.meal_planning_preferences.goals_source, "user_input", "goals_source");

  // protein: pescatarian excludes [poultry,red_meat,pork], mediterranean excludes [] -> diet
  // intersection empty -> those 3 only excluded by the explicit deselection below. Separately,
  // the reported lactose intolerance hard-excludes dairy_protein (curated:intolerance_macro.
  // exclusions) — it's never actually a selectable tile, so even though the scripted answer
  // above still lists it in `values` (simulating a stale client), it must NOT land in the
  // allowed rotation — only in avoided_foods, and only once.
  assert(final.dietary.avoided_foods.includes("poultry"), "avoided_foods has poultry (deselected)");
  assert(final.dietary.avoided_foods.includes("dairy_protein"), "avoided_foods has dairy_protein (hard-excluded by the lactose intolerance, not by deselection)");
  assertEqual(
    final.dietary.avoided_foods.filter((v) => v === "dairy_protein").length,
    1,
    "dairy_protein appears exactly once in avoided_foods, not duplicated"
  );
  assertEqual(
    [...final.meal_planning_preferences.variety_rules.protein_variety.rotation].sort(),
    ["eggs", "plant_based_tofu", "seafood", "shellfish"].sort(),
    "protein rotation excludes dairy_protein — it was never a real selectable option, so the stale 'dairy_protein' in the submitted values must be filtered out, not just left uncounted"
  );
  assert(final.dietary.avoided_foods.includes("lard") && final.dietary.avoided_foods.includes("tallow") && final.dietary.avoided_foods.includes("seed_oil"), "fat exclusions present");

  assertEqual(final.meal_planning_preferences.active_slots, ["breakfast", "lunch", "dinner", "snack"], "active_slots incl. forced snack");
  assert(final.meal_planning_preferences.plan_snacks === true, "plan_snacks true");
  assertEqual(
    final.meal_planning_preferences.variety_rules.leftover_friendly,
    null,
    "leftover_friendly stays null — n_leftovers is disabled (see flow-structure.yaml), so nothing writes it"
  );
  assertEqual(final.profile.locale.week_start_day, "monday", "week_start_day");
  assertEqual(final.cooking_profile.day_constraints.tuesday.fixed_meals, [{ title: "Pizza", meal_slot: "dinner", recipe_uuid: null }], "tuesday fixed_meals");
  assertEqual(final.explorer_handoff.preferred_discovery_mode, "similar_to_favorites", "preferred_discovery_mode");

  // n_cuisine_broad selected only "asia_oceania" here — share = ceil(6/1) = 6, its curated pool
  // has 7 dishes (>= share, no top-up shortfall), so exactly 6 get sampled deterministically —
  // the only randomness is WHICH 6, not how many. The responder answers every sampled dish, so
  // both arrays land at exactly 6 entries, one per dish, each with a real recipe_uuid:null side.
  const preferredPairing = final.meal_planning_preferences.preferred_pairings;
  const forbiddenPairing = final.meal_planning_preferences.forbidden_pairings;
  assertEqual(preferredPairing.length, 6, "one preferred_pairings entry per sampled dish (6 — asian alone, share=6, pool=7)");
  assertEqual(forbiddenPairing.length, 6, "one forbidden_pairings entry per sampled dish too (every curated dish has >=2 options)");
  assert(
    preferredPairing.every((p: { sides: { recipe_uuid: string | null }[] }) => p.sides.every((s) => s.recipe_uuid === null)),
    "every side's recipe_uuid is null this phase (resolve_recipe_uuid not built yet, same stub posture as favorite_recipes/fixed_meals)"
  );
  assertEqual(final.meal_planning_preferences.pairing_sample?.length, 6, "sample_from cached exactly 6 sampled dish values");
}

async function scenarioDefaultIsTerminal() {
  console.log("\n=== Scenario B: default_if_empty is terminal, not cascading ===");
  const memory = emptyUserMemory();
  const history: FlowPosition = [];

  const answers: Record<string, Answer | Answer[]> = {
    n_consent: {},
    n_biometrics: { skipped: true },
    n_goal: { skipped: true },
    n_diet_style_cards: { skipped: true },
    n_cuisine_broad: { skipped: true }, // <- the case under test
  };

  const { memory: final, history: finalHistory } = await walk(memory, history, answers);
  // n_cuisine_broad has no default_if_empty any more: skipping records NO cuisine rather than
  // inventing `mediterranean`. The cascade below is unchanged — an empty source list produces
  // zero repeat_for iterations exactly as a defaulted one did.
  assertEqual(final.taste_profile.cuisines, [], "skipping records no cuisine at all, not an invented default");
  assertEqual(final.taste_profile.sub_cuisines, [], "sub_cuisines stays empty — narrowing never ran");
  assertEqual(final.taste_profile.favorite_dishes, [], "favorite_dishes stays empty");
  const cuisineBroadIndex = finalHistory.findIndex((h) => h.node_id === "n_cuisine_broad");
  assert(finalHistory[cuisineBroadIndex]?.default_applied !== true, "nothing was defaulted, so the entry isn't tagged default_applied");
  assert(!finalHistory.some((h) => h.node_id === "n_cuisine_narrow"), "n_cuisine_narrow never entered history (zero iterations)");
  assert(!finalHistory.some((h) => h.node_id === "n_dishes"), "n_dishes never entered history either");
  assertEqual(finalHistory[cuisineBroadIndex + 1]?.node_id, "n_favorite_recipes", "flow proceeded straight from n_cuisine_broad to n_favorite_recipes");
}

async function scenarioProteinRendersAtOneRemaining() {
  console.log("\n=== Scenario D: protein screen renders even with exactly 1 option remaining, default_if_empty resolves it on skip ===");
  const memory = emptyUserMemory();
  const history: FlowPosition = [];

  // options_filter nodes never auto-skip on cardinality anymore (checkSkip always returns
  // skip:false for them) — the screen ALWAYS renders, even down to 1 remaining option, so the
  // user sees the disabled tiles + exclusion_disclaimer + back-navigate escape hatch instead of
  // the node silently vanishing. walk()'s fallback for an unscripted node renders it then submits
  // {skipped:true} — for an optional multi_select with default_if_empty set, that resolves
  // "all_options" against the FILTERED list, landing on the exact same final memory state a
  // pre-selected select_all_by_default Continue tap would produce.
  //
  // vegan alone leaves 3 protein options now (plant_based_tofu, seitan, lentils_legumes are all
  // vegan-friendly) — not the single-item case this scenario means to test. Adding soy + gluten
  // allergies hard-excludes plant_based_tofu and seitan on top of vegan's own 7, leaving exactly
  // lentils_legumes. gluten also hard-excludes bread/pasta on the CARBS side (same allergy, real
  // cross-cutting effect, not a bug) — accounted for below rather than worked around.
  const answers: Record<string, Answer | Answer[]> = {
    n_consent: {},
    n_biometrics: { skipped: true },
    n_goal: { skipped: true },
    n_diet_style_cards: { values: ["vegan"] },
    n_cuisine_broad: { skipped: true },
    n_allergies: { values: ["soy", "gluten"] },
    // n_allergy_confirm: walk()'s default {skipped:true} fallback proceeds straight through —
    // confirm_edit's branch only diverts on answer == 'edit', so this is equivalent to confirming.
    n_intolerances: { skipped: true },
    n_favorite_recipes: { skipped: true },
    // n_pairing_cards: skip_if fires automatically (favorite_dishes empty) — no answer needed
    // n_protein_exclusion_cards: renders (1 selectable option), walk()'s fallback skips it —
    // default_if_empty resolves the 1 remaining option as allowed — no scripted answer needed
    n_carb_exclusion_cards: { values: ["rice", "potatoes", "oats", "quinoa", "corn", "legumes"] }, // bread/pasta disabled (gluten)
    // butter/ghee/lard/tallow aren't even selectable under vegan (options_filter already
    // disables these 4) — they land in avoided_foods via the diet-implied seeding block, not
    // from anything unselected here.
    n_fat_exclusion_cards: { values: ["olive_oil", "coconut_oil", "seed_oil", "nut_seed_fats"] },
    n_active_slots: { values: ["breakfast"] },
    n_week_start: { day_order_value: "sunday" },
    n_fixed_meals: { skipped: true },
    n_summary: {},
  };

  const { memory: final, history: finalHistory } = await walk(memory, history, answers);

  assertEqual(
    [...final.dietary.avoided_foods].sort(),
    [
      // protein: vegan's 7 + soy's plant_based_tofu + gluten's seitan (union, leaves 1 remaining)
      "poultry", "red_meat", "pork", "seafood", "shellfish", "eggs", "dairy_protein", "plant_based_tofu", "seitan",
      // carbs: gluten hard-excludes bread/pasta (vegan itself has no carb opinion)
      "bread", "pasta",
      // fat: vegan's diet-only exclusions
      "butter", "ghee", "lard", "tallow",
    ].sort(),
    "avoided_foods: vegan protein exclusions + gluten/soy hard-excludes (protein AND carbs) + vegan fat exclusions"
  );
  assertEqual(final.meal_planning_preferences.variety_rules.protein_variety.rotation, ["lentils_legumes"], "protein rotation resolved to the 1 remaining category via default_if_empty");
  assertEqual([...final.meal_planning_preferences.variety_rules.carb_variety.rotation].sort(), ["corn", "oats", "potatoes", "quinoa", "rice", "legumes"].sort(), "carb rotation excludes bread/pasta (gluten) — 6 remaining, an ordinary render+skip, no special casing either");
  const proteinEntry = finalHistory.find((h) => h.node_id === "n_protein_exclusion_cards");
  assert(proteinEntry !== undefined, "n_protein_exclusion_cards gets a normal history entry — it rendered and was answered like any other node");
  assert(proteinEntry?.default_applied === true, "entry tagged default_applied (skip fell through to default_if_empty, not a real selection)");
  assert(!finalHistory.some((h) => h.node_id === "n_pairing_cards"), "n_pairing_cards (plain skip_if, no side effect) never entered history — contrasts with an options_filter node, which always renders and always gets an entry");
}

async function scenarioOtherCaptureSplit() {
  console.log("\n=== Scenario E: other_capture comma-split ===");
  const memory = emptyUserMemory();
  const history: FlowPosition = [];
  const answers: Record<string, Answer | Answer[]> = {
    n_consent: {},
    n_biometrics: { skipped: true },
    n_goal: { skipped: true },
    n_diet_style_cards: { skipped: true },
    n_cuisine_broad: { skipped: true },
    n_allergies: { values: ["other"], other_text: "sesame, mustard seed" },
  };
  const { memory: final } = await walk(memory, history, answers);
  assertEqual(final.dietary.allergies, ["sesame", "mustard seed"], "other_capture split into two independent entries, literal 'other' placeholder excluded");
  assertEqual(final.other.allergies, ["sesame", "mustard seed"], "same pieces ALSO staged in memory.other.allergies, alongside (not instead of) the real write");

  // Selecting ONLY "Other" (no other real picks) must NOT be treated as an empty submission —
  // default_if_empty (mediterranean) must not fire just because "other" got filtered out of
  // the written values.
  const memory2 = emptyUserMemory();
  const history2: FlowPosition = [];
  const { memory: final2 } = await walk(memory2, history2, {
    n_consent: {},
    n_biometrics: { skipped: true },
    n_goal: { skipped: true },
    n_diet_style_cards: { values: ["other"], other_text: "carnivore" },
    n_cuisine_broad: { skipped: true },
  });
  assertEqual(final2.dietary.diet_type.preferred, ["carnivore"], "selecting only Other writes just the custom text, no leftover 'other' placeholder and no wrongly-applied default_if_empty");
}

async function scenarioOtherStagingRevertsOnBack() {
  console.log("\n=== Scenario G: memory.other staging entry reverts on Back, same as the real field ===");
  const memory = emptyUserMemory();
  let history: FlowPosition = [];

  const walked = await skipUntil("n_diet_style_cards", memory, history);
  let mem = walked.mem;
  history = walked.h;

  const r = await applyAnswer({ nodeId: "n_diet_style_cards", answer: { values: ["other"], other_text: "carnivore" }, memory: mem, history });
  mem = r.memory;
  history = r.history;
  assertEqual(mem.dietary.diet_type.preferred, ["carnivore"], "carnivore written to the real field");
  assertEqual(mem.other.diet_styles, ["carnivore"], "carnivore also staged in memory.other.diet_styles");

  const back = goBack(mem, history);
  assertEqual(back.target.nodeId, "n_diet_style_cards", "back lands on n_diet_style_cards");
  assertEqual(back.memory.dietary.diet_type.preferred, [], "real field reverted");
  assertEqual(back.memory.other.diet_styles, [], "staging entry reverted too — not left dangling after the real answer was undone");
}

async function scenarioExclusionDeckOptOut() {
  console.log("\n=== Scenario H: protein exclusion deck, opt-out multi_select semantics ===");
  const memory = emptyUserMemory();
  const history: FlowPosition = [];

  // Everything skipped through (mediterranean default — no protein exclusions, so the deck
  // renders its full unfiltered 10-item list) except the deck itself, where "pork" is the only
  // thing tapped OFF from the select-all-by-default state.
  const { memory: final } = await walk(memory, history, {
    n_consent: {},
    n_biometrics: { skipped: true },
    n_goal: { skipped: true },
    n_diet_style_cards: { skipped: true },
    n_cuisine_broad: { skipped: true },
    n_allergies: { values: ["none"] },
    n_protein_exclusion_cards: {
      values: ["poultry", "red_meat", "seafood", "shellfish", "plant_based_tofu", "eggs", "dairy_protein", "seitan", "lentils_legumes"], // everything but pork
    },
  });

  assertEqual(final.dietary.avoided_foods, ["pork"], "only the one deselected tile (pork) ends up excluded");
  assertEqual(
    [...final.meal_planning_preferences.variety_rules.protein_variety.rotation].sort(),
    ["dairy_protein", "eggs", "plant_based_tofu", "poultry", "red_meat", "seafood", "shellfish", "seitan", "lentils_legumes"].sort(),
    "everything still selected (the default) lands in the allowed rotation"
  );
}

async function scenarioAllergyIntoleranceHardExclude() {
  console.log("\n=== Scenario I: allergies/intolerances hard-exclude matching options, union not intersection ===");
  const memory = emptyUserMemory();
  const history: FlowPosition = [];

  // The exact case from the request: an eggs allergy means eggs shouldn't be offered as a
  // protein option at all. Also reports a nuts allergy (fat: nut_seed_fats) AND a nut-related
  // intolerance sub-value (also fat: nut_seed_fats) together, to confirm two independent
  // sources both contributing to the SAME excluded value doesn't do anything weird (still just
  // excluded once) — and mediterranean (no diet-driven exclusions) to isolate this from diet.
  let mem = memory;
  let walked = await skipUntil("n_allergies", mem, history);
  mem = walked.mem;
  let h = walked.h;
  let target: FlowTargetish = walked.target;

  let r = await applyAnswer({ nodeId: "n_allergies", answer: { values: ["eggs", "nuts"] }, memory: mem, history: h });
  mem = r.memory;
  h = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal");
  r = await applyAnswer({ nodeId: "n_allergy_confirm", answer: { confirm_edit_action: "confirm" }, memory: mem, history: h });
  mem = r.memory;
  h = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_intolerances", "reached n_intolerances");

  r = await applyAnswer({ nodeId: "n_intolerances", answer: { values: ["peanut_traces"] }, memory: mem, history: h });
  mem = r.memory;
  h = r.history;
  walked = await skipUntil("n_protein_exclusion_cards", mem, h, r.next);
  mem = walked.mem;
  h = walked.h;
  assertEqual(walked.target.nodeId, "n_protein_exclusion_cards", "reached the protein deck (it is NOT auto-skipped at one remaining)");

  // Check the RENDERED protein deck directly — options_filter now DISABLES a matching option
  // rather than removing it (so the user can see it and why), so "eggs" is still present in the
  // list, just flagged.
  const rendered = await renderNode("n_protein_exclusion_cards", undefined, mem);
  const isDisabled = (opts: typeof rendered.node.options, value: string) => opts?.find((o) => o.value === value)?.disabled === true;
  assert(isDisabled(rendered.node.options, "eggs") === true, "eggs is disabled as a protein option (eggs allergy), not removed");
  assert(isDisabled(rendered.node.options, "poultry") === false && isDisabled(rendered.node.options, "seafood") === false, "unrelated protein options are still enabled normally");
  assertEqual(rendered.node.options?.length, 10, "all 10 protein categories still rendered");

  const renderedFat = await renderNode("n_fat_exclusion_cards", undefined, mem);
  assert(
    isDisabled(renderedFat.node.options, "nut_seed_fats") === true,
    "nut_seed_fats disabled (both a nuts allergy AND a peanut-traces intolerance point at it — still just disabled once, not doubled)"
  );
}

async function scenarioZeroOptionsRemaining() {
  console.log("\n=== Scenario J: zero options remaining (keto alone) forces other_capture, never silently writes empty ===");

  // keto alone already excludes ALL 8 carb categories on its own (curated:diet_macro.exclusions'
  // keto.carbs.excluded is the full list, allowed:[]) — no allergy/intolerance combo needed, a
  // single diet is enough to reach zero here. Untouched by the protein-side seitan/
  // lentils_legumes additions, so a simpler, more stable repro than stacking allergies.
  let mem = emptyUserMemory();
  let h: FlowPosition = [];
  let target = await entryPoint(mem, h);
  for (const nodeId of ["n_consent", "n_biometrics", "n_goal"]) {
    if ("terminal" in target) throw new Error("unexpected terminal");
    const r = await applyAnswer({ nodeId, answer: { skipped: true }, memory: mem, history: h });
    mem = r.memory;
    h = r.history;
    target = r.next;
  }
  if ("terminal" in target) throw new Error("unexpected terminal");
  let r = await applyAnswer({ nodeId: "n_diet_style_cards", answer: { values: ["keto"] }, memory: mem, history: h });
  mem = r.memory;
  h = r.history;
  target = r.next;
  for (const nodeId of ["n_cuisine_broad", "n_allergies", "n_allergy_confirm", "n_intolerances", "n_favorite_recipes"]) {
    if ("terminal" in target) throw new Error("unexpected terminal");
    r = await applyAnswer({ nodeId, answer: { skipped: true }, memory: mem, history: h });
    mem = r.memory;
    h = r.history;
    target = r.next;
  }
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_protein_exclusion_cards", "reached the protein deck (keto disables only lentils_legumes on the protein side, everything else stays selectable)");
  r = await applyAnswer({
    nodeId: "n_protein_exclusion_cards",
    answer: { values: ["poultry", "red_meat", "pork", "seafood", "shellfish", "plant_based_tofu", "eggs", "dairy_protein", "seitan"] }, // lentils_legumes disabled under keto
    memory: mem,
    history: h,
  });
  mem = r.memory;
  h = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_carb_exclusion_cards", "carb deck is NOT auto-skipped even though every fixed category is excluded — it still renders");

  // Every fixed category still renders now (not removed) — all 8 marked `disabled`, since
  // options_filter ruled every one of them out. The prompt/skip_label swap for this state moved
  // client-side (MultiSelect.tsx's needsAlternative), so the engine's own render stays the plain,
  // unswapped copy — that swap isn't exercised by this engine-only scenario.
  const rendered = await renderNode("n_carb_exclusion_cards", undefined, mem);
  assertEqual(rendered.node.options?.length, 8, "all 8 fixed carb categories still rendered, none removed");
  assert(rendered.node.options?.every((o) => o.disabled === true) ?? false, "every one of the 8 is marked disabled");
  assertEqual(rendered.node.prompt, "Any carb sources you'd never eat?", "engine's own prompt is the plain, unswapped copy");
  assertEqual(rendered.node.skip_label, "I can eat everything", "engine's own skip_label is the plain, unswapped copy");

  // Typing a custom answer lands in the allowed rotation, not silently dropped.
  r = await applyAnswer({ nodeId: "n_carb_exclusion_cards", answer: { values: [], other_text: "cassava" }, memory: mem, history: h });
  assertEqual(r.memory.meal_planning_preferences.variety_rules.carb_variety.rotation, ["cassava"], "custom carb source lands in the rotation, not an empty array");
  assertEqual(
    r.memory.dietary.avoided_foods.sort(),
    ["rice", "bread", "pasta", "potatoes", "oats", "quinoa", "corn", "legumes", "lentils_legumes"].sort(),
    "all 8 fixed carb categories avoided (keto's carbs.excluded is the full list) + lentils_legumes on the protein side (keto excludes it there too, for consistency with its own carb restriction)"
  );
  // Staged under the node's agent section slug — `carb_source`, the name the validator agent
  // dispatches on (MACRO_SOURCES_FRONTEND.md §3), since otherCaptureSection derives both from
  // the same field.
  assertEqual(r.memory.other.carb_source, ["cassava"], "custom entry also staged in memory.other.carb_source");
}

async function scenarioBackAndRevert() {
  console.log("\n=== Scenario C: back pops the last entry and reverts its write ===");
  const memory = emptyUserMemory();
  let history: FlowPosition = [];

  let target = await entryPoint(memory, history);
  if ("terminal" in target) throw new Error("unexpected terminal"); // n_welcome
  let r = await applyAnswer({ nodeId: target.nodeId, answer: {}, memory, history });
  let mem = r.memory;
  history = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal"); // n_consent
  r = await applyAnswer({ nodeId: target.nodeId, answer: {}, memory: mem, history });
  mem = r.memory;
  history = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal"); // n_biometrics
  r = await applyAnswer({ nodeId: target.nodeId, answer: { skipped: true }, memory: mem, history });
  mem = r.memory;
  history = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_goal", "reached n_goal");

  // Answer n_goal explicitly.
  r = await applyAnswer({ nodeId: target.nodeId, answer: { values: ["build_muscle_strength"] }, memory: mem, history });
  mem = r.memory;
  history = r.history;
  assertEqual(mem.meal_planning_preferences.macro_priority, ["protein", "carbs", "fat"], "macro_priority set from build_muscle_strength");
  assert(!("terminal" in r.next) && r.next.nodeId === "n_allergies", "applyAnswer's next is n_allergies");
  assert(history[history.length - 1].node_id === "n_allergies" && history[history.length - 1].exited_at === null, "history already ends with n_allergies OPEN (resume invariant) even though nobody rendered it yet");

  const back = goBack(mem, history);
  assertEqual(back.target.nodeId, "n_goal", "back lands on n_goal");
  assertEqual(back.memory.meal_planning_preferences.macro_priority, [], "macro_priority reverted to pre-answer snapshot");
  assertEqual(back.memory.meal_planning_preferences.goals_source, null, "goals_source reverted too (same node's infer write)");
}

async function scenarioNoTemplateKeyLeak() {
  console.log("\n=== Scenario T: backing out of n_fixed_meals must not leave a literal {day_of_week} key ===");

  const memory = emptyUserMemory();
  const history: FlowPosition = [];
  const dayKeys = (m: UserMemory) => Object.keys(m.cooking_profile.day_constraints);

  const answered = await applyAnswer({
    nodeId: "n_fixed_meals",
    answer: { day_meal_entries: [{ day_of_week: "tuesday", meal_slot: "dinner", dish_label: "Pizza" }] },
    memory,
    history,
  });
  assertEqual(dayKeys(answered.memory), [...DAYS_OF_WEEK], "the write itself substitutes the day — seven keys, no template");

  // n_fixed_meals' writes_to carries a {day_of_week} placeholder. Its pre-write snapshot must
  // hold only the seven expanded paths: revert setPaths every key it finds, and setPath creates
  // missing parents, so a raw templated path would materialise "{day_of_week}" as a real sibling
  // of monday-sunday — junk that then ships to the planner in memory_json.
  const back = goBack(answered.memory, answered.history);
  assertEqual(dayKeys(back.memory), [...DAYS_OF_WEEK], "Back reverts without inventing a key");
  assertEqual(back.memory.cooking_profile.day_constraints.tuesday.fixed_meals, [], "the Tuesday write is genuinely reverted");
}

async function scenarioBackSkipsConfirmEdit() {
  console.log("\n=== Scenario F: back from n_intolerances skips the confirm_edit gate, lands on n_allergies ===");
  const memory = emptyUserMemory();
  let history: FlowPosition = [];

  let target = await entryPoint(memory, history);
  const skips: Record<string, Answer> = {
    n_welcome: {},
    n_consent: {},
    n_biometrics: { skipped: true },
    n_goal: { skipped: true },
    n_diet_style_cards: { skipped: true },
    n_cuisine_broad: { skipped: true },
  };
  let mem = memory;
  while (!("terminal" in target) && target.nodeId !== "n_allergies") {
    const answer = skips[target.nodeId] ?? { skipped: true };
    const r = await applyAnswer({ nodeId: target.nodeId, item: target.item, answer, memory: mem, history });
    mem = r.memory;
    history = r.history;
    target = r.next;
  }
  if ("terminal" in target) throw new Error("unexpected terminal before n_allergies");
  assertEqual(target.nodeId, "n_allergies", "reached n_allergies");

  let r = await applyAnswer({ nodeId: "n_allergies", answer: { values: ["nuts"] }, memory: mem, history });
  mem = r.memory;
  history = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_allergy_confirm", "reached n_allergy_confirm");

  r = await applyAnswer({ nodeId: "n_allergy_confirm", answer: { confirm_edit_action: "confirm" }, memory: mem, history });
  mem = r.memory;
  history = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_intolerances", "reached n_intolerances");
  assert(history[history.length - 1].node_id === "n_intolerances" && history[history.length - 1].exited_at === null, "history ends with n_intolerances OPEN");

  const back = goBack(mem, history);
  assertEqual(back.target.nodeId, "n_allergies", "back from n_intolerances skips n_allergy_confirm and lands on n_allergies");
  assertEqual(getPath(back.memory as unknown as Record<string, unknown>, "dietary.allergies"), [], "allergies reverted to pre-answer snapshot (both entries undone)");
}

async function scenarioPairingSampleEmpty() {
  console.log("\n=== Scenario K: n_pairing_cards — mediterranean alone has no curated pool, sample is empty, node fully bypassed ===");

  // Fully deterministic (no randomness involved): mediterranean's own pool is empty (its
  // dishes live under european/middle_eastern per cuisine_curated_data.yaml's deliberate
  // sub-cuisine overlap — see pairing_curated_data.yaml's header), so a mediterranean-ONLY
  // selection samples zero dishes — repeat_for sees zero items and skips straight to `next`,
  // same mechanism that already makes n_cuisine_narrow/n_dishes skip cleanly on an empty field.
  let mem = emptyUserMemory();
  let h: FlowPosition = [];
  let target = await entryPoint(mem, h);
  for (const nodeId of ["n_consent", "n_biometrics", "n_goal", "n_diet_style_cards"]) {
    if ("terminal" in target) throw new Error("unexpected terminal");
    const r = await applyAnswer({ nodeId, answer: { skipped: true }, memory: mem, history: h });
    mem = r.memory;
    h = r.history;
    target = r.next;
  }
  if ("terminal" in target) throw new Error("unexpected terminal");
  let r = await applyAnswer({ nodeId: "n_cuisine_broad", answer: { values: ["mediterranean"] }, memory: mem, history: h }); // not a region slug — no pool, no sample
  mem = r.memory;
  h = r.history;
  target = r.next;
  for (const nodeId of ["n_allergies", "n_allergy_confirm", "n_intolerances", "n_favorite_recipes"]) {
    if ("terminal" in target) throw new Error("unexpected terminal");
    r = await applyAnswer({ nodeId, answer: { skipped: true }, memory: mem, history: h });
    mem = r.memory;
    h = r.history;
    target = r.next;
  }
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_protein_exclusion_cards", "n_pairing_cards never rendered at all — zero sampled dishes, straight through to next");
  assertEqual(mem.meal_planning_preferences.pairing_sample, [], "cached sample is an empty array (computed, not just never-set)");
  assertEqual(mem.meal_planning_preferences.preferred_pairings, [], "nothing written — no dish was ever shown to react to");
  assertEqual(mem.meal_planning_preferences.forbidden_pairings, [], "same for forbidden_pairings");
  assert(!h.some((entry) => entry.node_id === "n_pairing_cards"), "n_pairing_cards never entered history — skip_if-style bypass, not an answered-and-empty node");
}

async function scenarioPairingSampleDistributionAndEmptyDishIsValid() {
  console.log("\n=== Scenario L: n_pairing_cards — proportional sampling across 2 cuisines, real write shape, an empty per-dish answer is valid (no whole-node Skip anymore) ===");

  // asian (7 curated dishes) + european (4) -> share = ceil(6/2) = 3 each, both pools >= 3, so
  // exactly 6 dishes sampled with no top-up shortfall — deterministic COUNT and per-cuisine
  // split, even though WHICH 3 from each is random.
  const asianDishes = new Set(["biryani", "chana_masala", "dal", "pad_thai", "green_curry", "sushi", "ramen"]);
  const europeanDishes = new Set(["pizza", "carbonara", "lasagna", "paella"]);

  let mem = emptyUserMemory();
  let h: FlowPosition = [];
  let target = await entryPoint(mem, h);
  for (const nodeId of ["n_consent", "n_biometrics", "n_goal", "n_diet_style_cards"]) {
    if ("terminal" in target) throw new Error("unexpected terminal");
    const r = await applyAnswer({ nodeId, answer: { skipped: true }, memory: mem, history: h });
    mem = r.memory;
    h = r.history;
    target = r.next;
  }
  if ("terminal" in target) throw new Error("unexpected terminal");
  let r = await applyAnswer({ nodeId: "n_cuisine_broad", answer: { values: ["asia_oceania", "europe"] }, memory: mem, history: h });
  mem = r.memory;
  h = r.history;
  target = r.next;
  for (const nodeId of ["n_allergies", "n_allergy_confirm", "n_intolerances", "n_favorite_recipes"]) {
    if ("terminal" in target) throw new Error("unexpected terminal");
    r = await applyAnswer({ nodeId, answer: { skipped: true }, memory: mem, history: h });
    mem = r.memory;
    h = r.history;
    target = r.next;
  }
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_pairing_cards", "reached the pairing deck");

  const sample = mem.meal_planning_preferences.pairing_sample ?? [];
  assertEqual(sample.length, 6, "6 dishes sampled total (3 + 3, no shortfall from either cuisine)");
  assertEqual(sample.filter((v) => asianDishes.has(v)).length, 3, "exactly 3 from asian's pool");
  assertEqual(sample.filter((v) => europeanDishes.has(v)).length, 3, "exactly 3 from european's pool");
  assertEqual(new Set(sample).size, 6, "no duplicate dishes in the sample");

  // Answer the FIRST sampled dish for real — verifies the write shape.
  const firstItem = target.item!;
  const dish = await findPairingDish(firstItem);
  if (!dish) throw new Error(`sampled dish "${firstItem}" not found in curated:pairing.sides`);
  r = await applyAnswer({
    nodeId: "n_pairing_cards",
    item: firstItem,
    answer: { values: [dish.options[0].value], left_values: [dish.options[1].value] },
    memory: mem,
    history: h,
  });
  mem = r.memory;
  h = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_pairing_cards", "advanced to the second sampled dish, not straight out of the deck");
  assertEqual(mem.meal_planning_preferences.preferred_pairings, [{ main: firstItem, sides: [{ title: dish.options[0].label, recipe_uuid: null }] }], "first dish's preferred_pairings entry has the real {main, sides} shape");
  assertEqual(mem.meal_planning_preferences.forbidden_pairings, [{ main: firstItem, sides: [{ title: dish.options[1].label, recipe_uuid: null }] }], "first dish's forbidden_pairings entry too");

  // n_pairing_cards is no longer `optional` (no whole-sequence Skip — pairing reactions are
  // data this product needs) — but a bare "no opinion on THIS dish" (nothing checked in either
  // question) is still a valid answer, writing nothing and simply moving to the next dish.
  const secondItem = target.item!;
  r = await applyAnswer({ nodeId: "n_pairing_cards", item: secondItem, answer: { values: [], left_values: [] }, memory: mem, history: h });
  mem = r.memory;
  h = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_pairing_cards", "advanced to the third sampled dish after an opinion-free answer on the second");
  assertEqual(mem.meal_planning_preferences.preferred_pairings.length, 1, "still only the one real entry from dish #1 — nothing written for a no-opinion dish");
  assertEqual(mem.meal_planning_preferences.forbidden_pairings.length, 1, "same for forbidden_pairings");
}

async function scenarioIntolerancesNoneOption() {
  console.log("\n=== Scenario M: n_intolerances — \"I don't have any\" is a real option (exclusive_value), no more Skip button ===");

  const rendered = await renderNode("n_intolerances", undefined, emptyUserMemory());
  assertEqual(rendered.node.exclusive_value, "none", "exclusive_value wired to the new option");
  assertEqual(rendered.node.require_selection, true, "require_selection true — always a valid pick now, same reasoning as n_allergies");
  assertEqual(rendered.node.optional, undefined, "no longer optional — no Skip button renders (MultiSelect.tsx's {node.optional && <SkipButton/>} guard)");
  const noneOption = rendered.node.options?.find((o) => o.value === "none");
  assert(noneOption?.label === "I don't have any", `"none" is a real selectable option with the expected label (got ${JSON.stringify(noneOption)})`);

  // Submitting "none" writes it like any other value — the mutual-exclusivity (selecting it
  // disables every other option, including Other) is client-side only (MultiSelect.tsx's
  // exclusive_value handling, already proven by n_allergies/n_diet_style_cards using the exact
  // same mechanism) — not re-verified at the engine level here.
  let mem = emptyUserMemory();
  let h: FlowPosition = [];
  let target = await entryPoint(mem, h);
  for (const nodeId of ["n_consent", "n_biometrics", "n_goal", "n_diet_style_cards", "n_cuisine_broad", "n_allergies", "n_allergy_confirm"]) {
    if ("terminal" in target) throw new Error("unexpected terminal");
    const r = await applyAnswer({ nodeId, answer: nodeId === "n_allergies" ? { values: ["none"] } : nodeId === "n_allergy_confirm" ? { confirm_edit_action: "confirm" } : { skipped: true }, memory: mem, history: h });
    mem = r.memory;
    h = r.history;
    target = r.next;
  }
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_intolerances", "reached n_intolerances");
  const r = await applyAnswer({ nodeId: "n_intolerances", answer: { values: ["none"] }, memory: mem, history: h });
  assertEqual(r.memory.dietary.intolerances, ["none"], "\"none\" written like any real selection");
}

async function scenarioValidatedOtherEntries() {
  console.log("\n=== Scenario N: other_entries write path — the validator's normalized value is what lands, not the raw typed text ===");

  // The client validates an "Other" submission (one batched call to the Onboarding Validator
  // Agent) BEFORE submitting, then sends the resolved {entry, value, label} triples as
  // answer.other_entries. engine.ts writes `value` when it's non-null — the whole point of
  // normalizing at all — and falls back to the raw entry only when it's null (section out of
  // the agent's scope, or the agent couldn't normalize). See engine.ts's other_capture branch.
  let mem = emptyUserMemory();
  let h: FlowPosition = [];
  const walked = await skipUntil("n_allergies", mem, h);
  mem = walked.mem;
  h = walked.h;
  let target: FlowTargetish = walked.target;

  const r = await applyAnswer({
    nodeId: "n_allergies",
    answer: {
      values: ["other"],
      other_entries: [
        { entry: "peanut butter", value: "peanuts", label: "Peanuts" }, // agent normalized it
        { entry: "bee stings", value: null, label: null }, // agent couldn't normalize — raw text
      ],
    },
    memory: mem,
    history: h,
  });

  assertEqual(r.memory.dietary.allergies, ["peanuts", "bee stings"], "normalized value wins over the raw entry; a null value falls back to the raw text");
  assert(!r.memory.dietary.allergies.includes("peanut butter"), "the raw typed text is NOT written when the agent normalized it");
  assert(!r.memory.dietary.allergies.includes("other"), "the other_capture trigger_value itself never lands in writes_to");
  assertEqual(r.memory.other.allergies, ["peanuts", "bee stings"], "memory.other staging mirrors exactly what was written");

  // Legacy path still works untouched — a caller that sends plain other_text (no other_entries)
  // gets the original split-and-append-raw behavior, which is what every out-of-scope section
  // (cuisine_broad, and the macro-source sections until the function accepts them) still relies on.
  const legacy = await applyAnswer({
    nodeId: "n_allergies",
    answer: { values: ["other"], other_text: "shellfish, sulphites" },
    memory: emptyUserMemory(),
    history: [],
  });
  assertEqual(legacy.memory.dietary.allergies, ["shellfish", "sulphites"], "legacy other_text path unchanged: split on delimiters, appended raw");
}

async function scenarioConfirmEditRewinds() {
  console.log("\n=== Scenario O: n_allergy_confirm's \"edit\" rewinds and reverts, instead of appending on top ===");

  // The edit branch used to be an ordinary forward move to n_allergies, so the answer being
  // corrected was never reverted — re-answering appended on top and the value the user came
  // back to REMOVE survived. See engine.ts's confirm_edit/"edit" branch in applyAnswer.
  let mem = emptyUserMemory();
  let h: FlowPosition = [];
  const walked = await skipUntil("n_allergies", mem, h);
  mem = walked.mem;
  h = walked.h;
  let target: FlowTargetish = walked.target;

  let r = await applyAnswer({ nodeId: "n_allergies", answer: { values: ["nuts"] }, memory: mem, history: h });
  mem = r.memory;
  h = r.history;
  target = r.next;
  assertEqual(mem.dietary.allergies, ["nuts"], "first answer recorded");
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_allergy_confirm", "advanced to the confirm gate");

  // "Something's missing or wrong"
  r = await applyAnswer({ nodeId: "n_allergy_confirm", answer: { confirm_edit_action: "edit" }, memory: mem, history: h });
  mem = r.memory;
  h = r.history;
  target = r.next;
  if ("terminal" in target) throw new Error("unexpected terminal");
  assertEqual(target.nodeId, "n_allergies", "edit sends the user back to n_allergies");
  assertEqual(mem.dietary.allergies, [], "the answer being corrected is REVERTED, not left in memory");
  assert(!h.some((e) => e.node_id === "n_allergy_confirm"), "the confirm entry is truncated away too — it gets re-entered after the redo");
  assertEqual(h.filter((e) => e.node_id === "n_allergies").length, 1, "exactly one open n_allergies entry, freshly created");

  // Re-answer with something different — the old value must not come back with it.
  r = await applyAnswer({ nodeId: "n_allergies", answer: { values: ["dairy"] }, memory: mem, history: h });
  assertEqual(r.memory.dietary.allergies, ["dairy"], "corrected answer stands alone — no stale 'nuts' appended alongside it");
}

async function scenarioBackRecallsTheAnswer() {
  console.log("\n=== Scenario V: Back hands the screen the answer it's about to re-render blank ===");

  // The answer can't be recovered from memory on the way back: goBack reverts this node's
  // writes before the screen renders, and n_allergies' custom entries land as bare strings in
  // dietary.allergies with nothing marking which were typed. So the entry records the
  // submission itself — see HistoryEntry.answer.
  let mem = emptyUserMemory();
  let h: FlowPosition = [];
  const walked = await skipUntil("n_allergies", mem, h);
  mem = walked.mem;
  h = walked.h;

  const answer: Answer = { values: ["nuts", "other"], other_entries: [{ entry: "pumpkin", value: null, label: "Pumpkin" }] };
  let r = await applyAnswer({ nodeId: "n_allergies", answer, memory: mem, history: h });
  mem = r.memory;
  h = r.history;
  assertEqual(mem.dietary.allergies, ["nuts", "pumpkin"], "tapped option and typed entry both written");
  assert(!("terminal" in r.next) && r.next.nodeId === "n_allergy_confirm", "advanced to the confirm gate");

  const back = goBack(mem, h);
  assertEqual(back.target.nodeId, "n_allergies", "back lands on n_allergies");
  assertEqual(back.memory.dietary.allergies, [], "its write is reverted, as always — which is why the answer has to be carried separately");

  const recalled = recalledAnswer(back.history, back.target);
  assertEqual(recalled?.values, ["nuts", "other"], "the tapped options come back, so the screen re-renders them selected");
  assertEqual(recalled?.other_entries, [{ entry: "pumpkin", value: null, label: "Pumpkin" }], "so does the typed entry, with the label the agent gave it — that's the removable row");

  // The recall rides on a re-opened entry, not a dangling one: history must still end with an
  // open entry for what's on screen (the resume invariant, and the /answer route's stale check).
  const open = back.history.filter((e) => e.exited_at === null);
  assertEqual(open.length, 1, "exactly one open entry after Back");
  assertEqual(open[0].node_id, "n_allergies", "and it's the node now on screen");

  // Re-answering replaces the recalled answer rather than merging with it — a removed entry
  // stays removed. (The write itself is already proven by scenario O; this is about the echo.)
  r = await applyAnswer({ nodeId: "n_allergies", answer: { values: ["nuts"] }, memory: back.memory, history: back.history });
  assertEqual(r.memory.dietary.allergies, ["nuts"], "pumpkin is gone from memory");
  const redone = r.history.find((e) => e.node_id === "n_allergies");
  assertEqual(redone?.answer?.other_entries, undefined, "and gone from the recalled answer too — no stale echo to re-render");

  // A skip records nothing: echoing an empty answer back would show an opt-out deck with
  // everything DESELECTED, which is the opposite of what a skip means there.
  const deck = await skipUntil("n_protein_exclusion_cards", emptyUserMemory(), []);
  const skipped = await applyAnswer({ nodeId: "n_protein_exclusion_cards", answer: { skipped: true }, memory: deck.mem, history: deck.h });
  const deckEntry = skipped.history.find((e) => e.node_id === "n_protein_exclusion_cards");
  assert(deckEntry?.answer === undefined, "a skipped node records no answer — the screen falls back to its own default state");
}

async function scenarioPartialMemoryIsRepaired() {
  console.log("\n=== Scenario W: a partial memory_json must not become scalar writes, then a 500 ===");

  // The exact shape loadUserMemory used to hand the engine for a row that exists but doesn't
  // cover the whole schema: cast to UserMemory, paths simply absent. writeScalarOrArray then
  // asks whether the CURRENT value is an array, sees undefined, and overwrites with a bare
  // scalar instead of appending to a list.
  const partial = { version: "1.3", profile: { consent: { accepted: true } } } as unknown as UserMemory;

  const raw = await applyAnswer({ nodeId: "n_diet_style_cards", answer: { values: ["vegetarian"] }, memory: partial, history: [] });
  assertEqual(
    getPath(raw.memory as unknown as Record<string, unknown>, "dietary.diet_type.preferred"),
    "vegetarian",
    "unmerged, the write is still a bare scalar — this is the shape that reached production"
  );

  // The fix: every load merges onto the skeleton first, so the path exists as [] and appends.
  const merged = mergeIntoSkeleton({ version: "1.3", profile: { consent: { accepted: true } } });
  const fixed = await applyAnswer({ nodeId: "n_diet_style_cards", answer: { values: ["vegetarian"] }, memory: merged, history: [] });
  assertEqual(
    getPath(fixed.memory as unknown as Record<string, unknown>, "dietary.diet_type.preferred"),
    ["vegetarian"],
    "merged first, the same answer appends to a list"
  );
  assertEqual(merged.profile.consent.accepted, true, "the stored value still wins over the skeleton's default");
  assertEqual(merged.dietary.allergies, [], "and every path the row omitted gets its skeleton shape");

  // A row already damaged the old way is repaired on load, not left to throw forever.
  const repaired = mergeIntoSkeleton({ dietary: { allergies: "nuts", intolerances: "gluten_sensitivity", diet_type: { preferred: "vegetarian" } } });
  assertEqual(repaired.dietary.allergies, ["nuts"], "a scalar stored where the schema says list is wrapped, not dropped");
  assertEqual(repaired.dietary.diet_type.preferred, ["vegetarian"], "nested too");
  assertEqual(mergeIntoSkeleton({ taste_profile: { cuisines: [] } }).taste_profile.cuisines, [], "an explicitly empty stored array wins over the skeleton — not re-defaulted");

  // Rendering is what actually 500'd. Both the throw and its quieter sibling are covered:
  // `for (const v of "nuts")` iterates characters, so allergy exclusions silently vanished.
  const protein = await renderNode("n_protein_exclusion_cards", undefined, repaired);
  const proteinOff = (protein.node.options ?? []).filter((o) => o.disabled).map((o) => o.value);
  assert(proteinOff.length > 0, `the deck renders instead of throwing: ${JSON.stringify(proteinOff)}`);
  assert(proteinOff.includes("seitan"), `the gluten intolerance still filters: ${JSON.stringify(proteinOff)}`);

  // The allergy half, on the deck a nuts allergy actually touches: curated:allergy_macro
  // maps nuts to fat only. Iterating "nuts" as characters would look up n/u/t/s and exclude
  // nothing here, with no error to notice.
  const fat = await renderNode("n_fat_exclusion_cards", undefined, repaired);
  const fatOff = (fat.node.options ?? []).filter((o) => o.disabled).map((o) => o.value);
  assert(fatOff.includes("nut_seed_fats"), `the nuts allergy is read as a list, not characters: ${JSON.stringify(fatOff)}`);
}

async function scenarioCommittedUserDoesNotRestart() {
  console.log("\n=== Scenario X: reloading /onboarding after committing must not restart the flow ===");

  // commitUserMemory clears flow_position, so a committed account and a brand-new one both
  // arrive at resolveResumeTarget with an empty stack. Telling them apart matters more than it
  // used to: the final screen is now minutes of recipe-discovery progress rather than one
  // click, and the copy invites the user to sit there — so a refresh mid-wait is ordinary.
  const committed = emptyUserMemory();
  committed.profile.onboarding_completed_at = "2026-10-06";

  const resumed = await resolveResumeTarget(committed, []);
  assert("terminal" in resumed, `a committed account resumes to terminal, not a node — got ${JSON.stringify(resumed)}`);

  // ...and nothing is written back. The state route saves whatever resolveResumeTarget leaves
  // in history, so an entry opened here would durably park the user at the start of the flow.
  const history: FlowPosition = [];
  await resolveResumeTarget(committed, history);
  assertEqual(history, [], "no history entry is opened for a finished session");

  // The fresh-account path is untouched: no completion stamp means a real first visit.
  const fresh: FlowPosition = [];
  const first = await resolveResumeTarget(emptyUserMemory(), fresh);
  assert(!("terminal" in first) && first.nodeId === "n_welcome", `a new account still starts at n_welcome — got ${JSON.stringify(first)}`);
  assert(fresh.length === 1 && fresh[0].exited_at === null, "and gets its open entry as before");

  // An interrupted session still resumes where it was, completion stamp or not — the open
  // entry wins, so this check can never swallow a genuine mid-flow resume.
  const midFlow = emptyUserMemory();
  const walked = await skipUntil("n_allergies", midFlow, []);
  const openEntryTarget = await resolveResumeTarget(walked.mem, walked.h);
  assert(!("terminal" in openEntryTarget) && openEntryTarget.nodeId === "n_allergies", "an open entry still wins");
}

async function scenarioCustomDietNeutralizesExclusions() {
  console.log("\n=== Scenario Q: a custom diet slug in diet_type.preferred wipes out every other diet's exclusions ===");

  // n_diet_style_cards now routes its "other" entries through the validator agent, which
  // normalizes to ITS OWN slug vocabulary ("keto diet" -> `ketogenic`), not the curated option
  // values (`keto`). Those custom slugs land in dietary.diet_type.preferred alongside tapped
  // ones — and options-filter.ts intersects `excluded` across every entry, so a slug the
  // curated table has never heard of contributes an empty set and empties the intersection.
  const rendered = async (preferred: string[]) => {
    const mem = emptyUserMemory();
    mem.dietary.diet_type.preferred = preferred;
    const r = await renderNode("n_protein_exclusion_cards", undefined, mem);
    return (r.node.options ?? []).filter((o) => o.disabled).map((o) => o.value).sort();
  };

  const veganOnly = await rendered(["vegan"]);
  assert(veganOnly.includes("red_meat") && veganOnly.includes("poultry"), "baseline: vegan alone excludes meat");

  // Same user, having ALSO typed a diet the curated table doesn't key on.
  const veganPlusCustom = await rendered(["vegan", "ketogenic"]);
  assertEqual(
    veganPlusCustom,
    veganOnly,
    "a custom diet slug must not cancel the exclusions the tapped diets contributed"
  );
}

async function scenarioCuisinesFromTable() {
  console.log("\n=== Scenario R: n_cuisine_narrow / n_dishes read tbl_cuisines_onboarding, not the curated blobs ===");

  const mem = emptyUserMemory();
  mem.taste_profile.cuisines = ["asia_oceania", "europe", "north_america"];

  const optionsFor = async (nodeId: string, item: string) =>
    ((await renderNode(nodeId, item, mem)).node.options ?? []).map((o) => o.value);

  // One region vocabulary end to end now: n_cuisine_broad's values ARE the table's region
  // slugs. A miss returns ONLY the Other tile, which is also what a missing RLS policy looks
  // like — hence asserting real rows, not just a non-empty list.
  const asian = await optionsFor("n_cuisine_narrow", "asia_oceania");
  assertEqual(asian.length, 5, "4 cuisines + Other for a mapped region");
  assert(asian.includes("thai_cuisine") && asian.includes("chinese_cuisine"), "asia_oceania resolves its own rows");
  assertEqual(asian[asian.length - 1], "other", "Other always renders last");

  const american = await optionsFor("n_cuisine_narrow", "north_america");
  assert(american.includes("american_cuisine"), "north_america resolves its own rows");

  // Ranked by region_rank, so the list is stable rather than whatever Postgres returns.
  const european = await optionsFor("n_cuisine_narrow", "europe");
  assertEqual(european, ["italian_cuisine", "french_cuisine", "spanish_cuisine", "portuguese_cuisine", "other"], "europe, ranked");

  // An unmapped region degrades to the free-text path instead of throwing.
  assertEqual(await optionsFor("n_cuisine_narrow", "atlantis"), ["other"], "an unknown region falls back to Other alone");

  // n_dishes follows onto the same table, keyed by the cuisine_slug the previous node wrote.
  mem.taste_profile.sub_cuisines = ["thai_cuisine"];
  const dishes = await optionsFor("n_dishes", "thai_cuisine");
  assert(dishes.includes("pad_thai") && dishes.includes("som_tam"), "dishes come from that row's popular_dishes");
  assertEqual(dishes[dishes.length - 1], "other", "Other last here too");

  // A cuisine typed as free text has no row — expected, not an error.
  assertEqual(await optionsFor("n_dishes", "cuisine_the_user_invented"), ["other"], "an unknown cuisine_slug yields Other alone");

  // `{item}` in prompt copy must render the display label, never the raw slug. Memory still
  // holds slugs — this is display only (structure.item_label, engine.ts's resolveItemLabel).
  const promptFor = async (nodeId: string, item: string) => (await renderNode(nodeId, item, mem)).node.prompt ?? "";
  assert((await promptFor("n_cuisine_narrow", "central_latin_america")).includes("Central/South America"), "region renders its n_cuisine_broad label");
  assert(!(await promptFor("n_cuisine_narrow", "central_latin_america")).includes("central_latin_america"), "no raw region slug in the prompt");

  // n_dishes uses cuisine_name ("Ghanaian cuisine"), NOT display_name ("Ghanaian") — the tiles
  // use display_name, but only the noun form reads correctly inside the prompt sentence.
  const ghanaian = await promptFor("n_dishes", "ghanaian_cuisine");
  assert(ghanaian.includes("Ghanaian cuisine"), "prompt uses cuisine_name, the noun form");
  assert(!ghanaian.includes("ghanaian_cuisine"), "no raw slug in the prompt");
  // The stored label beats any string-mangling: this one carries casing and parentheses that
  // humanizeSlug could never reconstruct.
  assert(
    (await promptFor("n_dishes", "mexican_regional_cuisine_oaxacan")).includes("Mexican regional cuisine (Oaxacan)"),
    "the authoritative label wins over a humanised slug"
  );
  // A free-text cuisine has no row, so it falls back to the humanised form rather than the slug.
  const invented = await promptFor("n_dishes", "a_cuisine_i_made_up");
  assert(invented.includes("A Cuisine I Made Up") && !invented.includes("a_cuisine_i_made_up"), "unknown slug falls back to humanised text");
}

async function scenarioFixedMealsDishOptions() {
  console.log("\n=== Scenario S: n_fixed_meals offers the dishes named at n_favorite_recipes ===");

  const mem = emptyUserMemory();
  const dishOptionsFor = async (memory: UserMemory) => {
    const { node } = await renderNode("n_fixed_meals", undefined, memory);
    const field = node.fields?.find((f) => f.name === "dish_name");
    return (field?.options ?? []).map((o) => ({ value: o.value, label: o.label }));
  };

  // Nobody answered n_favorite_recipes: no badges, and the free-text box is the only way in —
  // the screen's pre-badge behaviour, which has to keep working.
  assertEqual(await dishOptionsFor(mem), [], "no preferred_recipes -> no dish options");

  const recipe = (title: string) => ({ title, has_side: false, sides: [], recipe_uuid: null });
  mem.meal_planning_preferences.preferred_recipes = [recipe("Butter chicken"), recipe("Pad Thai"), recipe("Pizza")];

  // value === label === the title, deliberately: DayMealPicker writes whatever the composer
  // holds straight into fixed_meals[].title, so a badge has to carry the title itself, not a
  // slug. Anything else and a picked badge would write a different string than a typed one.
  assertEqual(
    await dishOptionsFor(mem),
    [
      { value: "Butter chicken", label: "Butter chicken" },
      { value: "Pad Thai", label: "Pad Thai" },
      { value: "Pizza", label: "Pizza" },
    ],
    "each preferred recipe becomes one option carrying its own title"
  );

  // preferred_recipes is partly built from free text the user typed, so it can hold junk.
  // Nothing here may throw: an unusable row is dropped, not rendered as an empty badge.
  mem.meal_planning_preferences.preferred_recipes = [
    recipe("  Pizza  "),
    recipe("Pizza"),
    recipe("   "),
    { title: null, has_side: false, sides: [], recipe_uuid: null } as unknown as (typeof mem.meal_planning_preferences.preferred_recipes)[number],
    recipe("Lasagne"),
  ];
  assertEqual(
    (await dishOptionsFor(mem)).map((o) => o.value),
    ["Pizza", "Lasagne"],
    "titles are trimmed and deduped; blank and non-string ones are dropped"
  );

  // The write is unchanged by where the title came from — a picked badge and a typed string
  // produce byte-identical entries.
  const history: FlowPosition = [];
  const picked = await applyAnswer({
    nodeId: "n_fixed_meals",
    answer: { day_meal_entries: [{ day_of_week: "thursday", meal_slot: "dinner", dish_label: "Pizza" }] },
    memory: mem,
    history,
  });
  assertEqual(
    picked.memory.cooking_profile.day_constraints.thursday.fixed_meals,
    [{ title: "Pizza", meal_slot: "dinner", recipe_uuid: null }],
    "a badge-picked dish writes the same shape the free-text box always did"
  );
}

async function scenarioExclusionAttribution() {
  console.log("\n=== Scenario U: greyed-out tiles say WHICH answer ruled them out ===");

  const reasonsFor = async (nodeId: string, diets: string[], allergies: string[], intolerances: string[]) => {
    const mem = emptyUserMemory();
    mem.dietary.diet_type.preferred = diets;
    mem.dietary.allergies = allergies;
    mem.dietary.intolerances = intolerances;
    const { node } = await renderNode(nodeId, undefined, mem);
    return (node.exclusion_reasons ?? []).map((r) => `${r.cause}: ${r.labels.join(", ")}`);
  };

  // The case that started this: three diets intersect to nothing, so the ONLY greying is the
  // allergy — and the screen now says so instead of leaving the user to blame the Vegan pick.
  assertEqual(
    await reasonsFor("n_fat_exclusion_cards", ["mediterranean", "vegetarian", "vegan"], ["nuts"], ["lactose"]),
    ["Nuts allergy: Nuts / seeds / avocado"],
    "an allergy-only greying is attributed to the allergy, not to any diet"
  );

  // Two constraints hitting the same tile both get named. Suppressing the second would make the
  // banner's "tap Back to change those" advice wrong — changing one answer wouldn't free it.
  assertEqual(
    await reasonsFor("n_fat_exclusion_cards", ["vegan"], ["dairy"], []),
    ["Vegan diet: Butter, Ghee, Lard, Tallow (beef fat)", "Dairy allergy: Butter, Ghee"],
    "a tile ruled out twice is listed under both causes"
  );

  // Diet exclusions are an intersection, so every contributing diet is named, plural agreeing.
  assertEqual(
    await reasonsFor("n_fat_exclusion_cards", ["vegetarian", "vegan"], [], []),
    ["Vegetarian, Vegan diets: Lard, Tallow (beef fat)"],
    "the intersecting diets are named together"
  );

  // Free text with no curated row rules nothing out, so it must not appear as a phantom cause.
  assertEqual(await reasonsFor("n_fat_exclusion_cards", ["mediterranean"], [], ["pumpkin"]), [], "an unknown intolerance is not listed as a cause");
  assertEqual(await reasonsFor("n_fat_exclusion_cards", [], [], []), [], "nothing greyed, nothing attributed");
}

async function scenarioBiometricsBounds() {
  console.log("\n=== Scenario P: n_biometrics bounds are enforced on the WRITE, not just in the form ===");

  const write = async (fields: Record<string, unknown>) => {
    const r = await applyAnswer({ nodeId: "n_biometrics", answer: { fields }, memory: emptyUserMemory(), history: [] });
    return r.memory.profile;
  };

  // Everything in range lands as given.
  let profile = await write({ units: "metric", gender: "female", age: 34, height: 170, weight: 68 });
  assertEqual(profile.locale.units, "metric", "units written");
  assertEqual(profile.biometrics.age, 34, "in-range age written");
  assertEqual(profile.biometrics.height, 170, "in-range height written");
  assertEqual(profile.biometrics.weight, 68, "in-range weight written");

  // Out-of-range values are dropped individually — the good fields in the same submission
  // still land, and the bad ones keep the skeleton's null rather than writing junk.
  profile = await write({ units: "metric", gender: "male", age: 4, height: 900, weight: 68 });
  assertEqual(profile.biometrics.age, null, "age below the 18 floor is refused");
  assertEqual(profile.biometrics.height, null, "height above the 270cm cap is refused");
  assertEqual(profile.biometrics.weight, 68, "a valid field in the same submission still writes");

  // A birth year typed into the age box — the case the 120 cap exists for.
  profile = await write({ units: "metric", gender: "female", age: 1990 });
  assertEqual(profile.biometrics.age, null, "a birth year in the age field is refused");

  // Bounds resolve against the SELECTED units: 170 is a fine height in cm, absurd in inches.
  profile = await write({ units: "imperial", gender: "male", height: 170 });
  assertEqual(profile.biometrics.height, null, "170 is out of range once units are imperial (max 106in)");
  profile = await write({ units: "imperial", gender: "male", height: 69 });
  assertEqual(profile.biometrics.height, 69, "69in is a normal imperial height");

  // Known, accepted gap (see the height discussion): an imperial number typed while on metric
  // is inside the metric range, so no bound can catch it.
  profile = await write({ units: "metric", gender: "male", height: 69 });
  assertEqual(profile.biometrics.height, 69, "69 'cm' passes under metric — bounds can't catch this direction, documented not fixed");
}

async function main() {
  await scenarioFullWalkthrough();
  await scenarioExclusionDeckOptOut();
  await scenarioAllergyIntoleranceHardExclude();
  await scenarioZeroOptionsRemaining();
  await scenarioDefaultIsTerminal();
  await scenarioBackAndRevert();
  await scenarioBackSkipsConfirmEdit();
  await scenarioNoTemplateKeyLeak();
  await scenarioProteinRendersAtOneRemaining();
  await scenarioOtherCaptureSplit();
  await scenarioOtherStagingRevertsOnBack();
  await scenarioPairingSampleEmpty();
  await scenarioPairingSampleDistributionAndEmptyDishIsValid();
  await scenarioIntolerancesNoneOption();
  await scenarioValidatedOtherEntries();
  await scenarioConfirmEditRewinds();
  await scenarioCuisinesFromTable();
  await scenarioFixedMealsDishOptions();
  await scenarioExclusionAttribution();
  await scenarioBackRecallsTheAnswer();
  await scenarioPartialMemoryIsRepaired();
  await scenarioCommittedUserDoesNotRestart();
  await scenarioBiometricsBounds();
  await scenarioCustomDietNeutralizesExclusions();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
