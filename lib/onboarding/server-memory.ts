import { createClient } from "@/lib/supabase/server";
import { mergeIntoSkeleton } from "./memory-skeleton";
import type { FlowPosition, UserMemory } from "./types";

// Server-only. Reads/writes tbl_user_memory for the current authenticated
// user via the normal RLS-scoped client (account_key = auth.uid() — see
// 20260910_auth_signup_bootstrap.sql's policies) — no service-role client
// needed, every route here always acts as "the signed-in user's own row."

interface QueryableUpdatableClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        single(): Promise<{ data: { memory_json: unknown; flow_position: unknown } | null; error: { message: string } | null }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
    };
  };
}

// Test-only seam, same pattern/purpose as content.ts's — lets a diagnostic
// script drive this module with a real authenticated (non-cookie-based)
// supabase-js client outside a Next.js request context. Never called from
// application code.
let clientOverride: QueryableUpdatableClient | null = null;
export function __setMemoryClientForTesting(client: QueryableUpdatableClient | null): void {
  clientOverride = client;
}

export interface UserMemoryRow {
  memory: UserMemory;
  history: FlowPosition;
}

/** Loads the current user's draft. The row itself always exists (seeded by the signup trigger), but memory_json/flow_position may still be at their column defaults — fall back to a fresh skeleton/[] rather than assuming shape. */
export async function loadUserMemory(userId: string): Promise<UserMemoryRow> {
  const supabase = clientOverride ?? (await createClient());
  const { data, error } = await supabase
    .from("tbl_user_memory")
    .select("memory_json, flow_position")
    .eq("account_key", userId)
    .single();

  if (error) throw new Error(`loadUserMemory: ${error.message}`);

  // Always merged onto the skeleton rather than cast to it. A stored row can be partial (an
  // older schema, a hand-edit, an interrupted write), and a cast would hand the engine a shape
  // with paths simply missing — which is how a scalar ends up written where a list belongs.
  // See mergeIntoSkeleton.
  const memory = mergeIntoSkeleton(data?.memory_json);
  const history = Array.isArray(data?.flow_position) ? (data.flow_position as FlowPosition) : [];
  return { memory, history };
}

/** Lightweight incremental merge after every answer — meta.autosave_after_each_node. */
export async function saveUserMemory(userId: string, memory: UserMemory, history: FlowPosition): Promise<void> {
  const supabase = clientOverride ?? (await createClient());
  const { error } = await supabase
    .from("tbl_user_memory")
    .update({ memory_json: memory, flow_position: history })
    .eq("account_key", userId);

  if (error) throw new Error(`saveUserMemory: ${error.message}`);
}

/**
 * n_compile, this phase: sets the two completion timestamps and clears
 * flow_position (the session is done — nothing left to resume). Full UUID
 * resolution (resolve_recipe_uuid/create_recipe_stub/queue_recipe_for_
 * catalog_review) is explicitly deferred to the onboarding agent, which
 * doesn't exist yet — every recipe_uuid already sits at null from the
 * engine's writes, so there's nothing to backfill here yet.
 */
export async function commitUserMemory(userId: string, memory: UserMemory): Promise<UserMemory> {
  const now = new Date();
  // pairing_sample/pairing_sample_source are n_pairing_cards' internal sample_from bookkeeping
  // (see types.ts's header note on those fields) — not part of the real profile schema, stripped
  // here same as flow_position itself is cleared below.
  const { pairing_sample: _pairingSample, pairing_sample_source: _pairingSampleSource, ...mealPlanningPreferences } = memory.meal_planning_preferences;
  const finalMemory: UserMemory = {
    ...memory,
    last_updated: now.toISOString().slice(0, 10),
    profile: {
      ...memory.profile,
      onboarding_completed_at: now.toISOString().slice(0, 10),
    },
    meal_planning_preferences: mealPlanningPreferences,
  };

  const supabase = clientOverride ?? (await createClient());
  const { error } = await supabase
    .from("tbl_user_memory")
    .update({ memory_json: finalMemory, flow_position: [] })
    .eq("account_key", userId);

  if (error) throw new Error(`commitUserMemory: ${error.message}`);
  return finalMemory;
}
