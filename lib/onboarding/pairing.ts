import { getCuratedSection, sortByOrder } from "./content";
import type { ContentOption } from "./types";

// n_pairing_cards' curated content — nested broad_cuisine -> cuisine_narrow -> dish -> entry,
// mirroring pairing_curated_data.yaml exactly (see that file's header: the nesting below
// broad_cuisine is organizational only, never a lookup key — sampling flattens across it).
export interface PairingDishEntry {
  main_label: string;
  options: ContentOption[];
}
type PairingSidesSection = Record<string, Record<string, Record<string, PairingDishEntry>>>;

function flattenCuisinePool(section: PairingSidesSection, cuisine: string): { value: string; entry: PairingDishEntry }[] {
  const narrowMap = section[cuisine];
  if (!narrowMap) return [];
  const out: { value: string; entry: PairingDishEntry }[] = [];
  for (const dishMap of Object.values(narrowMap)) {
    for (const [value, entry] of Object.entries(dishMap)) out.push({ value, entry });
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Proportional-round-up sampling across every distinct selected cuisine — see
 * pairing_cards_design.md §3.2. Returns bare dish VALUES only (not the richer
 * {label,options} shape); a sampled dish's full entry is looked up fresh at render time via
 * findPairingDish, keeping `item` a plain string everywhere in the engine (see types.ts's
 * SampleFromStructure header note).
 *
 * top_up_tool (generate_pairing_cards) would fill a cuisine whose curated pool is smaller
 * than its computed share — a stub this phase, same posture as every other un-built tool tier
 * in resolvers.ts. An under-covered cuisine (or mediterranean, which has no curated pool at
 * all) just contributes fewer dishes than its share, never an error.
 */
export async function computePairingSample(cuisines: string[], totalSampleSize: number): Promise<string[]> {
  const distinctCuisines = [...new Set(cuisines)];
  if (distinctCuisines.length === 0) return [];

  const section = await getCuratedSection<PairingSidesSection>("curated:pairing.sides");
  const share = Math.ceil(totalSampleSize / distinctCuisines.length);

  const sampled: string[] = [];
  for (const cuisine of distinctCuisines) {
    const pool = flattenCuisinePool(section, cuisine);
    const picked = shuffle(pool).slice(0, Math.min(share, pool.length));
    sampled.push(...picked.map((p) => p.value));
  }
  return sampled;
}

/** Looks up a sampled dish's full entry (label + its curated side options) by bare value, searching every cuisine/sub-cuisine bucket. */
export async function findPairingDish(value: string): Promise<PairingDishEntry | undefined> {
  const section = await getCuratedSection<PairingSidesSection>("curated:pairing.sides");
  for (const narrowMap of Object.values(section)) {
    for (const dishMap of Object.values(narrowMap)) {
      if (dishMap[value]) return { main_label: dishMap[value].main_label, options: sortByOrder(dishMap[value].options) };
    }
  }
  return undefined;
}
