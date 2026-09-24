import { getOnboardingDbClient } from "./content";
import type { ContentOption } from "./types";

// Server-only. n_cuisine_narrow and n_dishes read their options from `tbl_cuisines_onboarding`
// rather than from curated blobs in tbl_onboarding_content — a deliberate break with the rest
// of the flow, made to widen what a user can pick: the curated section carried ~7 sub-cuisines
// per region and 25 dish lists in total, this table carries 296 cuisines with their own
// popular_dishes. Everything else still comes from tbl_onboarding_content; see content.ts.
//
// Two things about this table that bit on the way in, both worth keeping in mind before
// changing anything here:
//
// 1. ONE region vocabulary now runs end to end. n_cuisine_broad's option values, this table's
//    `region` column, and the validator agent's own region slugs are all the six below, so
//    taste_profile.cuisines can be passed through untranslated. It was not always so: the flow
//    used to emit "asian"/"european"/"american" and a REGION_TO_TABLE map bridged the two.
//    Anything still keyed on the old values must be re-keyed, not re-mapped —
//    `curated:pairing.sides` was the last one.
// 2. It needs an RLS select policy for `authenticated`. Without one these reads return zero
//    rows and NO error — the screen renders an empty list rather than failing, which looks
//    exactly like a region with no cuisines. See the 2026-09-21 migration.

/**
 * The only valid region slugs: n_cuisine_broad's option values, tbl_cuisines_onboarding.region,
 * and the backend agent's vocabulary, all the same strings. Guarded rather than passed straight
 * through so a stale value (or a typo in the content row) degrades to the free-text path instead
 * of silently querying for a region that cannot exist.
 */
const TABLE_REGIONS = new Set([
  "asia_oceania",
  "central_latin_america",
  "middle_east",
  "africa",
  "europe",
  "north_america",
]);

/** How many cuisines to offer per region before the "Other" escape hatch. */
export const CUISINES_PER_REGION = 4;

interface CuisineRow {
  display_name: string; // bare adjective ("Ghanaian") — used for option tiles
  cuisine_name: string; // full noun phrase ("Ghanaian cuisine") — used inside prompt copy
  cuisine_slug: string;
  region_rank: number | null;
  popular_dishes?: { name?: string; slug?: string }[] | null;
}

const TTL_MS = 60_000;
const cache = new Map<string, { options: ContentOption[]; expiresAt: number }>();

/** Clears the in-process caches. Exposed for scripts/tests, not used at runtime. */
export function clearCuisineCache(): void {
  cache.clear();
  labelCache.clear();
}

/**
 * The "Other" tile. The curated section this replaced carried `other` as its last entry, and
 * n_cuisine_narrow's other_capture is keyed to that trigger value, so it has to be appended
 * here or the free-text path becomes unreachable (exactly what happened to n_cuisine_broad).
 */
function otherOption(order: number): ContentOption {
  return { value: "other", label: "Other", id_order: order };
}

/**
 * Top `limit` cuisines for a flow region, by region_rank, plus "Other".
 * Returns only "Other" for an unmapped region — never throws, so one bad value can't take the
 * screen down; it degrades to the free-text path.
 */
