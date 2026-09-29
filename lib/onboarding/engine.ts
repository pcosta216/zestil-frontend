import { getNodeStructure, getEntryNodeId } from "./flow-structure";
import { getNodeContent, sortByOrder } from "./content";
import { renderNodeBase } from "./render-node";
import { resolveOptions } from "./resolvers";
import { applyOptionsFilter, resolveAllOptions } from "./options-filter";
import { computePairingSample, findPairingDish } from "./pairing";
import { getCuisineLabel, humanizeSlug } from "./cuisines";
import { validateBiometrics } from "./biometrics-validation";
import { evaluateCondition } from "./expr";
import { appendUnique, getPath, setPath } from "./paths";
import { DAYS_OF_WEEK, type Answer, type FlowNodeStructure, type FlowPosition, type HistoryEntry, type RenderedNode, type RenderedOption, type UserMemory } from "./types";

// The pure graph walker. Every exported function here takes the current
// (memory, history) and returns a NEW memory/history — never mutates its
// inputs — so callers (API routes) can decide when/whether to persist.

// ---------------------------------------------------------------------------
// Rendering — produces the fully resolved node a screen actually shows
// ---------------------------------------------------------------------------

export interface RenderResult {
  node: RenderedNode;
  item?: string;
}

export async function renderNode(nodeId: string, item: string | undefined, memory: UserMemory): Promise<RenderResult> {
  const base = await renderNodeBase(nodeId);
  const structure = getNodeStructure(nodeId);

  let options: RenderedOption[] | undefined = base.options;
  if (structure.options_source) {
    const resolved = await resolveOptions(structure.options_source, { item, memory });
    if (resolved.length > 0) options = resolved;
  }

  if (structure.options_filter && options) {
    const content = await getNodeContent(nodeId);
    const result = await applyOptionsFilter(structure.options_filter, options, content.disclosure_template, memory);
    // Every fixed category still renders (n_protein/carb/fat_exclusion_cards show all 8 tiles
    // regardless of diet/allergies/intolerances) — marked `disabled` rather than removed, so the
    // user can SEE what got ruled out and why (exclusion_disclaimer, below the prompt) instead
    // of a fixed option just silently vanishing with no explanation. The "genuinely selectable
    // subset" concept (result.filteredOptions) still drives checkSkip's auto-skip decision and
    // the write-path's defensive filtering (writeNodeAnswer) — unaffected by this.
    options = options.map((o) => ({ ...o, disabled: result.excludedValues.includes(o.value) }));
    base.disclosure_text = result.disclosureText;
    base.exclusion_reasons = result.exclusionReasons;
  }

  // Field-level options_source (n_fixed_meals' day_of_week → content:days_of_week,
  // meal_slot → from_node_options: n_active_slots) — the static per-field content
  // options renderNodeBase already merged in only cover biometrics_form's plain lists.
  let fields = base.fields;
  if (fields) {
    const fieldStructures = structure.fields ?? [];
    fields = await Promise.all(
      fields.map(async (field) => {
        const fieldStructure = fieldStructures.find((f) => f.name === field.name);
        if (!fieldStructure?.options_source) return field;
        const resolved = await resolveOptions(fieldStructure.options_source, { item, memory });
        return resolved.length > 0 ? { ...field, options: resolved } : field;
      })
    );
  }

  // n_pairing_cards: `item` is the bare sampled dish value (e.g. "falafel") — its display
  // label and 4 curated side options are looked up fresh here rather than cached alongside
  // the sample (see SampleFromStructure's header note). `{dish}` in prompt/preferred_prompt/
  // forbidden_prompt is this node's OWN interpolation placeholder, separate from the generic
  // `{item}` one below (which would substitute the raw slug, not the nice label).
  if (structure.type === "pairing_cards" && item !== undefined) {
    const dish = await findPairingDish(item);
    if (dish) {
      options = dish.options;
      const sub = (text: string | undefined) => text?.replace(/\{dish\}/g, dish.main_label);
      base.prompt = sub(base.prompt);
      base.preferred_prompt = sub(base.preferred_prompt);
      base.forbidden_prompt = sub(base.forbidden_prompt);
    }
  }

  // prompt/skip_label swapping for the "nothing selectable" state moved client-side
  // (MultiSelect.tsx's needsAlternative) — now that disabled tiles stay visible instead of the
  // grid disappearing, that state can be reached either by filtering (every tile disabled) or by
  // the user manually deselecting everything, and only the client knows which case it's in.
  // `{item}` is a slug in memory (`ghanaian_cuisine`, `latin_american`); prompts need the
  // display label. Resolved per structure.item_label — see types.ts — never by mangling the
  // slug, except as the fallback when no authoritative label exists (a custom free-text
  // cuisine has no table row). The raw slug is still what gets written; this is display only.
  const itemLabel = await resolveItemLabel(structure, item);
  const prompt = base.prompt ? interpolate(base.prompt, itemLabel) : base.prompt;
  const otherCapture = base.other_capture
    ? {
        ...base.other_capture,
        prompt: base.other_capture.prompt ? interpolate(base.other_capture.prompt, itemLabel) : base.other_capture.prompt,
        on_invalid_message: base.other_capture.on_invalid_message
          ? interpolate(base.other_capture.on_invalid_message, itemLabel)
          : base.other_capture.on_invalid_message,
      }
    : undefined;

  // n_allergy_confirm: recap the ACTUAL current values of editable_fields, not just static
  // copy — this is the one node with an explicit confirm-before-write safety step, so showing
  // the real list (not a generic placeholder) is the point of the screen.
  let recapValues: Record<string, unknown> | undefined;
  if (structure.editable_fields) {
    recapValues = {};
    for (const path of structure.editable_fields) recapValues[path] = getPath(memory as unknown as Record<string, unknown>, path);
  }

  return {
    node: { ...base, options, fields, other_capture: otherCapture, prompt, recap_values: recapValues },
    item,
  };
}

