import { getCuratedSection, getDaysOfWeek, getNodeContent, sortByOrder } from "@/lib/onboarding/content";
import { getCuisineRows, humanizeSlug } from "@/lib/onboarding/cuisines";
import { getNodeStructure } from "@/lib/onboarding/flow-structure";
import { findPairingDish } from "@/lib/onboarding/pairing";
import { DAYS_OF_WEEK, type ContentOption, type UserMemory } from "@/lib/onboarding/types";
import type { ProfileGroup, ProfileRow, ProfileSection } from "@/lib/profile";

// Server-only. The Profile tab's read-only cards, built from memory_json with every stored code
// turned into the label onboarding showed for it: node options from tbl_onboarding_content,
// cuisines and dishes from tbl_cuisines_onboarding, pairing mains from curated:pairing.sides.
// Labels are cosmetic, so every lookup is soft: a failed read or an unknown code falls back to
// the stored text (humanised when it's a bare slug), never to an error.

type Labels = Map<string, string>;

async function soft<T>(load: Promise<T>, fallback: T): Promise<T> {
  try {
    return await load;
  } catch {
    return fallback;
  }
}

function labelsFrom(options: ContentOption[] | undefined): Labels {
  return new Map((options ?? []).map((o) => [String(o.value), o.label]));
}

async function nodeLabels(nodeId: string): Promise<Labels> {
  const content = await soft(getNodeContent(nodeId), null);
  return labelsFrom(content?.options);
}

/** n_active_slots' own options in their order, then its always_include (the forced "snack"): the map's order is the meals' order. */
async function slotLabels(): Promise<Labels> {
  const content = await soft(getNodeContent("n_active_slots"), null);
  const labels = labelsFrom(sortByOrder(content?.options ?? []));
  try {
    for (const extra of getNodeStructure("n_active_slots").always_include ?? []) labels.set(String(extra.value), extra.label);
  } catch {
    // cosmetic — the slug fallback still reads
  }
  return labels;
}

const strings = (values: unknown): string[] =>
  Array.isArray(values) ? values.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()) : [];

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** A stored value as the user should read it: its label, else the text as typed (capitalised), humanised when it's a bare slug. */
function display(value: string, labels: Labels): string {
  const label = labels.get(value);
  if (label) return label;
  if (/^[a-z0-9_]+$/.test(value)) return humanizeSlug(value);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * A stored list, labelled and de-duplicated. "other" (the trigger, not an answer) and "none"
 * ("None of these", "I don't have any") are dropped, so a "none" answer reads as an empty list.
 */
function list(values: unknown, labels: Labels): string[] {
  const out: string[] = [];
  for (const value of strings(values)) {
    if (value === "other" || value === "none") continue;
    const shown = display(value, labels);
    if (!out.includes(shown)) out.push(shown);
  }
  return out;
}

/** "Funge with Rice, Grilled fish": the main's curated label and the sides' own titles. */
async function pairings(values: unknown): Promise<string[]> {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const pairing of values as { main?: unknown; sides?: { title?: unknown }[] }[]) {
    if (typeof pairing?.main !== "string") continue;
    const dish = await soft(findPairingDish(pairing.main), undefined);
    const main = dish?.main_label ?? display(pairing.main, new Map());
    const sides = (pairing.sides ?? []).map((s) => text(s?.title)).filter((t): t is string => !!t);
    out.push(sides.length ? `${main} with ${sides.join(", ")}` : main);
  }
  return out;
}

const MACROS = new Set(["protein", "carbs", "fat"]);

/** "Protein, then fat, then carbs". */
function macroPriority(values: unknown, goals: Labels): string | undefined {
  const items = strings(values);
  if (items.length === 0) return undefined;
  // A skipped n_goal stores the goal's slug instead of an ordering (docs/app/onboarding/n_goal.md);
  // the goal's own label reads better than a lone slug.
  if (!items.every((m) => MACROS.has(m))) return items.map((m) => display(m, goals)).join(", ");
  const [first, ...rest] = items;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(", then ");
}

/**
 * Fixed meals grouped by day, in week order from the user's own week start, then by meal in
 * n_active_slots' order (breakfast, lunch, dinner, snack), with each meal's titles A–Z.
 */
