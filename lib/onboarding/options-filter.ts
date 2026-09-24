import { getCuratedSection, getNodeContent } from "./content";
import { getPath } from "./paths";
import type { ContentOption, OptionsFilterStructure, UserMemory } from "./types";

interface DietMacroBlock {
  excluded: string[];
  allowed: string[];
}
type DietMacroExclusions = Record<string, Record<"protein" | "carbs" | "fat", DietMacroBlock>>;
type HardExcludeTable = Record<string, Record<"protein" | "carbs" | "fat", string[]>>;

/** One greying, attributed: "Lactose intolerance" ruled out ["Butter", "Ghee"]. */
export interface ExclusionReason {
  cause: string; // already human-readable — "Nuts allergy", "Vegan diet"
  labels: string[]; // the option labels that cause ruled out, in the screen's own order
}

export interface OptionsFilterResult {
  excludedValues: unknown[];
  filteredOptions: ContentOption[];
  contributingDiets: string[]; // diet slugs, for callers that want raw values
  exclusionReasons: ExclusionReason[];
  disclosureText?: string;
}

/**
 * What to call each hard-exclude source on screen, and where its own option labels live.
 *
 * In code rather than in content because it's keyed on the MEMORY PATH a constraint came from,
 * not on any one node: the same allergy list greys tiles on three different decks, and the
 * sentence "Nuts allergy" belongs to the allergy field, not to the protein screen. An unlisted
 * path still attributes, just without a noun ("Lactose: Butter, Ghee"), so adding a new
 * hard_exclude_source can't break the banner — it only reads less well until it's listed here.
 */
const HARD_SOURCE_VOCAB: Record<string, { noun: string; labelsFrom: { node: string } | { section: string } }> = {
  "dietary.allergies": { noun: "allergy", labelsFrom: { node: "n_allergies" } },
  "dietary.intolerances": { noun: "intolerance", labelsFrom: { section: "curated:intolerance.common" } },
};

async function labelMap(from: { node: string } | { section: string }): Promise<Map<unknown, string>> {
  const options =
    "node" in from
      ? (await getNodeContent(from.node)).options
      : (await getCuratedSection<{ options: ContentOption[] }>(from.section)).options;
  return new Map((options ?? []).map((o) => [o.value, o.label]));
}

/**
 * Diet-based options_filter: intersects `excluded` across every diet in
 * dietary.diet_type.preferred for the node's macro_category, removes those
 * values from `options`, and returns everything needed to seed writes_to
 * and render the disclosure banner. See diet_macro_curated_data.yaml's
 * header for the full "plain intersection, no exceptions" reasoning —
 * intersecting with an empty set (a selected diet with no opinion on this
 * macro) always yields an empty exclusion set, which is intentional.
 */