function interpolate(text: string, item: string | undefined): string {
  return item !== undefined ? text.replace(/\{item\}/g, item) : text;
}

/**
 * Display text for a repeat_for `item`. Authoritative label first (another node's option list,
 * or tbl_cuisines_onboarding.display_name), humanised slug second, raw slug last. Never throws
 * — a missing label degrades the copy, it shouldn't take the screen down.
 */
async function resolveItemLabel(structure: FlowNodeStructure, item: string | undefined): Promise<string | undefined> {
  if (item === undefined) return undefined;
  const spec = structure.item_label;
  if (!spec) return item;

  try {
    if (spec.from_node_options) {
      const content = await getNodeContent(spec.from_node_options);
      const match = (content.options ?? []).find((o) => o.value === item);
      if (match?.label) return match.label;
    }
    if (spec.from_cuisine_table) {
      const label = await getCuisineLabel(item);
      if (label) return label;
    }
  } catch {
    // fall through to the humanised form
  }
  return humanizeSlug(item);
}

// ---------------------------------------------------------------------------
// repeat_for / default_if_empty-is-terminal
// ---------------------------------------------------------------------------

/** Finds the most recent history entry that wrote to `path` (as its writes_to target) and reports whether that write came from default_if_empty rather than genuine interaction. */
function wasValueDefaulted(path: string, history: FlowPosition): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const structure = getNodeStructure(entry.node_id);
    const targets = typeof structure.writes_to === "string" ? [structure.writes_to] : Object.values(structure.writes_to ?? {});
    if (targets.includes(path)) return entry.default_applied === true;
  }
  return false;
}

function getRepeatForItems(structure: FlowNodeStructure, memory: UserMemory, history: FlowPosition): string[] {
  if (!structure.repeat_for) return [];
  if (wasValueDefaulted(structure.repeat_for, history)) return []; // terminal, not cascading — see flow-structure.yaml header
  const arr = getPath(memory as unknown as Record<string, unknown>, structure.repeat_for);
  return Array.isArray(arr) ? (arr as string[]) : [];
}

// ---------------------------------------------------------------------------
// skip_if (including the options_filter cardinality special case)
// ---------------------------------------------------------------------------

interface SkipCheck {
  skip: boolean;
}

async function checkSkip(structure: FlowNodeStructure, item: string | undefined, memory: UserMemory): Promise<SkipCheck> {
  // options_filter nodes (n_protein/carb/fat_exclusion_cards) never auto-skip via cardinality
  // anymore — always render, regardless of how many options survive filtering. Previously
  // "exactly 1 remaining" silently skipped the screen entirely and auto-wrote that option as
  // allowed; that predates the disabled-tiles redesign and became inconsistent with it — the
  // whole point of always rendering the full grid (disabled tiles + exclusion_disclaimer + a
  // back-navigate escape hatch) is so the user SEES what got excluded and why, and a silent
  // skip defeats that for exactly the case (down to 1 real choice) where it matters most.
  // select_all_by_default already handles 1-remaining correctly on its own: the one selectable
  // option is pre-selected, Continue works immediately, no special-casing needed. Zero
  // remaining also just renders normally — see renderNode/MultiSelect's needsAlternative.
  if (structure.options_filter) return { skip: false };

  if (!structure.skip_if) return { skip: false };
  return { skip: evaluateCondition(structure.skip_if, { item, memory: memory as unknown as Record<string, unknown> }) };
}

// ---------------------------------------------------------------------------
// Advancing the flow — resolves the next CONCRETE node instance to render,
// walking through repeat_for expansion and skip_if auto-skips.
// ---------------------------------------------------------------------------

export type FlowTarget = { nodeId: string; item?: string } | { terminal: true };

function resolveStructuralNext(structure: FlowNodeStructure, answer: unknown): string | null {
  for (const b of structure.branches ?? []) {
    if (evaluateCondition(b.when, { answer, memory: {} })) return b.next;
  }
  return structure.next;
}

/**
 * n_pairing_cards only. Computes the random dish sample once and caches it at
 * sample_field (repeat_for then reads it exactly like any other repeat_for target) — reused
 * for the rest of the session unless the CURRENT value at `source` no longer matches what's
 * snapshotted at source_snapshot_field, which forces a fresh sample. Self-invalidating this
 * way rather than depending on the back-navigation truncate-and-revert mechanism, which never
 * sees these two fields (they're written here, before any history entry for this node
 * instance exists, not as part of an answered node's own writes_to).
 */
