import { createClient } from "@/lib/supabase/browser";
import type { DiscoveryItem } from "@/components/DiscoveryItems";

// The diet-change surface (docs/FRONTEND_DIET_CHANGE.md). Everything here is a Postgres function
// or a read, called from the browser with the signed-in user's JWT; `p_account_key` must be the
// user's own id or the database refuses it.
//
// The screens that need it are far apart (two chats, the Saved tab, and a progress sheet that must
// outlive a tab switch), so they talk to one host in AppShell through window events instead of
// threading props through every tab.

export type DietItemKind = "recipe" | "side" | "snack";

/** What a chat reply carries when it started a search for the diet's recipes. */
export interface RecipeSearchStart {
  diet: string;
  run: string; // ISO timestamp; identifies the search so a stale record is never shown for it
  target: number;
}

/** memory_json.diet_search — the search's own progress record, never onboarding's. */
export interface DietSearchRecord {
  diet?: string;
  run?: string;
  status?: "running" | "complete" | "failed";
  started_at?: string;
  finished_at?: string;
  items?: DiscoveryItem[];
}

export interface ItemFitsDiet {
  ok: boolean;
  strict_diet: string | null;
  label?: string;
  fits: boolean | null;
  why?: string;
  kept_out?: boolean;
  kept_in?: boolean;
  ask: boolean;
}

export interface SetDietPlanning {
  ok: boolean;
  kind: DietItemKind;
  uuid: string;
  name?: string;
  strict_diet: string | null;
  label?: string;
  in_planning: boolean;
}

/** `why` while the agents have not classified a freshly saved recipe. */
export const NOT_CLASSIFIED_WHY = "not classified yet";

export async function fetchDietSearch(): Promise<DietSearchRecord | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tbl_user_memory")
    .select("search:memory_json->diet_search")
    .single();
  if (error) throw new Error(error.message);
  return (data as { search?: DietSearchRecord | null } | null)?.search ?? null;
}

export async function itemFitsDiet(accountKey: string, kind: DietItemKind, uuid: string): Promise<ItemFitsDiet> {
  const { data, error } = await createClient().rpc("item_fits_diet", {
    p_account_key: accountKey,
    p_kind: kind,
    p_uuid: uuid,
  });
  if (error) throw new Error(error.message);
  return data as ItemFitsDiet;
}

export async function setDietPlanning(
  accountKey: string,
  kind: DietItemKind,
  uuid: string,
  inPlanning: boolean,
): Promise<SetDietPlanning> {
  const { data, error } = await createClient().rpc("set_diet_planning", {
    p_account_key: accountKey,
    p_kind: kind,
    p_uuid: uuid,
    p_in_planning: inPlanning,
  });
  if (error) throw new Error(error.message);
  return data as SetDietPlanning;
}

// ── events ─────────────────────────────────────────────────────────────────────────────────

const SEARCH_EVENT = "zestil:diet-search";
const SAVED_EVENT = "zestil:item-saved";

export function isRecipeSearchStart(v: unknown): v is RecipeSearchStart {
  const r = v as Partial<RecipeSearchStart> | null | undefined;
  return !!r && typeof r.diet === "string" && typeof r.run === "string";
}

/** A chat reply carried `recipe_search`: open the progress screen. Ignores anything malformed. */
export function announceDietSearch(recipeSearch: unknown) {
  if (!isRecipeSearchStart(recipeSearch)) return;
  window.dispatchEvent(new CustomEvent<RecipeSearchStart>(SEARCH_EVENT, { detail: recipeSearch }));
}

/** An item was just saved: ask whether it fits a strict diet (the host does nothing without one). */
export function announceItemSaved(kind: DietItemKind, uuid: string | null | undefined) {
  if (!uuid) return;
  window.dispatchEvent(new CustomEvent<{ kind: DietItemKind; uuid: string }>(SAVED_EVENT, { detail: { kind, uuid } }));
}

export function onDietSearch(fn: (s: RecipeSearchStart) => void) {
  const h = (e: Event) => fn((e as CustomEvent<RecipeSearchStart>).detail);
  window.addEventListener(SEARCH_EVENT, h);
  return () => window.removeEventListener(SEARCH_EVENT, h);
}

export function onItemSaved(fn: (i: { kind: DietItemKind; uuid: string }) => void) {
  const h = (e: Event) => fn((e as CustomEvent<{ kind: DietItemKind; uuid: string }>).detail);
  window.addEventListener(SAVED_EVENT, h);
  return () => window.removeEventListener(SAVED_EVENT, h);
}
