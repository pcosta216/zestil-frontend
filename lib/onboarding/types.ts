// Onboarding types — user_memory schema v1.3 (user_memory_empty.json) plus
// the two fields added by the updated design docs: dietary.health_condition_notes
// and variety_rules.{carb_variety,fat_variety} (mirroring protein_variety).
//
// This is the first TypeScript representation of the user_memory shape in
// this repo — nothing pre-existing to extend (confirmed via exploration).

export type Units = "metric" | "imperial";
export type Gender = "female" | "male" | "prefer_not_to_say";
export type DayOfWeek =
  | "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

export const DAYS_OF_WEEK: DayOfWeek[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface FixedMeal {
  title: string;
  meal_slot: string;
  recipe_uuid: string | null; // null until resolve_recipe_uuid/create_recipe_stub runs (not this phase)
}

export interface DayConstraint {
  note: string | null;
  diet_style: string | null;
  macro_bias: string | null;
  fixed_meals: FixedMeal[];
  skip_planning: boolean;
  explorer_trigger: boolean;
}

export interface RecipeSide {
  type: "recipe" | "ingredient";
  title: string;
  recipe_uuid: string | null;
}

export interface PreferredRecipe {
  title: string;
  has_side: boolean;
  sides: RecipeSide[];
  recipe_uuid: string | null;
}

export interface Pairing {
  main: string; // slug — a dish sampled by n_pairing_cards' sample_from, independent of
                 // taste_profile.favorite_dishes (see pairing_cards_design.md §1)
  sides: RecipeSide[];
}

export interface VarietyRotation {
  rotation: string[];
  min_distinct_sources_per_week: number | null;
  max_same_source_consecutive_days: number | null;
}

export interface UserMemory {
  version: string;
  last_updated: string | null;
  profile: {
    biometrics: {
      gender: Gender | null;
      age: number | null;
      height: number | null;
      weight: number | null;
    };
    locale: {
      units: Units | null;
      timezone: string | null;
      week_start_day: DayOfWeek | null;
    };
    consent: { accepted: boolean; accepted_at: string | null };
    onboarding_completed_at: string | null;
  };
  taste_profile: {
    cuisines: string[];
    sub_cuisines: string[];
    favorite_dishes: string[];
  };
  dietary: {
    notes: string | null;
    health_condition_notes: string | null; // (new) — see n_health_condition_note; deliberately
                                             // separate from `notes` (n_intolerances writes that)
    allergies: string[];
    intolerances: string[];
    diet_type: { preferred: string[]; to_avoid: string[] };
    avoided_foods: string[];
    preferred_foods: string[];
    avoided_ingredients_uuids: string[];
  };
  pantry: {
    current_stock: unknown[];
    expiring_soon: unknown[];
    always_available: unknown[];
  };
  cooking_profile: {
    skill_level: string | null;
    budget_level: string | null;
    household_size: number | null;
    preferred_cooking_days: string[];
    day_constraints: Record<DayOfWeek, DayConstraint>;
  };
  meal_planning_preferences: {
    active_slots: string[];
    plan_snacks: boolean;
    macro_priority: string[];
    preferred_recipes: PreferredRecipe[];
    preferred_pairings: Pairing[];
    forbidden_pairings: Pairing[];
    goals_source: string | null;
    batch_cook: { enabled: boolean; max_portions: number | null; preferred_day: string | null };
    slot_kcal_budgets: {
      budgets: { breakfast: number | null; lunch: number | null; dinner: number | null; snack: number | null };
      slot_kcal_tolerance: { min: number | null; max: number | null };
    };
    variety_rules: {
      leftover_friendly: boolean | null;
      max_same_recipe_per_week: number | null;
      protein_variety: VarietyRotation;
      carb_variety: VarietyRotation; // (new) mirrors protein_variety
      fat_variety: VarietyRotation; // (new) mirrors protein_variety
      daily_composition: { pattern: unknown[]; main_meals: unknown[] };
      weekly_diet_pattern: {
        vegan_days: number | null;
        vegetarian_days: number | null;
        pescatarian_days: number | null;
        omnivore_days: number | null;
      };
    };
    unique_items_per_day: number | null;
    // Internal bookkeeping for n_pairing_cards' sample_from, not part of the real profile
    // schema (absent from user_memory_sample_filled.json) — stripped at n_compile (see
    // server-memory.ts's commitUserMemory). pairing_sample is the array repeat_for actually
    // iterates over (plain dish-value strings, matching every other repeat_for usage — see
    // pairing.ts's header note on why richer {label,options} data is looked up fresh at
    // render time instead of cached here). pairing_sample_source snapshots taste_profile.
    // cuisines at the moment the sample was computed; a mismatch against the CURRENT value
    // is what triggers recomputation (self-invalidating — see engine.ts's ensureSampleComputed)
    // rather than depending on the back-navigation truncate-and-revert mechanism, which never
    // sees this pair of fields (they're written before any history entry for this node exists).
    pairing_sample?: string[];
    pairing_sample_source?: string[];
  };
  explorer_handoff: {
    trigger_when: unknown[];
    max_new_recipes_per_week: number | null;
    preferred_discovery_mode: string | null;
  };
  planning_history: {
    recent_recipes: unknown[];
    disliked_recently: unknown[];
    last_planned_week: string | null;
    do_not_repeat_until: unknown[];
  };
  // Staging area for other_capture free-text entries, keyed by the same `section` tag as
  // other_capture.validation.payload.section (e.g. "cuisine_broad", "allergies"). A parallel
  // note, not a replacement — the entry is ALSO written to its real field (taste_profile.cuisines,
  // dietary.allergies, ...) as usual; this just flags which of those entries are user-typed and
  // still need a future tier-2/3 agent pass (validation / dish suggestions / enrichment) rather
  // than being pre-resolved curated content. A future agent can clear an entry here once it's
  // processed, or the whole section once nothing's left.
  //
  // FLAGGED FOR STAGE 2 (deferred agent work, not this pass): when a later screen in the flow
  // loads — e.g. n_protein/carb/fat_exclusion_cards — the agent should read the relevant
  // `other` section(s) already recorded earlier (say other.cuisine_broad or a future
  // other.allergies) and cross-reference them against that screen's remaining/rendered options,
  // the same way hard_exclude_sources (options-filter.ts) already does for the STRUCTURED
  // allergy/intolerance values today. A free-text "other" entry can describe the same real-world
  // thing a fixed option represents (e.g. someone typed "peanut butter" as a custom allergy);
  // the agent is what would actually recognize that overlap and suppress the redundant option —
  // this repo has no such matching logic yet, structured-value hard_exclude_sources is as far as
  // it goes without one.
  other: Record<string, string[]>;
}

// A JSONPath-ish dotted path into UserMemory, e.g. "dietary.diet_type.preferred".
// Kept as `string` rather than a template-literal union — writes_to/repeat_for
// paths are authored in YAML and resolved dynamically, not statically checked.
export type MemoryPath = string;

// ---------------------------------------------------------------------------
// Flow structure (content/onboarding/flow-structure.yaml)
// ---------------------------------------------------------------------------

export type NodeType =
  | "single_select" | "multi_select" | "pairing_cards" | "free_text" | "free_text_search"
  | "biometrics_form" | "day_meal_picker" | "day_order_picker" | "confirm_edit"
  | "consent" | "system"
  // n_summary. Writes nothing, like `system`, but its body is fetched from the Onboarding
  // Summary Agent at render time rather than being content — see SummaryScreen.tsx.
  | "summary";

export interface Branch {
  when: string;
  next: string;
}

export interface OtherCaptureStructure {
  trigger_value: string;
  appends_to: MemoryPath;
  validation?: {
    tool: string;
    payload: Record<string, unknown>;
    on_invalid: { action: "confirm_or_correct" | "reprompt" };
  };
}

export interface ResolutionTier {
  // `cuisine_table` / `cuisine_dishes` read tbl_cuisines_onboarding instead of a curated blob
  // in tbl_onboarding_content — the one place in the flow that does. See cuisines.ts for why.
  type: "curated_lookup" | "tool" | "cuisine_table" | "cuisine_dishes";
  section?: string; // curated_lookup only
  key?: string; // curated_lookup single-key form; ALSO the template ref these two resolve
  keys?: string; // curated_lookup, multi-key form (template ref, e.g. "{dietary.allergies}")
  limit?: number; // cuisine_table only — how many rows before the "Other" tile
  tool?: string; // tool only
  args?: Record<string, string>;
}

export interface OptionsSourceStructure {
  resolution_order?: ResolutionTier[];
  always_merge?: { section: string };
  section?: string; // lightweight shared-content form (days_of_week)
  from_node_options?: string; // pull {value,label} from another node's own content
  // Build options out of what the user has ALREADY told us, rather than out of curated
  // content: `path` points at an array in memory, `label_field` at the property to read off
  // each element (omit it for an array of plain strings). Both the option's label and its
  // value are that string — these feed screens that write the display text straight back,
  // so there's no separate slug to carry. n_fixed_meals.dish_name ← preferred_recipes[].title.
  from_memory_list?: { path: MemoryPath; label_field?: string };
  tool?: string; // free_text_search (search_recipe_db)
  args?: Record<string, unknown>;
}

export interface OptionsFilterStructure {
  exclude_source: MemoryPath;
  lookup_section: string;
  macro_category: "protein" | "carbs" | "fat";
  disclosure: boolean;
  hard_exclude_sources?: { exclude_source: MemoryPath; lookup_section: string }[];
  // Additional independent hard-block sources (dietary.allergies, dietary.intolerances) — a
  // protein/carb/fat option already covered by a reported allergy/intolerance shouldn't be
  // re-asked as a separate "do you eat this" choice. UNION across every source and every value
  // within a source, unlike exclude_source/lookup_section's diet intersection above: allergies
  // are independent hard constraints, not blendable preferences, so a nuts allergy must stay
  // excluded regardless of whether an unrelated eggs allergy is also reported (an intersection
  // would wrongly let one neutralize the other). lookup_section tables here are a simpler
  // { [value]: { protein: string[], carbs: string[], fat: string[] } } shape — plain excluded
  // lists, no `allowed` side (never needed — see options-filter.ts).
}

// n_pairing_cards only. Computes a random sample of dishes, drawn from `source`'s selected
// cuisines against the curated pool at `pool_section` (nested broad_cuisine -> cuisine_narrow
// -> dish -> {main_label, options} — see pairing_curated_data.yaml's header; the nesting below
// cuisine_broad is organizational only, sampling flattens across it). Proportional-round-up
// distribution: total_sample_size / (distinct selected cuisines), rounded UP, that many dishes
// picked at random from EACH cuisine's own pool (never borrowed across cuisines) — see
// pairing_cards_design.md §3.2 for the full algorithm and worked examples. top_up_tool would
// fill a cuisine whose pool is smaller than its share; a stub this phase (returns nothing),
// same posture as every other un-built tool tier in resolvers.ts — an under-covered cuisine
// just contributes fewer dishes than its share, not an error.
//
// sample_field is where the computed dish-VALUE list is cached (repeat_for points here,
// exactly like any other repeat_for target — see pairing.ts/engine.ts's ensureSampleComputed).
// source_snapshot_field caches what `source` held at computation time; the cache is reused only
// while the CURRENT value at `source` still matches this snapshot exactly — self-invalidating on
// a genuine cuisine-selection change, computed once and reused for the rest of the session
// otherwise (cache_key: session, per the design doc).
export interface SampleFromStructure {
  source: MemoryPath;
  pool_section: string;
  sample_field: MemoryPath;
  source_snapshot_field: MemoryPath;
  total_sample_size: number;
  distribution: "proportional_round_up";
  top_up_tool?: string;
}

export interface FieldStructure {
  name: string;
  type: "single_select" | "number" | "free_text_search";
  optional?: boolean;
  options_source?: OptionsSourceStructure;
  // Numeric bounds for `type: number` fields (n_biometrics). `min`/`max` are a fixed pair
  // (age); `range_by_unit` is keyed by whatever the node's `units` field holds ("metric" /
  // "imperial") for measurements whose plausible range depends on it. Bounds live in
  // flow-structure.yaml rather than code so they're tunable without a deploy, and `label` is
  // the unit shown in the validation message. Enforced on BOTH sides — see
  // biometrics-validation.ts, used by BiometricsForm.tsx and engine.ts alike.
  min?: number;
  max?: number;
  range_by_unit?: Record<string, { min: number; max: number; label?: string }>;
}

export interface FlowNodeStructure {
  id: string;
  type: NodeType;
  optional?: boolean;
  skip_if?: string;
  repeat_for?: MemoryPath;
  branches?: Branch[];
  next: string | null;
  writes_to?: MemoryPath | Record<string, MemoryPath>;
  default_if_empty?: string | boolean | Record<string, string>;
  options_source?: OptionsSourceStructure;
  // How to turn a repeat_for `item` slug into display text before it's substituted into
  // `{item}` in prompt copy. Without this, prompts read "dishes from ghanaian_cuisine".
  // `from_node_options` takes the label off another node's option list (a region's label lives
  // on n_cuisine_broad); `from_cuisine_table` reads display_name off tbl_cuisines_onboarding.
  // Both fall back to a humanised slug when the lookup misses, so a custom free-text cuisine
  // still reads sensibly. Display only — what gets written to memory is always the raw slug.
  item_label?: { from_node_options?: string; from_cuisine_table?: boolean };
  options_filter?: OptionsFilterStructure;
  sample_from?: SampleFromStructure; // n_pairing_cards only
  other_capture?: OtherCaptureStructure;
  validation?: OtherCaptureStructure["validation"]; // n_favorite_recipes' freeform validation
  infer?: { path: MemoryPath; value?: unknown; value_expr?: string }[];
  always_include?: { value: unknown; label: string }[];
  lookup?: Record<string, string[]>; // n_goal's macro_priority table
  fields?: FieldStructure[];
  editable_fields?: MemoryPath[]; // n_allergy_confirm
  free_text_note_field?: MemoryPath; // n_intolerances
  max_items?: number; // n_favorite_recipes
  allow_freeform?: boolean;
  resolve_uuid_via?: string;
  repeatable?: boolean;
  tool_calls?: string[]; // n_compile
  layout?: "list" | "grid"; // multi_select display hint — "grid" renders a 2-column tap grid
                             // instead of the default vertical list. Structural (a UI/interaction
                             // choice tied to the node's mechanics), not admin-editable copy —
                             // same reasoning as options_filter.disclosure's on/off switch.
  exclusive_value?: unknown; // multi_select "none of the above"-style option (e.g.
                              // balanced_no_specific_style, n_allergies' "none"). Symmetric:
                              // selecting this value clears+disables every other option;
                              // selecting any other option clears this one back. Structural,
                              // not content — it's a mechanic tied to what the value MEANS,
                              // same reasoning as layout above.
  require_selection?: boolean; // multi_select: Continue stays disabled until at least one
                                 // option is selected (n_allergies — always has a valid pick,
                                 // since "None of these" is itself an option, so there's never
                                 // a legitimate reason to submit zero). Most multi_select nodes
                                 // deliberately allow an empty submission (a soft "anything
                                 // specific?" ask); this opts a node OUT of that default.
  select_all_by_default?: boolean; // multi_select: every tile starts SELECTED rather than the
                                     // usual empty start (n_protein/carb/fat_exclusion_cards —
                                     // "tap what you DON'T eat," an opt-out framing). An
                                     // untouched grid then reads as "I eat everything" — the
                                     // far more common truth — rather than silently excluding
                                     // every item the user just hasn't gotten to yet, which an
                                     // opt-in ("tap what you eat") framing starting empty would.
}

export interface FlowStructure {
  meta: {
    flow_version: string;
    target_schema_version: string;
    entry_node: string;
    exit_node: string;
    autosave_after_each_node: boolean;
  };
  nodes: FlowNodeStructure[];
}

// ---------------------------------------------------------------------------
// DB content (tbl_onboarding_content)
// ---------------------------------------------------------------------------

export interface ContentOption {
  id_order: number;
  value: unknown; // string, or boolean for n_leftovers
  label: string;
  allows?: unknown[]; // multi_select pairwise compatibility whitelist (e.g. Halal only allows
                        // [halal, ramadan_fasting, lent_or_other_fasting_periods, other]) — an
                        // option with no `allows` is unrestricted (compatible with anything).
                        // Two options A and B may be selected together only if EACH side that
                        // declares an `allows` list includes the other's value — a side with no
                        // list imposes no restriction of its own. This is a mutual/AND check, not
                        // symmetric-by-assumption: an option only needs its OWN restriction stated
                        // once, on itself, rather than needing the reverse listed on every partner
                        // it excludes (the earlier `excludes` shape this replaced needed exactly
                        // that reverse bookkeeping, which is what made it error-prone to maintain).
}

export interface OtherCaptureContent {
  prompt: string;
  on_invalid_message?: string;
}

export interface NodeContent {
  prompt?: string;
  subtitle?: string;
  prompt_instructions?: string;
  skip_label?: string;
  disclosure_template?: string;
  options?: ContentOption[];
  fields?: Record<string, { label?: string; options?: ContentOption[] }>;
  other_capture?: OtherCaptureContent;
  on_invalid_message?: string; // n_favorite_recipes' freeform validation copy
  no_options_message?: string; // n_protein/carb/fat_exclusion_cards — client-side stand-in for
                                 // `prompt` when every fixed category is disabled (options_filter
                                 // excluded it, or the user manually deselected everything) — see
                                 // MultiSelect.tsx's needsAlternative. No skip_label counterpart:
                                 // that state hides the skip button entirely (see needsAlternative)
                                 // rather than swap its copy — an escape hatch there would defeat
                                 // the point of forcing a real other_capture answer.
  exclusion_disclaimer?: string; // n_protein/carb/fat_exclusion_cards — shown once, above the
                                   // grid, whenever ANY tile is disabled (options_filter excluded
                                   // it) — explains why some options are greyed out instead of
                                   // just silently missing, and that going back can change it.
  preferred_prompt?: string; // n_pairing_cards — "Which of these goes well with {dish}?"; {dish}
                               // is interpolated to the sampled dish's own label (e.g. "Falafel"),
                               // resolved at render time from the curated pool, not from `item`
                               // directly (item stays the bare dish slug everywhere else in the
                               // engine — see PairingCards.tsx / engine.ts's renderNode).
  forbidden_prompt?: string; // n_pairing_cards — "Which of these would you never pair with {dish}?"
}

export interface DaysOfWeekContent {
  options: ContentOption[];
}

// ---------------------------------------------------------------------------
// The merged, renderable node (flow-structure + DB content combined)
// ---------------------------------------------------------------------------

export type RenderedField = FieldStructure & { label?: string; options?: ContentOption[] };
export type RenderedOtherCapture = OtherCaptureStructure & Partial<OtherCaptureContent>;
// options_filter no longer REMOVES excluded options from what's rendered — it marks them
// `disabled` instead (n_protein/carb/fat_exclusion_cards show every fixed category, greyed out
// where it doesn't fit the user's diet/allergies/intolerances, rather than silently vanishing —
// see options-filter.ts and MultiSelect.tsx). Every other node's options are never disabled this
// way, so this is always undefined for them.
export type RenderedOption = ContentOption & { disabled?: boolean };

export interface RenderedNode extends Omit<FlowNodeStructure, "fields" | "other_capture">, Omit<NodeContent, "fields" | "other_capture" | "options"> {
  fields?: RenderedField[];
  other_capture?: RenderedOtherCapture;
  options?: RenderedOption[];
  disclosure_text?: string; // rendered disclosure_template, only set when options_filter excluded something
  // Per-cause attribution for the greyed-out tiles — "Lactose intolerance" ruled out Butter and
  // Ghee. Built by options-filter.ts from the answers themselves, so it needs no authored copy;
  // the prose frame around it is the node's own `exclusion_disclaimer` content.
  exclusion_reasons?: { cause: string; labels: string[] }[];
  recap_values?: Record<MemoryPath, unknown>; // n_allergy_confirm — actual current values of editable_fields
}

// ---------------------------------------------------------------------------
// Flow position (tbl_user_memory.flow_position) — the resume/back history stack
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Answer — the one flexible shape the UI submits for every node type.
// Not a discriminated union per node type: most nodes only ever populate
// one or two of these fields, and engine.ts's writeNodeAnswer switches on
// the node's structural `type` to know which ones to read.
// ---------------------------------------------------------------------------

export interface DayMealEntry {
  day_of_week: DayOfWeek;
  meal_slot: string;
  dish_label: string;
  dish_value?: string; // recipe_uuid if resolved via search; undefined for a freeform title
}

export interface RecipePick {
  label: string; // dish title
  value?: string; // recipe_uuid if picked from search results; undefined for a freeform entry
}

// One resolved "other" piece, already validated (or, for a section outside the Onboarding
// Validator Agent's scope, passed through untouched) before submission. `value`/`label` are the
// agent's own normalization when one exists; both `null` means "write the raw entry text" —
// either the agent genuinely couldn't normalize it, or the section is out of the agent's scope
// (see validator-sections.ts) and was never sent to it at all. See engine.ts's other_capture
// write branch for how this gets applied, and MultiSelect.tsx/FreeTextSearch.tsx for how it's
// built client-side from /api/onboarding/validate-other's response.
export interface OtherEntryResult {
  entry: string;
  value: string | null;
  label: string | null;
}

export interface Answer {
  skipped?: boolean; // whole-node bypass ("Skip" / skip_label button)
  values?: unknown[]; // single/multi_select picks, or pairing_cards' checked "goes well" sides
  left_values?: unknown[]; // pairing_cards' checked "never pair" sides
  text?: string; // free_text, or free_text_search's freeform note
  other_text?: string; // other_capture follow-up, raw joined text — legacy path, still used
                         // whenever other_entries isn't populated (see engine.ts); the split-
                         // on-,/;/\n-server-side behavior is unchanged for that path
  other_entries?: OtherEntryResult[]; // preferred path once other_text has gone through
                                        // client-side validation (validate-other) — see engine.ts
  recipe_picks?: RecipePick[]; // n_favorite_recipes
  fields?: Record<string, unknown>; // n_biometrics
  day_order_value?: string; // n_week_start
  day_meal_entries?: DayMealEntry[]; // n_fixed_meals
  confirm_edit_action?: "confirm" | "edit"; // n_allergy_confirm
}

export interface HistoryEntry {
  node_id: string;
  repeat_key?: string; // disambiguates repeat_for iterations
  entered_at: string;
  exited_at: string | null;
  default_applied?: boolean; // true if this node's value came from default_if_empty,
                              // not genuine interaction — see repeat_for's terminal-not-
                              // cascading rule
  pre_write_snapshot?: Record<MemoryPath, unknown>; // for back/truncate-and-revert
  resolved_next?: { nodeId: string; item?: string } | null; // what advanceFlow computed as `next` when this
                                                              // node was exited — null means terminal. Lets
                                                              // resume recover precisely (incl. branch outcomes)
                                                              // if the "open next entry" write is ever missing,
                                                              // instead of restarting the whole flow from
                                                              // entry_node — see resolveResumeTarget in engine.ts.
}

export type FlowPosition = HistoryEntry[];