async function ensureSampleComputed(structure: FlowNodeStructure, memory: UserMemory): Promise<void> {
  const sf = structure.sample_from;
  if (!sf) return;
  const mem = memory as unknown as Record<string, unknown>;
  const currentSource = (getPath(mem, sf.source) as string[] | undefined) ?? [];
  const cachedSource = getPath(mem, sf.source_snapshot_field) as string[] | undefined;
  const cachedSample = getPath(mem, sf.sample_field);
  const sourceUnchanged =
    Array.isArray(cachedSource) && cachedSource.length === currentSource.length && cachedSource.every((v, i) => v === currentSource[i]);
  if (Array.isArray(cachedSample) && sourceUnchanged) return;

  const sample = await computePairingSample(currentSource, sf.total_sample_size);
  setPath(mem, sf.sample_field, sample);
  setPath(mem, sf.source_snapshot_field, currentSource);
}

async function resolveEntry(nodeId: string, item: string | undefined, memory: UserMemory, history: HistoryEntry[]): Promise<FlowTarget> {
  const structure = getNodeStructure(nodeId);

  if (structure.sample_from && item === undefined) {
    await ensureSampleComputed(structure, memory);
  }

  if (structure.repeat_for && item === undefined) {
    const items = getRepeatForItems(structure, memory, history);
    if (items.length === 0) {
      const nextId = resolveStructuralNext(structure, undefined);
      return nextId === null ? { terminal: true } : resolveEntry(nextId, undefined, memory, history);
    }
    item = items[0];
  }

  const skipCheck = await checkSkip(structure, item, memory);
  if (skipCheck.skip) {
    if (structure.repeat_for && item !== undefined) {
      const items = getRepeatForItems(structure, memory, history);
      const nextItem = items[items.indexOf(item) + 1];
      if (nextItem !== undefined) return resolveEntry(nodeId, nextItem, memory, history);
    }
    const nextId = resolveStructuralNext(structure, undefined);
    return nextId === null ? { terminal: true } : resolveEntry(nextId, undefined, memory, history);
  }

  return { nodeId, item };
}

async function advanceFlow(
  fromNodeId: string,
  fromItem: string | undefined,
  answer: unknown,
  memory: UserMemory,
  history: HistoryEntry[],
  skippedWholeNode = false
): Promise<FlowTarget> {
  const fromStructure = getNodeStructure(fromNodeId);

  // A whole-node Skip on an `optional` repeat_for node (n_pairing_cards) bypasses every
  // remaining sampled iteration, matching what "Skip" means on every other optional node —
  // the plain per-item advancement below would otherwise just move to the NEXT dish, since
  // repeat_for has no built-in concept of "abandon the rest of the sequence."
  const bypassRemainingIterations = skippedWholeNode && fromStructure.optional === true;

  if (fromStructure.repeat_for && fromItem !== undefined && !bypassRemainingIterations) {
    const items = getRepeatForItems(fromStructure, memory, history);
    const nextItem = items[items.indexOf(fromItem) + 1];
    if (nextItem !== undefined) return resolveEntry(fromNodeId, nextItem, memory, history);
  }

  const candidateId = resolveStructuralNext(fromStructure, answer);
  if (candidateId === null) return { terminal: true };
  return resolveEntry(candidateId, undefined, memory, history);
}

export async function entryPoint(memory: UserMemory, history: HistoryEntry[]): Promise<FlowTarget> {
  const target = await resolveEntry(getEntryNodeId(), undefined, memory, history);
  if (!("terminal" in target)) ensureOpenEntry(target.nodeId, target.item, memory, history);
  return target;
}

// ---------------------------------------------------------------------------
// Writing an answer into memory
// ---------------------------------------------------------------------------

/** True if the current value at `path` in the (empty) skeleton is an array — i.e. this target should be appended-to, not overwritten. */
function isArrayTarget(memory: UserMemory, path: string): boolean {
  return Array.isArray(getPath(memory as unknown as Record<string, unknown>, path));
}

function writeScalarOrArray(memory: UserMemory, path: string, values: unknown[]): void {
  if (isArrayTarget(memory, path)) {
    for (const v of values) appendUnique(memory as unknown as Record<string, unknown>, path, v);
  } else if (values.length > 0) {
    setPath(memory as unknown as Record<string, unknown>, path, values[0]);
  }
}