function fixedMeals(memory: UserMemory, days: Labels, slots: Labels): ProfileGroup[] {
  const start = Math.max(DAYS_OF_WEEK.indexOf(memory.profile.locale.week_start_day ?? "sunday"), 0);
  const week = [...DAYS_OF_WEEK.slice(start), ...DAYS_OF_WEEK.slice(0, start)];
  const slotOrder = [...slots.keys()];
  const rank = (slot: string) => (slotOrder.includes(slot) ? slotOrder.indexOf(slot) : slotOrder.length);

  const groups: ProfileGroup[] = [];
  for (const day of week) {
    const bySlot = new Map<string, string[]>();
    for (const meal of memory.cooking_profile.day_constraints?.[day]?.fixed_meals ?? []) {
      const title = text(meal?.title);
      if (!title) continue;
      const slot = text(meal.meal_slot) ?? "";
      bySlot.set(slot, [...(bySlot.get(slot) ?? []), title]);
    }
    if (bySlot.size === 0) continue;
    const entries = [...bySlot.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([slot, titles]) => ({
        label: slot ? display(slot, slots) : "Any meal",
        items: [...new Set(titles)].sort((a, b) => a.localeCompare(b)),
      }));
    groups.push({ label: display(day, days), entries });
  }
  return groups;
}

const listRow = (label: string, items: string[], empty: string): ProfileRow => ({ label, items, empty });
const textRow = (label: string, value: string | undefined, empty: string): ProfileRow => ({ label, text: value, empty });

export async function buildProfileSections(memory: UserMemory): Promise<ProfileSection[]> {
  const { dietary, taste_profile: taste, meal_planning_preferences: planning } = memory;

  const [diets, allergies, intolerances, proteins, carbs, fats, regions, goals, slots, days, cuisineRows, liked, skipped] =
    await Promise.all([
      nodeLabels("n_diet_style_cards"),
      nodeLabels("n_allergies"),
      soft(getCuratedSection<{ options: ContentOption[] }>("curated:intolerance.common"), null).then((s) => labelsFrom(s?.options)),
      nodeLabels("n_protein_exclusion_cards"),
      nodeLabels("n_carb_exclusion_cards"),
      nodeLabels("n_fat_exclusion_cards"),
      nodeLabels("n_cuisine_broad"),
      nodeLabels("n_goal"),
      slotLabels(),
      soft(getDaysOfWeek(), []).then(labelsFrom),
      soft(getCuisineRows(strings(taste.sub_cuisines)), []),
      pairings(planning.preferred_pairings),
      pairings(planning.forbidden_pairings),
    ]);

  const cuisines: Labels = new Map(cuisineRows.map((r) => [r.cuisine_slug, r.display_name]));
  const dishes: Labels = new Map(
    cuisineRows.flatMap((r) => (r.popular_dishes ?? []).filter((d) => d?.slug && d?.name).map((d) => [d.slug!, d.name!] as [string, string]))
  );
  const avoidedFoods: Labels = new Map([...proteins, ...carbs, ...fats]);
  const toAvoid = list(dietary.diet_type.to_avoid, diets);
  const healthNotes = text(dietary.health_condition_notes);
  const notes = text(dietary.notes);
  const goToMeals = [...new Set(planning.preferred_recipes.map((r) => text(r?.title)).filter((t): t is string => !!t))];
  const fixed = fixedMeals(memory, days, slots);
  const weekStart = memory.profile.locale.week_start_day;

  // Rows that only some users ever fill (a health note, pairings, fixed meals) show only when filled.
  const rows = (...candidates: (ProfileRow | false)[]) => candidates.filter((r): r is ProfileRow => r !== false);

  return [
    {
      title: "Diet & health",
      rows: rows(
        listRow("Diet", list(dietary.diet_type.preferred, diets), "Not set"),
        toAvoid.length > 0 && listRow("Diets to avoid", toAvoid, "None"),
        listRow("Allergies", list(dietary.allergies, allergies), "None"),
        listRow("Intolerances", list(dietary.intolerances, intolerances), "None"),
        listRow("Foods you avoid", list(dietary.avoided_foods, avoidedFoods), "None"),
        !!healthNotes && textRow("Health notes", healthNotes, "None"),
        !!notes && textRow("Notes", notes, "None"),
      ),
    },
    {
      title: "Taste",
      rows: rows(
        listRow("Regions", list(taste.cuisines, regions), "Not set"),
        listRow("Cuisines", list(taste.sub_cuisines, cuisines), "Not set"),
        listRow("Favourite dishes", list(taste.favorite_dishes, dishes), "None"),
        listRow("Go-to meals", goToMeals, "None"),
        liked.length > 0 && listRow("Pairings you like", liked, "None"),
        skipped.length > 0 && listRow("Pairings you skip", skipped, "None"),
      ),
    },
    {
      title: "Planning",
      rows: rows(
        textRow("Macro priority", macroPriority(planning.macro_priority, goals), "Not set"),
        listRow("Meals", list(planning.active_slots, slots), "Not set"),
        textRow("Week starts on", weekStart ? display(weekStart, days) : undefined, "Not set"),
        fixed.length > 0 && { label: "Fixed meals", groups: fixed, empty: "None" },
      ),
    },
  ];
}
