import { createClient } from "@/lib/supabase/browser";
import type { RecipeCollection } from "@/lib/supabase/queries";

// A recipe page built from a plan entry's snapshot (the card's `metadata`) instead of from the user's
// recipes. The snapshot is the output of get_recipe_json_by_uuid() frozen when the entry was planned:
// { metadata: {...}, recipe_lines, recipe_instructions, recipe_totals }. It is what the plan card already
// holds, so showing it needs no read, and it covers a recipe the user has not saved (one Zestil planned).
// What it does not carry is the user's side of the recipe: collections, auto_plan. Those stay empty here.
//
// The field names inside `metadata` are not documented in this repo, so each is looked up under the names
// the recipe row itself uses, and a missing one is just left out of the page.

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n : null;
};

/** The snapshot as a recipe page's data, or null when it holds nothing to show (no ingredients, steps or totals). */
export function recipeFromSnapshot(
  snapshot: Record<string, any> | null | undefined,
  fallbackTitle: string,
  recipeUuid: string,
): RecipeCollection | null {
  if (!snapshot) return null;
  const meta = (snapshot.metadata ?? {}) as Record<string, any>;
  const lines = Array.isArray(snapshot.recipe_lines) ? snapshot.recipe_lines : [];
  const steps = Array.isArray(snapshot.recipe_instructions) ? snapshot.recipe_instructions : Array.isArray(snapshot.instructions) ? snapshot.instructions : [];
  const totals = Array.isArray(snapshot.recipe_totals) ? snapshot.recipe_totals : [];
  if (!lines.length && !steps.length && !totals.length) return null;

  const title = str(meta.meal_title) ?? str(snapshot.meal_title) ?? fallbackTitle;
  return {
    id: null,
    recipe_uuid: recipeUuid,
    collection_id: null,
    header_id: null,
    recipe_id: null,
    meal_title: title,
    servings: str(meta.servings),
    servings_value: num(meta.servings_value),
    prep_time: str(meta.prep_time),
    total_time: str(meta.total_time),
    author: str(meta.author),
    date: str(meta.date),
    url: str(meta.url),
    image_url: str(meta.image_url) ?? str(meta.media?.image_url),
    account_key: null,
    header_status: null,
    collections_short_desc: null,
    recipe_data: { meal_title: title, recipe_uuid: recipeUuid, recipe_lines: lines, recipe_instructions: steps, recipe_totals: totals },
    collection_names: [],
    created_at: null,
    auto_plan: null,
    auto_reason: null,
  };
}

/**
 * Any recipe by its id, whether or not it is in the user's collections (UI_BODY_CONTRACT §5.11): Zestil's
 * recipe snacks and sides carry only the recipe's id in their snapshot, not the recipe. Read with the
 * function the planner builds snapshots with, so the result has the snapshot's shape. Null when there is no
 * such recipe (deleted since); throws when the read fails.
 */
export async function loadRecipeById(recipeUuid: string, fallbackTitle: string): Promise<RecipeCollection | null> {
  const { data, error } = await createClient().rpc("get_recipe_json_by_uuid", { recipe_uuid: recipeUuid });
  if (error) throw new Error(error.message);
  const json = Array.isArray(data) ? data[0] : data;
  return recipeFromSnapshot(json, fallbackTitle, recipeUuid);
}
