import { createClient } from "./server";

export type RecipeIngredient = {
  ingredient_uuid: string;
  ingredient_text: string;
  ingredient_qty: number;
  ingredient_unit: string;
  nutrients: { value: number; unitname: string; nutrientname: string }[];
};

export type RecipeInstruction = {
  step: number;
  title: string;
  actions: string[];
  tips: string[];
  notes: string | null;
};

export type RecipeTotal = {
  total_value: number;
  unitname: string;
  nutrientname: string;
};

export type RecipeData = {
  meal_title: string;
  recipe_uuid: string;
  recipe_lines: RecipeIngredient[];
  recipe_instructions: RecipeInstruction[];
  recipe_totals: RecipeTotal[];
};

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
  recipe_data: RecipeData | null;
  collection_names?: string[];
};

export type Collection = { id: number; name: string };

export async function getCollections(userId: string): Promise<Collection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tbl_collections_set_header")
    .select("id, collections_short_desc")
    .eq("account_key", userId)
    .eq("status", 1710)
    .order("collections_short_desc", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id as number, name: r.collections_short_desc as string }));
}

export async function getRecipes(userId: string): Promise<RecipeCollection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("viw_user_collection_set")
    .select("*")
    .eq("account_key", userId)
    .order("meal_title", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getImagePlaceholder(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_app_config")
    .select("config")
    .eq("description", "image_placeholder")
    .limit(1)
    .single();

  if (!data?.config) return null;
  const config =
    typeof data.config === "string" ? JSON.parse(data.config) : data.config;
  return config?.url ?? null;
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
    .eq("account_key", userId);

  if (error || !data || data.length === 0) return null;

  const collection_names = [
    ...new Set(data.map((r) => r.collections_short_desc).filter((c): c is string => !!c)),
  ];

  return { ...data[0], collection_names };
}

/**
 * Public storage bucket the profile pictures live in, and the folder inside it
 * holding them. Only consulted when `picture_id` is a path, not a full URL.
 */
export const PROFILE_PICTURE_BUCKET = "userpictures";
const PROFILE_PICTURE_FOLDER = "pictures";

export type UserProfile = {
  display_name: string | null;
  email: string | null;
  /** `picture_id` resolved to something an <img> can load, or null. */
  picture_url: string | null;
};

/**
 * `picture_id` holds either a full URL or a path inside PROFILE_PICTURE_BUCKET.
 * A bare filename is taken to be in PROFILE_PICTURE_FOLDER — the stored names
 * carry their own extension (`.jpg`, `.jpeg`), so the filename has to come from
 * the column. Anything else resolves to null and the UI falls back to initials.
 */
function resolvePictureUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pictureId: unknown
): string | null {
  if (typeof pictureId !== "string") return null;
  const value = pictureId.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) return value;

  const path = value.replace(/^\/+/, "");
  const { data } = supabase.storage
    .from(PROFILE_PICTURE_BUCKET)
    .getPublicUrl(path.includes("/") ? path : `${PROFILE_PICTURE_FOLDER}/${path}`);
  return data.publicUrl || null;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tbl_user_profiles")
    .select("display_name, email, picture_id")
    .eq("account_key", userId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    display_name: data.display_name ?? null,
    email: data.email ?? null,
    picture_url: resolvePictureUrl(supabase, data.picture_id),
  };
}