/** Returns true if default_if_empty fired (used to tag the history entry for the repeat_for terminal rule). */
async function writeNodeAnswer(structure: FlowNodeStructure, answer: Answer, memory: UserMemory, item: string | undefined): Promise<boolean> {
  const writesTo = structure.writes_to;

  // --- pairing_cards: two independent checked-side lists per dish screen (values = preferred,
  // left_values = forbidden — same field names swipe_cards' reaction_map used to write, now
  // just two checkbox groups instead of two swipe directions). A dish only gets an entry in
  // preferred_pairings/forbidden_pairings if at least one side was checked in that respective
  // question — never an empty `sides` array (see pairing_cards_design.md §4). `main` is
  // `item` directly (the sampled dish's bare value, e.g. "falafel"). recipe_uuid stays null —
  // resolve_recipe_uuid isn't built yet, same stub posture as favorite_recipes/fixed_meals.
  if (structure.type === "pairing_cards" && writesTo && typeof writesTo === "object" && item !== undefined) {
    const writesToObj = writesTo as Record<string, string>;
    const preferred = (answer.values ?? []) as string[];
    const forbidden = (answer.left_values ?? []) as string[];
    const dish = await findPairingDish(item);
    const labelFor = (value: string) => dish?.options.find((o) => o.value === value)?.label ?? value;

    if (preferred.length > 0 && writesToObj.preferred) {
      appendUnique(memory as unknown as Record<string, unknown>, writesToObj.preferred, {
        main: item,
        sides: preferred.map((v) => ({ title: labelFor(v), recipe_uuid: null })),
      });
    }
    if (forbidden.length > 0 && writesToObj.forbidden) {
      appendUnique(memory as unknown as Record<string, unknown>, writesToObj.forbidden, {
        main: item,
        sides: forbidden.map((v) => ({ title: labelFor(v), recipe_uuid: null })),
      });
    }
    return false;
  }

  // --- multi_select "tap what applies, the rest of the shown list is the complement"
  // (n_protein/carb/fat_exclusion_cards): writes_to is {excluded, allowed} — same shape the old
  // swipe_cards reaction_map used, but there's no gesture/sides here. `values` (what's selected,
  // "I eat this") IS the allowed set; excluded is computed as "every option that was actually
  // shown minus what's selected" — needs the SAME options_filter-narrowed list rendering used,
  // since a diet-implied exclusion (already filtered out, never shown as a tile) must not
  // reappear here — those get seeded separately by applyAnswer's own options_filter block below.
  if (structure.type === "multi_select" && writesTo && typeof writesTo === "object") {
    const writesToObj = writesTo as Record<string, string>;
    const values = answer.values ?? [];

    // A no-options-remaining submission (forced other_capture, nothing tappable) has empty
    // `values` by construction — that must NOT be read as "nothing answered, apply the default"
    // when the user actually typed a custom answer. Checks BOTH carriers: other_entries (the
    // validated path) and other_text (the legacy/raw one) — a client sending only the former
    // would otherwise get its real answer silently overwritten by default_if_empty.
    const hasCustomEntry = Boolean(answer.other_entries?.length) || Boolean(answer.other_text);
    if (values.length === 0 && !hasCustomEntry && structure.optional && structure.default_if_empty !== undefined) {
      applyDefaultIfEmpty(structure, memory);
      return true;
    }

    let shownOptions = sortByOrder((await getNodeContent(structure.id)).options ?? []);
    if (structure.options_filter) {
      const filterResult = await applyOptionsFilter(structure.options_filter, shownOptions, undefined, memory);
      shownOptions = filterResult.filteredOptions;
    }
    const shownValues = new Set(shownOptions.map((o) => o.value));
    // Defensive against a stale client: only values that were genuinely offered (still in the
    // options_filter-narrowed list) count as a real "allowed" pick — a hard-excluded item (a
    // reported allergy/intolerance, or a diet-implied exclusion) was never actually a selectable
    // tile, so it can't land as "allowed" even if a stale submission still includes it. It gets
    // excluded regardless, via the separate unconditional options_filter block below.
    const selectedShown = values.filter((v) => shownValues.has(v));
    const excludedValues = shownOptions.map((o) => o.value).filter((v) => !selectedShown.includes(v));
    if (writesToObj.allowed) writeScalarOrArray(memory, writesToObj.allowed, selectedShown);
    if (writesToObj.excluded) writeScalarOrArray(memory, writesToObj.excluded, excludedValues);
    return false;
  }

  // --- confirm_edit / consent / system / summary / free_text_search with no plain writes_to string ---
  if (structure.type === "confirm_edit" || structure.type === "system" || structure.type === "summary") return false;

  if (structure.type === "consent") {
    if (typeof writesTo === "string") {
      setPath(memory as unknown as Record<string, unknown>, writesTo, { accepted: true, accepted_at: new Date().toISOString() });
    }
    return false;
  }

  if (structure.type === "biometrics_form" && writesTo && typeof writesTo === "object") {
    // Same bounds the form enforces inline (biometrics-validation.ts) — re-checked here so a
    // stale or hand-rolled client can't land an out-of-range age/height/weight. A failing field
    // is simply not written (its skeleton default stands) rather than throwing, matching how
    // the multi_select path already defensively drops values that were never really offered.
    const invalidFields = new Set(
      validateBiometrics(structure.fields ?? [], (answer.fields ?? {}) as Record<string, unknown>).map((i) => i.field)
    );
    for (const [fieldName, target] of Object.entries(writesTo as Record<string, string>)) {
      const value = answer.fields?.[fieldName];
      if (value === undefined || invalidFields.has(fieldName)) continue;
      setPath(memory as unknown as Record<string, unknown>, target, value);
    }
    return false;
  }

  if (structure.type === "day_order_picker" && typeof writesTo === "string") {
    if (answer.day_order_value !== undefined) setPath(memory as unknown as Record<string, unknown>, writesTo, answer.day_order_value);
    return false;
  }

  if (structure.type === "day_meal_picker" && typeof writesTo === "string") {
    for (const entry of answer.day_meal_entries ?? []) {
      const target = writesTo.replace("{day_of_week}", entry.day_of_week);
      appendUnique(memory as unknown as Record<string, unknown>, target, {
        title: entry.dish_label,
        meal_slot: entry.meal_slot,
        recipe_uuid: entry.dish_value ?? null,
      });
    }
    return false;
  }

  if (structure.type === "free_text_search" && typeof writesTo === "string") {
    for (const pick of answer.recipe_picks ?? []) {
      appendUnique(memory as unknown as Record<string, unknown>, writesTo, {
        title: pick.label,
        has_side: false,
        sides: [],
        recipe_uuid: pick.value ?? null,
      });
    }
    return false;
  }

  if (structure.type === "free_text" && typeof writesTo === "string") {
    if (answer.text) setPath(memory as unknown as Record<string, unknown>, writesTo, answer.text);
    return false;
  }

  // --- plain single_select / multi_select ---
  if (typeof writesTo === "string") {
    const values = answer.values ?? [];

    if (structure.id === "n_goal") {
      // Special case: the WRITTEN value is looked up from structure.lookup, not the raw answer.
      const picked = values.length > 0 ? (values[0] as string) : (structure.default_if_empty as string | undefined);
      const macroOrder = picked ? structure.lookup?.[picked] : undefined;
      if (macroOrder) setPath(memory as unknown as Record<string, unknown>, writesTo, macroOrder);
      return values.length === 0;
    }

    if (values.length === 0 && structure.optional && structure.default_if_empty !== undefined) {
      applyDefaultIfEmpty(structure, memory);
      return true;
    }
    // The "other" trigger value itself is a UI placeholder, not real data — it should never
    // land in writes_to. The actual custom text (answer.other_text) is what belongs there,
    // appended separately below via other_capture.appends_to (same target, for every node
    // with other_capture today). Emptiness above is still checked against the RAW values
    // (so picking only "Other" doesn't wrongly count as "nothing picked" and trigger
    // default_if_empty) — only the write itself excludes the placeholder.
    const writtenValues = structure.other_capture ? values.filter((v) => v !== structure.other_capture!.trigger_value) : values;
    writeScalarOrArray(memory, writesTo, writtenValues);
  }

  return false;
}

