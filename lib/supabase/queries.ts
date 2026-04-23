import { createClient } from "./server";

export type RecipeCollection = {
  id: number | null;
  recipe_uuid: string;
  collection_id: number | null;
  header_id: number | null;
  recipe_id: string | null;
  meal_title: string | null;
  servings: string | null;
  servings_value: number | null;
  prep_time: string | null;
  total_time: string | null;
  author: string | null;
  date: string | null;
  url: string | null;
  image_url: string | null;
  account_key: string | null;
  header_status: number | null;
  collections_short_desc: string | null;
};

export async function getRecipes(userId: string): Promise<RecipeCollection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("viw_user_collection_set")
    .select("*")
    .eq("account_key", userId)
    .order("id", { ascending: false });

  if (error) throw error;
  const rows = data ?? [];
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.recipe_uuid)) return false;
    seen.add(r.recipe_uuid);
    return true;
  });
}

export async function getRecipe(
  recipeUuid: string,
  userId: string
): Promise<RecipeCollection | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("viw_user_collection_set")
    .select("*")
    .eq("recipe_uuid", recipeUuid)
    .eq("account_key", userId)
    .single();

  if (error) return null;
  return data;
}