export async function applyOptionsFilter(
  filter: OptionsFilterStructure,
  rawOptions: ContentOption[],
  disclosureTemplate: string | undefined,
  memory: UserMemory
): Promise<OptionsFilterResult> {
  const selectedDiets = (getPath(memory as unknown as Record<string, unknown>, filter.exclude_source) as string[] | undefined) ?? [];

  // Diet table + every hard_exclude_sources table are independent lookups (none depends on
  // another's result) — fetched concurrently rather than one-at-a-time. Sequential awaits here
  // used to chain 3 separate Supabase round trips (~2s+ on a cold cache), which was the likely
  // cause of a user-perceived "skip": the long unresponsive pause invited a stray re-click that
  // landed for real on the next screen once it finally rendered.
  const hardSources = (filter.hard_exclude_sources ?? [])
    .map((source) => ({
      source,
      values: (getPath(memory as unknown as Record<string, unknown>, source.exclude_source) as string[] | undefined) ?? [],
    }))
    .filter((s) => s.values.length > 0);

  const [dietTable, ...hardTables] = await Promise.all([
    selectedDiets.length > 0 ? getCuratedSection<DietMacroExclusions>(filter.lookup_section) : Promise.resolve(null),
    ...hardSources.map((s) => getCuratedSection<HardExcludeTable>(s.source.lookup_section)),
  ]);

  // Only diets the curated table actually knows take part in the intersection. A slug it's
  // never heard of is an UNKNOWN, not a diet with no opinion, and the two must not be treated
  // alike: an unknown contributing an empty set would empty the whole intersection and silently
  // cancel every tapped diet's exclusions (tap Vegan, type "keto diet" in Other -> the agent
  // normalizes to `ketogenic`, which isn't the curated `keto` -> red meat becomes selectable for
  // a vegan). That's the one way the documented "plain intersection, silence neutralizes" rule
  // gets it wrong — that rule is about curated diets that genuinely have nothing to say on a
  // macro, which is a real signal; a custom free-text diet carries no signal at all. Narrowing
  // to known diets is strictly safer: it can only ever keep exclusions that would otherwise be
  // dropped, never add one nobody asked for. See smoke-test.ts scenario Q.
  let dietExcluded = new Set<string>();
  const knownDiets = dietTable ? selectedDiets.filter((diet) => dietTable[diet] !== undefined) : [];
  if (knownDiets.length > 0) {
    const excludedSets = knownDiets.map((diet) => new Set(dietTable![diet]?.[filter.macro_category]?.excluded ?? []));
    dietExcluded = excludedSets[0] ?? new Set<string>();
    for (const set of excludedSets.slice(1)) {
      dietExcluded = new Set([...dietExcluded].filter((v) => set.has(v)));
    }
  }

  // Hard-exclude sources (allergies, intolerances): UNION across every value and every source —
  // each is an independent hard constraint, not a blendable preference like diet, so one never
  // neutralizes another. See OptionsFilterStructure.hard_exclude_sources's own header comment.
  const hardExcluded = new Set<string>();
  hardSources.forEach(({ values }, i) => {
    const hardTable = hardTables[i];
    for (const v of values) {
      for (const e of hardTable[v]?.[filter.macro_category] ?? []) hardExcluded.add(e);
    }
  });

  const excludedValues: unknown[] = [...new Set([...dietExcluded, ...hardExcluded])];
  const filteredOptions = rawOptions.filter((opt) => !excludedValues.includes(opt.value));
  // knownDiets, not selectedDiets — the disclosure banner names who caused the exclusions, and a
  // custom diet that sat out the intersection above didn't cause any of them.
  const contributingDiets = dietExcluded.size > 0 ? knownDiets : [];

  const dietStyleContent = await getNodeContent("n_diet_style_cards");
  const dietLabelByValue = new Map((dietStyleContent.options ?? []).map((o) => [o.value, o.label]));
  const contributingDietLabels = contributingDiets.map((d) => dietLabelByValue.get(d) ?? d).join(", ");

  // Per-cause attribution. The static exclusion_disclaimer can only say "your diet, allergy, or
  // intolerance answers" — it names all three possibilities and settles none, which is how a
  // greying gets blamed on the wrong answer. These lines name the actual one.
  //
  // An option ruled out by two constraints appears under both: that's the truth, and hiding the
  // second one would make "change that answer to get it back" wrong advice.
  const exclusionReasons: ExclusionReason[] = [];
  const labelsFor = (values: Set<string>) =>
    rawOptions.filter((opt) => values.has(opt.value as string)).map((opt) => opt.label); // screen order, not set order
  if (dietExcluded.size > 0 && contributingDietLabels) {
    exclusionReasons.push({ cause: `${contributingDietLabels} diet${contributingDiets.length > 1 ? "s" : ""}`, labels: labelsFor(dietExcluded) });
  }
  for (const [i, { source, values }] of hardSources.entries()) {
    const vocab = HARD_SOURCE_VOCAB[source.exclude_source];
    const sourceLabels = vocab ? await labelMap(vocab.labelsFrom) : undefined;
    for (const v of values) {
      const ruledOut = new Set(hardTables[i][v]?.[filter.macro_category] ?? []);
      if (ruledOut.size === 0) continue; // an intolerance with no opinion on this macro, or free text with no row
      const name = sourceLabels?.get(v) ?? v;
      exclusionReasons.push({ cause: vocab ? `${name} ${vocab.noun}` : String(name), labels: labelsFor(ruledOut) });
    }
  }

  let disclosureText: string | undefined;
  if (filter.disclosure && excludedValues.length > 0 && disclosureTemplate) {
    const excludedLabels = rawOptions
      .filter((opt) => excludedValues.includes(opt.value))
      .map((opt) => opt.label)
      .join(", ");

    // {contributing_diets} now needs to gracefully cover three cases (diet-only, hard-exclude-
    // only, or both) rather than assuming diet always contributed — a bare template-string
    // substitution can't express "and" conditionally, so this composes the phrase in code
    // instead of leaving it entirely to the DB-authored template.
    const hasHardContribution = hardExcluded.size > 0;
    let contributingText: string;
    if (contributingDietLabels && hasHardContribution) {
      contributingText = `${contributingDietLabels} and what you told us about your allergies/intolerances`;
    } else if (contributingDietLabels) {
      contributingText = contributingDietLabels;
    } else if (hasHardContribution) {
      contributingText = "what you told us about your allergies/intolerances";
    } else {
      contributingText = "your earlier answers";
    }
    disclosureText = disclosureTemplate
      .replace("{contributing_diets}", contributingText)
      .replace("{excluded_labels}", excludedLabels);
  }

  return { excludedValues, filteredOptions, contributingDiets, exclusionReasons, disclosureText };
}

/** Resolves the `all_options` reserved keyword in default_if_empty — always the FILTERED list, per the flow header. */
export function resolveAllOptions(filteredOptions: ContentOption[]): unknown[] {
  return filteredOptions.map((o) => o.value);
}
