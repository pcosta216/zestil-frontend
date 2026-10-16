import { createClient } from "@/lib/supabase/browser";

// "Use in automatic planning" (D37): the switch on the recipe page (components/PlanningSwitch.tsx), and the
// triangle on each Saved tab card that shows its state. Spec: the agents repo's
// docs/FRONTEND_RECIPE_PLANNING_EXCLUSIONS.md, and the diet's reasons from docs/FRONTEND_DIET_CHANGE.md §4.
//
// A recipe is out of planning while it has a row in tbl_user_recipes_exclusions. `reason` is 'user' (the
// switch, or chat's "don't plan the coq au vin") or 'diet:<diet>' (the user's strict diet keeps it out);
// a recipe can have both. Switching it on removes every row, the diet's too, and the database remembers
// that as an override of the diet. Chat changes the same rows, so the state is read whenever a recipe or
// the Saved tab is shown, never cached for the session.

/** recipe_uuid → why it is out ('user', 'diet:keto'). A recipe that isn't in the map is in planning. */
export type PlanningState = Map<string, string[]>;

export async function loadPlanningState(): Promise<PlanningState> {
  // Row-level security returns only the user's own rows.
  const { data, error } = await createClient().from("tbl_user_recipes_exclusions").select("recipe_uuid, reason");
  if (error) throw new Error(error.message);
  const state: PlanningState = new Map();
  for (const row of (data ?? []) as { recipe_uuid: string; reason: string | null }[]) {
    state.set(row.recipe_uuid, [...(state.get(row.recipe_uuid) ?? []), row.reason ?? "user"]);
  }
  return state;
}

/** Why one recipe is out ('user', 'diet:keto'); empty when it is in planning. */
export async function loadRecipeReasons(recipeUuid: string): Promise<string[]> {
  const { data, error } = await createClient()
    .from("tbl_user_recipes_exclusions")
    .select("reason")
    .eq("recipe_uuid", recipeUuid);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { reason: string | null }[]).map((r) => r.reason ?? "user");
}

/** diet → its label ("keto" → "Keto"), for "not keto". Readable by any signed-in user. */
export async function loadDietLabels(): Promise<Map<string, string>> {
  const { data, error } = await createClient().from("tbl_diet_rules").select("diet, label");
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { diet: string; label: string }[]).map((r) => [r.diet, r.label]));
}

export interface SetRecipePlanning {
  ok: boolean;
  recipe_uuid?: string;
  meal_title?: string;
  in_planning?: boolean;
  changed?: boolean; // false when it already was that way
  message?: string; // only when !ok; shown as it is
}

// `p_account_key` must be the signed-in user's own id, so it comes from the session: the recipe page is
// also opened as an overlay from the Plan tab, which has no user id to hand down.
export async function setRecipePlanning(recipeUuid: string, inPlanning: boolean): Promise<SetRecipePlanning> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("no session");
  const { data, error } = await supabase.rpc("set_recipe_planning", {
    p_account_key: session.user.id,
    p_recipe_uuid: recipeUuid,
    p_in_planning: inPlanning,
  });
  if (error) throw new Error(error.message);
  return data as SetRecipePlanning;
}

/** "not keto" when a diet keeps the recipe out, the way the database words it ('not ' || lower(label)). */
export function dietReason(reasons: string[] | undefined, labels: Map<string, string>): string | null {
  const diet = reasons?.find((r) => r.startsWith("diet:"))?.slice("diet:".length);
  return diet ? `not ${(labels.get(diet) ?? diet).toLowerCase()}` : null;
}

// ── events ─────────────────────────────────────────────────────────────────────────────────
// The recipe page's switch and the diet alert's answer (DietHost) write the rows, so they tell whoever
// shows them (the Saved tab, an open recipe page) to read them again.

const CHANGED_EVENT = "zestil:recipe-planning-changed";

export function announcePlanningChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function onPlanningChanged(fn: () => void) {
  window.addEventListener(CHANGED_EVENT, fn);
  return () => window.removeEventListener(CHANGED_EVENT, fn);
}
