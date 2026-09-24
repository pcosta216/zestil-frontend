import { createClient } from "@/lib/supabase/server";
import type { ContentOption, NodeContent } from "./types";

// Server-only. Loads onboarding COPY (prompts, options, curated lookup
// tables) from tbl_onboarding_content at runtime, so an admin edit shows up
// without a redeploy — unlike flow-structure.ts, which is deploy-time
// content cached for the life of the process.
//
// tbl_onboarding_content's RLS policy grants blanket `select` to any
// authenticated user (see the migration), so the normal per-request
// RLS-scoped client is sufficient — no service-role client needed.
//
// Cache is a short in-process TTL, best-effort only: correct within a
// single long-lived Node process (e.g. `next dev`, or a persistent server),
// but each serverless invocation gets its own cache in a cold-start
// deployment. That's an acceptable trade-off here — it just means some
// requests skip the cache, not that content ever goes stale beyond the TTL.

// Structural rather than supabase-js's own SupabaseClient, so the smoke test can inject a plain
// client without this module depending on its types. Deliberately loose past `from()`: callers
// build different chains — a single-row `.select().eq().single()` here, and
// `.select().eq().order().limit()` in cuisines.ts — and typing every supabase query-builder
// permutation precisely buys nothing a runtime error wouldn't catch first.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface QueryableClient {
  from(table: string): any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Test-only seam: engine.ts/resolvers.ts run outside a Next.js request
// context in the smoke-test script (no `next/headers` cookie scope), so
// they can't go through the normal per-request createClient(). Overriding
// this lets the smoke test supply a plain supabase-js client instead.
// Never called from application code — only from scripts/onboarding-seed/smoke-test.ts.
let clientOverride: QueryableClient | null = null;
export function __setContentClientForTesting(client: QueryableClient | null): void {
  clientOverride = client;
}

/**
 * The client every onboarding read should go through: the injected test client when one is set,
 * otherwise the normal per-request RLS-scoped server client. Shared with cuisines.ts so both
 * content and cuisine reads honour the same test seam.
 */
export async function getOnboardingDbClient(): Promise<QueryableClient> {
  return clientOverride ?? ((await createClient()) as unknown as QueryableClient);
}

const TTL_MS = 60_000;
const cache = new Map<string, { data: unknown; expiresAt: number }>();

async function fetchSection(sectionId: string): Promise<unknown> {
  const cached = cache.get(sectionId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const supabase = await getOnboardingDbClient();
  const { data, error } = await supabase
    .from("tbl_onboarding_content")
    .select("data")
    .eq("section_id", sectionId)
    .single();

  if (error || !data) {
    throw new Error(`onboarding content section not found: "${sectionId}"${error ? ` (${error.message})` : ""}`);
  }

  cache.set(sectionId, { data: data.data, expiresAt: Date.now() + TTL_MS });
  return data.data;
}

/** Clears the in-process cache. Exposed for scripts/tests, not used at runtime. */
export function clearContentCache(): void {
  cache.clear();
}

/** Full content row for a node: prompt, options, skip_label, etc. */
export async function getNodeContent(nodeId: string): Promise<NodeContent> {
  return (await fetchSection(`node:${nodeId}`)) as NodeContent;
}

/** A curated lookup table section, e.g. "curated:cuisine.sub_cuisines". Shape varies per table — see types.ts. */
export async function getCuratedSection<T = unknown>(sectionId: string): Promise<T> {
  return (await fetchSection(sectionId)) as T;
}

/** The shared 7-day option list (n_week_start, n_fixed_meals.day_of_week). */
export async function getDaysOfWeek(): Promise<ContentOption[]> {
  const section = (await fetchSection("content:days_of_week")) as { options: ContentOption[] };
  return section.options;
}

/** Sorts any option array by id_order ascending — every render path should call this before displaying. */
export function sortByOrder<T extends { id_order: number }>(options: T[]): T[] {
  return [...options].sort((a, b) => a.id_order - b.id_order);
}