function applyDefaultIfEmpty(structure: FlowNodeStructure, memory: UserMemory): void {
  const def = structure.default_if_empty;
  if (def === undefined) return;
  const writesTo = structure.writes_to;

  if (typeof def === "object") {
    // e.g. { allowed: "all_options" } — "all_options" here means the node's OWN static list;
    // for protein/carb/fat this is only reached via the whole-node Skip button (not the
    // options_filter auto-skip path, which resolves all_options against the FILTERED list
    // itself in checkSkip). A plain Skip with no options_filter narrowing falls back to the
    // node's full static option set.
    for (const [key, value] of Object.entries(def)) {
      const target = writesTo && typeof writesTo === "object" ? (writesTo as Record<string, string>)[key] : undefined;
      if (!target) continue;
      if (value === "all_options") continue; // resolved by the caller when options are known; see engine's applyAnswer for the skip-button path
      setPath(memory as unknown as Record<string, unknown>, target, value);
    }
    return;
  }

  if (typeof writesTo === "string") {
    // A scalar default against a STRING writes_to needs to know whether the target is an array
    // field (append — n_cuisine_broad's taste_profile.cuisines) or a genuine scalar (set — no
    // current node does this, since n_goal's single_select-with-default is special-cased above
    // and never reaches here, but a future one could).
    if (isArrayTarget(memory, writesTo)) {
      appendUnique(memory as unknown as Record<string, unknown>, writesTo, def);
    } else {
      setPath(memory as unknown as Record<string, unknown>, writesTo, def);
    }
  } else if (writesTo && typeof writesTo === "object") {
    // swipe_cards with a single scalar default (mediterranean, no_specific_practice) applies to
    // the "positive"/first-listed key (preferred / follows / preferred).
    const firstKey = Object.keys(writesTo)[0];
    appendUnique(memory as unknown as Record<string, unknown>, (writesTo as Record<string, string>)[firstKey], def);
  }
}

// ---------------------------------------------------------------------------
// applyAnswer — the main entry point API routes call
// ---------------------------------------------------------------------------

export interface ApplyAnswerParams {
  nodeId: string;
  item?: string;
  answer: Answer;
  memory: UserMemory;
  history: FlowPosition;
}

export interface ApplyAnswerResult {
  memory: UserMemory;
  history: FlowPosition;
  next: FlowTarget;
}

/** other_capture's domain tag (e.g. "cuisine_broad") — reused as both the validate_other_entry
 * payload's `section` and the key into memory.other's staging lists, rather than inventing a
 * second field that means the same thing. */
function otherCaptureSection(structure: FlowNodeStructure): string | undefined {
  const section = structure.other_capture?.validation?.payload.section;
  return typeof section === "string" ? section : undefined;
}

function collectWriteTargets(structure: FlowNodeStructure): string[] {
  const targets = new Set<string>();
  if (typeof structure.writes_to === "string") targets.add(structure.writes_to);
  else if (structure.writes_to) for (const v of Object.values(structure.writes_to)) targets.add(v);
  for (const inf of structure.infer ?? []) targets.add(inf.path);
  if (structure.other_capture) {
    targets.add(structure.other_capture.appends_to);
    const section = otherCaptureSection(structure);
    if (section) targets.add(`other.${section}`);
  }
  if (structure.free_text_note_field) targets.add(structure.free_text_note_field);
  if (structure.type === "day_meal_picker" && typeof structure.writes_to === "string") {
    for (const day of DAYS_OF_WEEK) targets.add(structure.writes_to.replace("{day_of_week}", day));
  }
  // A path still holding a `{placeholder}` addresses no real location — n_fixed_meals' writes_to
  // is `cooking_profile.day_constraints.{day_of_week}.fixed_meals`, expanded per day just above.
  // Snapshotting the raw form isn't merely useless: revert does setPath on every snapshot key,
  // and setPath creates missing parents, so a Back through such a node materialises a literal
  // "{day_of_week}" sibling of the real monday-sunday keys. Filtered here rather than at each
  // `targets.add` so any future templated write path is covered by construction.
  return [...targets].filter((t) => !t.includes("{"));
}

