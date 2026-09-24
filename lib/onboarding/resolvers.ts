import { getCuratedSection, getNodeContent, sortByOrder } from "./content";
import { CUISINES_PER_REGION, getPopularDishes, getRegionCuisines } from "./cuisines";
import { getNodeStructure } from "./flow-structure";
import { getPath } from "./paths";
import type { ContentOption, OptionsSourceStructure, UserMemory } from "./types";

export interface ResolveCtx {
  item?: string; // current repeat_for iteration value
  memory: UserMemory;
}

/** `{item}` or `{dietary.allergies}` → the referenced value. Anything not matching this exact shape is returned unchanged (a literal). */
export function resolveTemplateRef(template: string, ctx: ResolveCtx): unknown {
  const m = template.match(/^\{([\w.]+)\}$/);
  if (!m) return template;
  const ref = m[1];
  if (ref === "item") return ctx.item;
  return getPath(ctx.memory as unknown as Record<string, unknown>, ref);
}

function dedupeByValue(options: ContentOption[]): ContentOption[] {
  const seen = new Set<unknown>();
  const out: ContentOption[] = [];
  for (const opt of options) {
    if (seen.has(opt.value)) continue;
    seen.add(opt.value);
    out.push(opt);
  }
  return out;
}

/**
 * Resolves a node's dynamic options list. Tier 1 (curated_lookup / always_merge)
 * is fully live against the DB. Tier 2/3 (`type: tool`) are stubs returning
 * `[]` for this pass — get_sub_cuisines/get_signature_dishes/
 * web_search_cuisines/web_search_dishes/get_common_intolerances/
 * web_search_intolerances/generate_pairing_cards/generate_generic_pairing_
 * cards/search_recipe_db don't exist yet (confirmed: only curated content
 * is live this phase). Wire the real calls in here once those tools ship —
 * everything upstream (engine.ts, the UI) already treats "tier returned []"
 * and "tier not implemented yet" identically, so no call site changes when
 * these stop being stubs.
 */
export async function resolveOptions(source: OptionsSourceStructure | undefined, ctx: ResolveCtx): Promise<ContentOption[]> {
  if (!source) return [];

  // Lightweight direct pointer (n_week_start / n_fixed_meals.day_of_week → content:days_of_week)
  if (source.section) {
    const section = await getCuratedSection<{ options: ContentOption[] }>(source.section);
    return sortByOrder(section.options);
  }

  // Pull {value,label} from another node's own content + always_include, filtered to what
  // ended up in that node's persisted answer (n_fixed_meals.meal_slot ← n_active_slots).
  if (source.from_node_options) {
    const targetStructure = getNodeStructure(source.from_node_options);
    const targetContent = await getNodeContent(source.from_node_options);
    const staticOptions = sortByOrder(targetContent.options ?? []);
    const alwaysIncludeOptions: ContentOption[] = (targetStructure.always_include ?? []).map((ai, i) => ({
      id_order: 10_000 + i, // renders after the picked-from options; order among themselves doesn't matter (single entry today)
      value: ai.value,
      label: ai.label,
    }));
    const allOptions = [...staticOptions, ...alwaysIncludeOptions];
    const persistedPath = typeof targetStructure.writes_to === "string" ? targetStructure.writes_to : undefined;
    const persistedValues = persistedPath
      ? ((getPath(ctx.memory as unknown as Record<string, unknown>, persistedPath) as unknown[] | undefined) ?? [])
      : [];
    return allOptions.filter((o) => persistedValues.includes(o.value));
  }

  // Options drawn from the user's own earlier answers rather than from curated content
  // (n_fixed_meals' dish_name ← meal_planning_preferences.preferred_recipes[].title).
  // Every guard here degrades to "no options", never throws: these screens all keep a
  // free-text box as the primary input, so an empty list costs a shortcut, not the screen.
  if (source.from_memory_list) {
    const { path, label_field } = source.from_memory_list;
    const list = getPath(ctx.memory as unknown as Record<string, unknown>, path);
    if (!Array.isArray(list)) return [];
    const options: ContentOption[] = [];
    for (const row of list) {
      const label = label_field ? (row as Record<string, unknown> | null)?.[label_field] : row;
      if (typeof label !== "string" || label.trim().length === 0) continue;
      options.push({ value: label.trim(), label: label.trim(), id_order: (options.length + 1) * 10 });
    }
    return dedupeByValue(options);
  }

  // search_recipe_db-style free_text_search source — stub.
  if (source.tool && !source.resolution_order && !source.always_merge) {
    return [];
  }

  let base: ContentOption[] = [];
  if (source.always_merge) {
    const section = await getCuratedSection<{ options: ContentOption[] }>(source.always_merge.section);
    base = sortByOrder(section.options);
  }

  for (const tier of source.resolution_order ?? []) {
    if (tier.type === "tool") continue; // stub tier — see header note

    // tbl_cuisines_onboarding-backed tiers. Unlike curated_lookup these always return something
    // (at minimum the "Other" tile), so they're terminal: any tier listed after one is dead.
    if (tier.type === "cuisine_table" || tier.type === "cuisine_dishes") {
      const key = resolveTemplateRef(tier.key ?? "{item}", ctx);
      if (typeof key !== "string" || key.length === 0) continue;
      const list =
        tier.type === "cuisine_table"
          ? await getRegionCuisines(key, tier.limit ?? CUISINES_PER_REGION)
          : await getPopularDishes(key);
      return dedupeByValue([...base, ...sortByOrder(list)]);
    }

    if (tier.type === "curated_lookup" && tier.section) {
      const table = await getCuratedSection<Record<string, ContentOption[]>>(tier.section);

      if (tier.key) {
        const key = resolveTemplateRef(tier.key, ctx) as string;
        const list = table[key];
        if (list && list.length > 0) return dedupeByValue([...base, ...sortByOrder(list)]);
      } else if (tier.keys) {
        const keys = resolveTemplateRef(tier.keys, ctx) as string[] | undefined;
        const merged = (keys ?? []).flatMap((k) => table[k] ?? []);
        if (merged.length > 0) return dedupeByValue([...base, ...sortByOrder(merged)]);
      }
    }
  }

  // No tier produced anything — return whatever always_merge contributed (possibly empty).
  return base;
}