export async function getRegionCuisines(region: string, limit = CUISINES_PER_REGION): Promise<ContentOption[]> {
  if (!TABLE_REGIONS.has(region)) return [otherOption(10)];
  const tableRegion = region;

  const cacheKey = `region:${tableRegion}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.options;

  const supabase = await getOnboardingDbClient();
  const { data, error } = await supabase
    .from("tbl_cuisines_onboarding")
    .select("display_name, cuisine_slug, region_rank")
    .eq("region", tableRegion)
    .order("region_rank", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`tbl_cuisines_onboarding read failed for region "${tableRegion}": ${error.message}`);

  const rows = (data ?? []) as CuisineRow[];
  // id_order mirrors region_rank so sortByOrder keeps the table's ranking; "Other" is pushed
  // past the end so it always renders last regardless of how many rows came back.
  const options: ContentOption[] = rows.map((r, i) => ({
    value: r.cuisine_slug,
    label: r.display_name,
    id_order: (r.region_rank ?? i + 1) * 10,
  }));
  options.push(otherOption(10_000));

  cache.set(cacheKey, { options, expiresAt: Date.now() + TTL_MS });
  return options;
}

/**
 * The popular dishes carried on a cuisine's own row, as options for n_dishes.
 * `cuisineSlug` is whatever n_cuisine_narrow wrote into taste_profile.sub_cuisines.
 * Returns only "Other" when the slug is unknown or the row carries no dishes — a custom
 * cuisine typed into n_cuisine_narrow's free text has no row here, and that's expected.
 */
export async function getPopularDishes(cuisineSlug: string): Promise<ContentOption[]> {
  const cacheKey = `dishes:${cuisineSlug}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.options;

  const supabase = await getOnboardingDbClient();
  const { data, error } = await supabase
    .from("tbl_cuisines_onboarding")
    .select("popular_dishes")
    .eq("cuisine_slug", cuisineSlug)
    .limit(1);

  if (error) throw new Error(`tbl_cuisines_onboarding dish read failed for "${cuisineSlug}": ${error.message}`);

  const row = ((data ?? []) as CuisineRow[])[0];
  const dishes = Array.isArray(row?.popular_dishes) ? row!.popular_dishes! : [];
  const options: ContentOption[] = dishes
    .filter((d) => d && typeof d.slug === "string" && typeof d.name === "string")
    .map((d, i) => ({ value: d.slug as string, label: d.name as string, id_order: (i + 1) * 10 }));
  options.push(otherOption(10_000));

  cache.set(cacheKey, { options, expiresAt: Date.now() + TTL_MS });
  return options;
}

/**
 * A cuisine's `cuisine_name`, for interpolating `{item}` into prompt copy.
 *
 * Deliberately NOT `display_name`, which the option tiles use. The two differ on 290 of 296
 * rows: `display_name` is the bare adjective ("Ghanaian", "Thai") which suits a compact grid
 * tile, while `cuisine_name` carries the noun ("Ghanaian cuisine", "Thai cuisine") which is
 * what reads correctly inside a sentence — "any dishes from Ghanaian cuisine you already
 * love?" rather than "...from Ghanaian you already love?".
 *
 * Returns undefined for a slug with no row — a custom cuisine typed into n_cuisine_narrow's
 * free text has none — and the caller falls back to humanising the slug.
 */
export async function getCuisineLabel(cuisineSlug: string): Promise<string | undefined> {
  const cacheKey = `label:${cuisineSlug}`;
  const cached = labelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.label;

  const supabase = await getOnboardingDbClient();
  const { data, error } = await supabase
    .from("tbl_cuisines_onboarding")
    .select("cuisine_name")
    .eq("cuisine_slug", cuisineSlug)
    .limit(1);

  // Deliberately soft: a label is cosmetic, and throwing here would take down a screen whose
  // options loaded fine. The humanised fallback is always readable, just less exact.
  if (error) return undefined;

  const label = ((data ?? []) as CuisineRow[])[0]?.cuisine_name;
  labelCache.set(cacheKey, { label, expiresAt: Date.now() + TTL_MS });
  return label;
}

const labelCache = new Map<string, { label: string | undefined; expiresAt: number }>();

/**
 * Last-resort display text for a slug with no authoritative label: `ghanaian_cuisine` →
 * "Ghanaian", `latin_american` → "Latin American". Drops a trailing `_cuisine` because the
 * surrounding copy already says "cuisine"/"dishes from". Only ever a fallback — a real
 * display_name beats it, since this can't reproduce casing or parentheses
 * ("Mexican regional cuisine (Oaxacan)").
 */
export function humanizeSlug(slug: string): string {
  const words = slug.replace(/_cuisine$/, "").split("_").filter(Boolean);
  if (words.length === 0) return slug;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Exposed for the flow validator/tests — the region slugs this module accepts. */
export function mappedRegions(): string[] {
  return [...TABLE_REGIONS];
}