/**
 * Ensures (nodeId, item) has an OPEN history entry — creating one (with a
 * pre-write snapshot) if it isn't already the open entry. Called both when
 * ANSWERING a node (applyAnswer) and when simply RENDERING one for the
 * first time (the state route, on resume) — so history always ends with
 * an open entry for "what the user should see next," even if they close
 * the app having seen a node's cards but never swiped. Mutates `history`
 * in place (callers already pass a fresh clone).
 */
export function ensureOpenEntry(nodeId: string, item: string | undefined, memory: UserMemory, history: FlowPosition): void {
  if (history.some((h) => h.node_id === nodeId && h.repeat_key === item && h.exited_at === null)) return;
  const structure = getNodeStructure(nodeId);
  const snapshot: Record<string, unknown> = {};
  for (const t of collectWriteTargets(structure)) {
    // Every write target here is either a scalar (already initialized to null/string by the
    // skeleton, never undefined) or an array field — including memory.other.<section>, which
    // doesn't exist until its first write. Defaulting undefined to [] keeps a reverted target
    // the same shape a never-touched one already has, rather than leaving a bare `undefined`
    // a future reader (array methods, .length) could trip over.
    const current = getPath(memory as unknown as Record<string, unknown>, t);
    snapshot[t] = structuredClone(current === undefined ? [] : current);
  }
  history.push({ node_id: nodeId, repeat_key: item, entered_at: new Date().toISOString(), exited_at: null, pre_write_snapshot: snapshot });
}

/**
 * Attaches a previously-given answer to the trailing OPEN entry, so the screen about to render
 * can show what was chosen last time (Back, and confirm_edit's "something's wrong" rewind).
 *
 * No-op unless that entry is genuinely the node the answer came from: rewinding to a node that
 * then auto-skips lands somewhere else entirely, and echoing one node's answer onto another's
 * screen would pre-select values that were never picked there.
 */
function recallAnswerOnOpenEntry(history: FlowPosition, nodeId: string, item: string | undefined, answer: Answer | undefined): void {
  const last = history[history.length - 1];
  if (!answer || !last || last.exited_at !== null || last.node_id !== nodeId || last.repeat_key !== item) return;
  history[history.length - 1] = { ...last, answer };
}

/**
 * What the user answered on the node that's open right now, if they arrived back on it rather
 * than reaching it for the first time. Read by the API routes and handed to the screen so it
 * can re-render the selections/entries instead of opening blank. Undefined on a first visit,
 * and after a skip or a default_if_empty write (see HistoryEntry.answer).
 */
export function recalledAnswer(history: FlowPosition, target: { nodeId: string; item?: string }): Answer | undefined {
  const open = history.find((h) => h.exited_at === null && h.node_id === target.nodeId && h.repeat_key === target.item);
  return open?.answer;
}

/**
 * Rewinds to `nodeId` as if the user had backed up to it: restores every pre_write_snapshot
 * from the newest entry down to (and including) that node's most recent visit, then drops those
 * entries so re-entering starts clean. Mutates both in place.
 *
 * Reverting newest -> oldest matters: when two entries wrote the same path, the OLDER snapshot
 * is the state we want to end on, so it has to be applied last.
 */
function revertAndTruncateFrom(nodeId: string, memory: UserMemory, history: HistoryEntry[]): { answer?: Answer } | null {
  let idx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].node_id === nodeId) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;
  const answer = history[idx].answer; // read before the truncation below drops the entry

  for (let i = history.length - 1; i >= idx; i--) {
    const snapshot = history[i].pre_write_snapshot;
    if (!snapshot) continue;
    for (const [path, value] of Object.entries(snapshot)) {
      setPath(memory as unknown as Record<string, unknown>, path, structuredClone(value));
    }
  }
  history.length = idx; // the target's own entry goes too — ensureOpenEntry recreates it fresh
  return { answer };
}

