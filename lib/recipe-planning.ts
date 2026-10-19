import { createClient } from "@/lib/supabase/browser";

// "Use in automatic planning" (D37): the switch on the recipe page (components/PlanningSwitch.tsx), and the
// triangle on each Saved tab card that shows its state. Spec: the agents repo's
// docs/FRONTEND_RECIPE_PLANNING_EXCLUSIONS.md, and the diet's reasons from docs/FRONTEND_DIET_CHANGE.md §4.
//
// A recipe is out of planning while it has a row in tbl_user_recipes_exclusions. `reason` is 'user' (the
// switch, or chat's "don't plan the coq au vin") or 'diet:<diet>' (the user's strict diet keeps it out);
// a recipe can have both. Switching it on removes every row, the diet's too, and the database remembers
// that as an override of the diet.
//
// The app never reads the table: viw_user_collection_set follows it at once, and the recipes carry its
// auto_plan (in planning or not) and auto_reason ("diet:keto" when only a diet keeps the recipe out,
// "user" for the user's own) from the server. loadAutoPlan reads just auto_plan again.

/** recipe_uuid → auto_plan, read again from the view (chat changes the rows too). */
export async function loadAutoPlan(accountKey: string): Promise<Map<string, boolean>> {
  // Filtered by account, as getRecipes reads the view.
  const { data, error } = await createClient()
    .from("viw_user_collection_set")
    .select("recipe_uuid, auto_plan")
    .eq("account_key", accountKey);
  if (error) throw new Error(error.message);
  const autoPlan = new Map<string, boolean>();
  for (const row of (data ?? []) as { recipe_uuid: string; auto_plan: boolean | null }[]) {
    if (typeof row.auto_plan === "boolean") autoPlan.set(row.recipe_uuid, row.auto_plan);
  }
  return autoPlan;
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

/**
 * "not keto" from a recipe's auto_reason ("diet:keto"; a bare "keto" reads the same), null for "user" or
 * none. The database words it 'not ' || lower(label): every diet's label is its name capitalised, bar
 * "Balanced", which keeps nothing out, so the name gives the same words without reading tbl_diet_rules.
 */
export function dietReason(autoReason: string | null | undefined): string | null {
  const diet = autoReason?.trim().replace(/^diet:/, "");
  return diet && diet !== "user" ? `not ${diet.toLowerCase()}` : null;
}

// ── what the app last saw ──────────────────────────────────────────────────────────────────
// Back from a recipe page rebuilds AppShell from the page Next cached at the visit's first load, recipes
// and their auto_plan as they were then: every return would start from that, until a read lands. So the
// latest auto_plan the app has seen for each recipe (a flip, the diet banner's answer, a read) is kept
// here, in the module, which outlives AppShell for the whole visit. Browser only: on the server this
// module is shared by every request, so nothing is ever kept there.

const latestAutoPlan = new Map<string, boolean>();

export function rememberAutoPlan(recipeUuid: string, autoPlan: boolean) {
  if (typeof window !== "undefined") latestAutoPlan.set(recipeUuid, autoPlan);
}

/** The recipes with the latest auto_plan the app has seen; the same array when nothing differs. */
export function withLatestAutoPlan<T extends { recipe_uuid: string; auto_plan: boolean | null }>(recipes: T[]): T[] {
  let changed = false;
  const next = recipes.map((r) => {
    const value = latestAutoPlan.get(r.recipe_uuid);
    if (value === undefined || value === r.auto_plan) return r;
    changed = true;
    return { ...r, auto_plan: value };
  });
  return changed ? next : recipes;
}

// ── events ─────────────────────────────────────────────────────────────────────────────────
// The recipe page's switch and the diet alert's answer (DietHost) remember what they wrote, then tell
// AppShell, which takes it into its recipes.

const CHANGED_EVENT = "zestil:recipe-planning-changed";

export function announcePlanningChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function onPlanningChanged(fn: () => void) {
  window.addEventListener(CHANGED_EVENT, fn);
  return () => window.removeEventListener(CHANGED_EVENT, fn);
}
