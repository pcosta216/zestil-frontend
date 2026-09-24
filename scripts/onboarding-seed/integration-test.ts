// Diagnostic script — reproduces the reported bug by driving the REAL
// server-side logic (loadUserMemory/applyAnswer/saveUserMemory/renderNode,
// exactly as app/api/onboarding/*/route.ts call them) against a REAL
// authenticated Supabase session, unlike smoke-test.ts which calls
// engine.ts directly and never touches server-memory.ts or the stale-node
// check. Creates/reuses a throwaway test user via the admin API.
//
//   npx tsx scripts/onboarding-seed/integration-test.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { __setContentClientForTesting } from "../../lib/onboarding/content";
import { __setMemoryClientForTesting, loadUserMemory, saveUserMemory } from "../../lib/onboarding/server-memory";
import { applyAnswer, entryPoint, renderNode } from "../../lib/onboarding/engine";
import type { Answer, FlowPosition, UserMemory } from "../../lib/onboarding/types";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const TEST_EMAIL = "onboarding-diagnostic-test@example.com";
const TEST_PASSWORD = "diagnostic-test-password-123!";

async function main() {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Find or create the test user.
  let userId: string;
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing?.users.find((u) => u.email === TEST_EMAIL);
  if (found) {
    userId = found.id;
    console.log("Reusing existing test user", userId);
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(`Failed to create test user: ${error?.message}`);
    userId = created.user.id;
    console.log("Created test user", userId);
    // Give the signup trigger a moment to seed tbl_user_memory.
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Reset this user's row so each run starts clean.
  await admin.from("tbl_user_memory").update({ memory_json: {}, flow_position: [] }).eq("account_key", userId);

  // Sign in as a REAL authenticated user (anon key + password) — RLS applies exactly as it
  // would for a browser session, just without the cookie plumbing.
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (signInError || !signInData.session) throw new Error(`Sign-in failed: ${signInError?.message}`);
  console.log("Signed in as", signInData.user?.id);

  __setContentClientForTesting(anon as never);
  __setMemoryClientForTesting(anon as never);

  // --- Mirror app/api/onboarding/state/route.ts exactly ---
  async function callState() {
    const { memory, history } = await loadUserMemory(userId);
    const openEntry = history.find((h) => h.exited_at === null);
    let target: { nodeId: string; item?: string } | { terminal: true };
    if (openEntry) {
      target = { nodeId: openEntry.node_id, item: openEntry.repeat_key };
    } else {
      target = await entryPoint(memory, history);
      if (!("terminal" in target)) await saveUserMemory(userId, memory, history);
    }
    if ("terminal" in target) return { done: true as const };
    const rendered = await renderNode(target.nodeId, target.item, memory);
    return { node: rendered.node, item: rendered.item };
  }

  // --- Mirror app/api/onboarding/answer/route.ts exactly, including the stale-node check ---
  async function callAnswer(nodeId: string, item: string | undefined, answer: Answer) {
    const { memory, history } = await loadUserMemory(userId);
    const openEntry = history.find((h) => h.exited_at === null);
    console.log(`  [answer] loaded history has ${history.length} entries; open entry:`, openEntry ? `${openEntry.node_id} (item=${openEntry.repeat_key})` : "NONE");
    if (openEntry && (openEntry.node_id !== nodeId || openEntry.repeat_key !== item)) {
      console.log(`  [answer] STALE CHECK FIRED: openEntry=${openEntry.node_id}/${openEntry.repeat_key} vs submitted=${nodeId}/${item}`);
      const current = await renderNode(openEntry.node_id, openEntry.repeat_key, memory);
      return { status: 409, node: current.node, item: current.item };
    }
    const result = await applyAnswer({ nodeId, item, answer, memory, history });
    await saveUserMemory(userId, result.memory, result.history);
    if ("terminal" in result.next) return { status: 200, done: true as const, memory: result.memory };
    const rendered = await renderNode(result.next.nodeId, result.next.item, result.memory);
    return { status: 200, node: rendered.node, item: rendered.item, memory: result.memory };
  }

  async function dumpMemory(label: string) {
    const { data } = await admin.from("tbl_user_memory").select("memory_json, flow_position").eq("account_key", userId).single();
    console.log(`\n--- ${label} ---`);
    console.log("diet_type:", JSON.stringify(data?.memory_json?.dietary?.diet_type));
    console.log("flow_position:", JSON.stringify(data?.flow_position?.map((h: { node_id: string; exited_at: string | null }) => `${h.node_id}(${h.exited_at ? "exited" : "OPEN"})`)));
  }

  console.log("\n=== 1. GET /state (fresh) ===");
  let state = await callState();
  console.log("node:", "node" in state ? state.node?.id : state);
  await dumpMemory("after state #1");

  console.log("\n=== 2. answer n_welcome ===");
  if (!("node" in state) || !state.node) throw new Error("expected a node");
  let res = await callAnswer(state.node.id, state.item, {});
  console.log("-> next node:", "node" in res ? res.node?.id : res);
  await dumpMemory("after n_welcome");

  console.log("\n=== 3. answer n_consent ===");
  if (!("node" in res) || !res.node) throw new Error("expected a node");
  res = await callAnswer(res.node.id, res.item, {});
  console.log("-> next node:", "node" in res ? res.node?.id : res);
  await dumpMemory("after n_consent");

  console.log("\n=== 4. answer n_biometrics (skip) ===");
  if (!("node" in res) || !res.node) throw new Error("expected a node");
  res = await callAnswer(res.node.id, res.item, { skipped: true });
  console.log("-> next node:", "node" in res ? res.node?.id : res);
  await dumpMemory("after n_biometrics");

  console.log("\n=== 5. answer n_goal ===");
  if (!("node" in res) || !res.node) throw new Error("expected a node");
  res = await callAnswer(res.node.id, res.item, { values: ["lose_weight_lean_out"] });
  console.log("-> next node:", "node" in res ? res.node?.id : res);
  await dumpMemory("after n_goal");

  console.log("\n=== 6. answer n_diet_style_cards (swipe) ===");
  if (!("node" in res) || !res.node) throw new Error("expected a node");
  console.log("  current node before answering:", res.node.id, "options:", res.node.options?.map((o) => o.value));
  res = await callAnswer(res.node.id, res.item, { values: ["pescatarian", "mediterranean"], left_values: ["keto"] });
  console.log("-> next node:", "node" in res ? res.node?.id : res);
  await dumpMemory("after n_diet_style_cards");

  console.log("\n=== 7. GET /state again (simulating a page reload) ===");
  state = await callState();
  console.log("node:", "node" in state ? state.node?.id : state);
  await dumpMemory("after state #2 (reload)");

  console.log("\n=== 8. answer whatever node #7 returned ===");
  if (!("node" in state) || !state.node) throw new Error("expected a node");
  console.log("  node id:", state.node.id, "type:", state.node.type);
  res = await callAnswer(state.node.id, state.item, { values: ["halal"], left_values: [] });
  console.log("-> next node:", "node" in res ? res.node?.id : res);
  await dumpMemory("after step 8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