export async function applyAnswer(params: ApplyAnswerParams): Promise<ApplyAnswerResult> {
  const structure = getNodeStructure(params.nodeId);
  const memory = structuredClone(params.memory);
  const history = structuredClone(params.history);

  ensureOpenEntry(params.nodeId, params.item, memory, history);

  // confirm_edit answered with "edit" (n_allergy_confirm's "Something's missing or wrong"):
  // rewind to the node being corrected instead of branching forward into it. Without this the
  // branch is an ordinary forward move, so the answer being corrected is never reverted — the
  // user re-answers, appendUnique adds the new values on top, and the value they came back
  // specifically to remove silently survives (on dietary.allergies, of all fields). The screen
  // also re-renders blank while memory still holds the old list, so there's no way to even see
  // what's still recorded. Reuses the same pre_write_snapshot machinery the Back button uses.
  if (structure.type === "confirm_edit" && params.answer.confirm_edit_action === "edit") {
    const targetId = resolveStructuralNext(structure, "edit");
    const rewound = targetId ? revertAndTruncateFrom(targetId, memory, history) : null;
    if (targetId && rewound) {
      const next = await resolveEntry(targetId, undefined, memory, history);
      // Same recall as Back: "Something's missing or wrong" lands on a screen whose writes have
      // just been reverted, so without this the user arrives at a blank list with no sign of
      // what they're correcting — on n_allergies, of all screens.
      if (!("terminal" in next)) {
        ensureOpenEntry(next.nodeId, next.item, memory, history);
        recallAnswerOnOpenEntry(history, targetId, undefined, rewound.answer);
      }
      return { memory, history, next };
    }
  }

  const entryIndex = history.findIndex((h) => h.node_id === params.nodeId && h.repeat_key === params.item && h.exited_at === null);

  let defaultApplied = false;
  if (!params.answer.skipped) {
    defaultApplied = await writeNodeAnswer(structure, params.answer, memory, params.item);
  } else if (structure.optional && structure.default_if_empty !== undefined) {
    applyDefaultIfEmpty(structure, memory);
    defaultApplied = true;
  }

  // options_filter's diet-implied exclusions are always merged in, even on a real (non-skipped)
  // visit — they were never shown as cards, so they can't be part of the raw swipe answer.
  if (structure.options_filter) {
    const content = await getNodeContent(params.nodeId);
    const rawOptions = sortByOrder(content.options ?? []);
    const filterResult = await applyOptionsFilter(structure.options_filter, rawOptions, content.disclosure_template, memory);
    const writesTo = structure.writes_to as Record<string, string> | undefined;
    if (writesTo?.excluded) {
      for (const v of filterResult.excludedValues) appendUnique(memory as unknown as Record<string, unknown>, writesTo.excluded, v);
    }
    // "all_options" default-if-empty (Skip button, not the auto-skip path) resolves against the filtered list.
    if (params.answer.skipped && writesTo?.allowed && typeof structure.default_if_empty === "object") {
      const def = structure.default_if_empty as Record<string, string>;
      if (def.allowed === "all_options") {
        setPath(memory as unknown as Record<string, unknown>, writesTo.allowed, resolveAllOptions(filterResult.filteredOptions));
      }
    }
  }

  if (structure.other_capture && (params.answer.other_entries?.length || params.answer.other_text)) {
    // Preferred path: entries already validated client-side (validate-other, one batched call
    // per submission) — write the agent's own normalized value when present, the raw entry
    // text only when value is null (the section was out of the Onboarding Validator Agent's
    // scope — see validator-sections.ts — or the agent genuinely couldn't normalize it; see
    // OtherEntryResult's header comment and ONBOARDING_VALIDATOR_AGENT_CONTRACT.md §3 step 2).
    // Legacy path: other_text, split and appended raw server-side — still used whenever a
    // caller doesn't populate other_entries (existing scripted test answers, e.g.).
    const pieces = params.answer.other_entries?.length
      ? params.answer.other_entries.map((r) => r.value ?? r.entry.trim())
      : (params.answer.other_text ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

    for (const p of pieces) appendUnique(memory as unknown as Record<string, unknown>, structure.other_capture.appends_to, p);

    // Parallel staging note (memory.other.<section>) — same pieces, alongside the real write
    // above, not instead of it. Flags which entries are user-typed and still need a future
    // tier-2/3 agent pass; see UserMemory.other's own header comment for the full reasoning.
    const section = otherCaptureSection(structure);
    if (section) for (const p of pieces) appendUnique(memory as unknown as Record<string, unknown>, `other.${section}`, p);
  }

  if (structure.free_text_note_field && params.answer.text) {
    setPath(memory as unknown as Record<string, unknown>, structure.free_text_note_field, params.answer.text);
  }

  // always_include: appended to writes_to unconditionally, regardless of what was picked — never
  // shown as a choice (n_active_slots' forced "snack"). Only meaningful when writes_to is a single
  // array path (the only case that exists today); skipped for object-form writes_to.
  if (structure.always_include && typeof structure.writes_to === "string") {
    for (const entry of structure.always_include) {
      appendUnique(memory as unknown as Record<string, unknown>, structure.writes_to, entry.value);
    }
  }

  for (const inf of structure.infer ?? []) {
    if ("value" in inf && inf.value !== undefined) {
      setPath(memory as unknown as Record<string, unknown>, inf.path, inf.value);
    }
    // value_expr: no node currently uses it — see types.ts's `infer` header note.
  }

  // default_applied must land on the entry BEFORE advanceFlow runs — resolveEntry's
  // repeat_for handling (wasValueDefaulted) reads it off history to decide whether THIS
  // node's own value should count as a genuine iteration source (see the terminal-not-
  // cascading rule). Setting it any later means that check reads a stale flag.
  // `answer` is set explicitly (not merged) on every path: this entry may be a re-opened one
  // carrying the answer Back put there, and re-answering has to replace it rather than let a
  // stale echo of the previous submission survive. Skips and default_if_empty writes record
  // nothing — see HistoryEntry.answer.
  history[entryIndex] = {
    ...history[entryIndex],
    exited_at: new Date().toISOString(),
    default_applied: defaultApplied,
    answer: params.answer.skipped || defaultApplied ? undefined : params.answer,
  };

  const rawAnswerForBranches = params.answer.confirm_edit_action ?? params.answer.values?.[0];
  const next = await advanceFlow(params.nodeId, params.item, rawAnswerForBranches, memory, history, params.answer.skipped === true);

  // Patch resolved_next onto the same entry now that it's known — advanceFlow only APPENDS
  // further entries after this one (auto-skips), it never mutates this one, so entryIndex is
  // still valid. Recorded so resolveResumeTarget can recover precisely (including this exact
  // branch outcome) if the "open next entry" write below is ever lost.
  history[entryIndex] = {
    ...history[entryIndex],
    resolved_next: "terminal" in next ? null : { nodeId: next.nodeId, item: next.item },
  };

  // Open the next node's entry immediately (not lazily on its own future applyAnswer call) so
  // `history` always ends with an open entry for "what to render next" — see ensureOpenEntry's
  // header note. Auto-skip entries advanceFlow already pushed along the way are already exited;
  // this only opens the final, actually-renderable target.
  if (!("terminal" in next)) ensureOpenEntry(next.nodeId, next.item, memory, history);

  return { memory, history, next };
}

// ---------------------------------------------------------------------------
// Resume — what GET /state renders. Prefers the open entry (the normal
// case). If history is non-empty but NO entry is open (an anomaly that
// should never happen from a correctly-completing applyAnswer call, but
// must be recovered from gracefully rather than silently restarting the
// whole flow and re-asking everything already answered — see the bug this
// fixed), recovers from the last entry's `resolved_next`, which records
// exactly what applyAnswer computed at the time, branch outcomes included.
// Only a pre-existing row saved before `resolved_next` existed would lack
// it — that best-effort fallback re-derives via advanceFlow, which is
// exactly what could get a branch wrong; going forward, every entry
// records it, so this fallback is not the normal path.
// ---------------------------------------------------------------------------

export async function resolveResumeTarget(memory: UserMemory, history: HistoryEntry[]): Promise<FlowTarget> {
  const openEntry = history.find((h) => h.exited_at === null);
  if (openEntry) return { nodeId: openEntry.node_id, item: openEntry.repeat_key };
  if (history.length === 0) return entryPoint(memory, history);

  const last = history[history.length - 1];
  if (last.resolved_next !== undefined) {
    if (last.resolved_next === null) return { terminal: true };
    const target = await resolveEntry(last.resolved_next.nodeId, last.resolved_next.item, memory, history);
    if (!("terminal" in target)) ensureOpenEntry(target.nodeId, target.item, memory, history);
    return target;
  }

  const target = await advanceFlow(last.node_id, last.repeat_key, undefined, memory, history);
  if (!("terminal" in target)) ensureOpenEntry(target.nodeId, target.item, memory, history);
  return target;
}

// ---------------------------------------------------------------------------
// Back — discards the trailing OPEN entry (the node currently on screen,
// never answered — nothing to revert), then pops the entry before it
// (the previously-answered node) and reverts ITS write. Repeated single
// calls are equivalent to "truncate N entries", so no separate
// truncate-to-arbitrary-point operation is needed (see engine header note
// in the plan / design doc §10). Relies on applyAnswer/entryPoint's
// invariant that history always ends with an open entry for "what's on
// screen right now."
// ---------------------------------------------------------------------------

export interface GoBackResult {
  memory: UserMemory;
  history: FlowPosition;
  target: { nodeId: string; item?: string };
}

/** Whether goBack() has anything to pop — i.e. there's a previously-answered node behind whatever's currently open. */
export function canGoBack(history: FlowPosition): boolean {
  const withoutOpen = history.length > 0 && history[history.length - 1].exited_at === null ? history.slice(0, -1) : history;
  return withoutOpen.length > 0;
}

export function goBack(memory: UserMemory, history: FlowPosition): GoBackResult {
  const draft = structuredClone(memory);
  const h = structuredClone(history);

  const revert = (entry: HistoryEntry) => {
    if (entry.pre_write_snapshot) {
      for (const [path, value] of Object.entries(entry.pre_write_snapshot)) {
        setPath(draft as unknown as Record<string, unknown>, path, value);
      }
    }
  };

  if (h.length > 0 && h[h.length - 1].exited_at === null) h.pop(); // discard the currently-open, unanswered entry

  let last = h.pop();
  if (!last) throw new Error("goBack: no previous node to go back to");
  revert(last);

  // confirm_edit screens (e.g. n_allergy_confirm) are a transient "confirm or go back and edit"
  // gate, not a real stop on the back-stack — landing on one after Back from a LATER node would
  // just show the same recap again, forcing a second Back tap to reach the actual editable node.
  // Skip straight through to whatever's behind it instead.
  while (getNodeStructure(last.node_id).type === "confirm_edit") {
    const prev = h.pop();
    if (!prev) break;
    revert(prev);
    last = prev;
  }

  // Re-open the target's own entry instead of leaving history with nothing open. Two reasons:
  // it restores the "history always ends with an open entry for what's on screen" invariant the
  // rest of the engine relies on (the /answer route's stale-node check, resolveResumeTarget),
  // and it's where the recalled answer lives — so a reload right after Back still shows the
  // user's choices rather than a blank screen. The snapshot it takes is of the already-reverted
  // memory, which is exactly what re-answering should overwrite.
  ensureOpenEntry(last.node_id, last.repeat_key, draft, h);
  recallAnswerOnOpenEntry(h, last.node_id, last.repeat_key, last.answer);

  return { memory: draft, history: h, target: { nodeId: last.node_id, item: last.repeat_key } };
}
