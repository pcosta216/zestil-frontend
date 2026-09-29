// Pins the request this repo sends for the three macro-source sections against
// MACRO_SOURCES_FRONTEND.md §3, using a local mock in place of the Edge Function.
//
// Why a mock and not the live agent: the deployed function 400s on all three slugs today
// (probe-macro-source-sections.mjs), so there is nothing live to test against — and that is
// exactly why the request shape needs pinning now. When the backend ships, this proves the
// client was already correct, and the probe proves the server is.
//
//   npx tsx scripts/onboarding-seed/verify-macro-source-payload.ts

import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
process.env.NEXT_PUBLIC_SUPABASE_URL ??= env.NEXT_PUBLIC_SUPABASE_URL;

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function checkEqual(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `\n    actual:   ${a}\n    expected: ${e}`);
}

async function main() {
  // --- mock Edge Function ---------------------------------------------------------------------
  interface Captured {
    body: Record<string, unknown>;
    auth: string | undefined;
  }
  const captured: Captured[] = [];
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(raw));
    });

  const server = createServer(async (req, res) => {
    const body = JSON.parse((await readBody(req)) || "{}");
    captured.push({ body, auth: req.headers.authorization });
    // Contract-shaped: same length and order as `entries`, no split_into (§4).
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        results: (body.entries ?? []).map((entry: string) => ({
          entry,
          verdict: entry === "rocks" ? "invalid" : entry === "black beans" ? "flag" : "valid",
          value: entry.trim().toLowerCase().replace(/\s+/g, "_"),
          label: entry.replace(/\b\w/g, (c: string) => c.toUpperCase()),
          reason: entry === "rocks" ? "That's not a food." : entry === "black beans" ? "Both carbs and protein." : null,
        })),
      })
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  // Must be set BEFORE validate-other.ts is loaded — it reads the URL into a module-level const.
  process.env.ONBOARDING_VALIDATOR_FUNCTION_URL = `http://127.0.0.1:${port}`;

  const { emptyUserMemory } = await import("../../lib/onboarding/memory-skeleton");
  const { getNodeStructure } = await import("../../lib/onboarding/flow-structure");
  const { VALIDATOR_SECTIONS } = await import("../../lib/onboarding/validator-sections");
  const { validateEntries } = await import("../../lib/onboarding/validate-other");
  const { __setContentClientForTesting } = await import("../../lib/onboarding/content");
  __setContentClientForTesting(createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) as never);

  const TOKEN = "test-session-token";
  const USER = "00000000-0000-4000-8000-000000000001";
  const DECKS = [
    ["n_protein_exclusion_cards", "protein_source", ["carb_sources", "fat_sources"]],
    ["n_carb_exclusion_cards", "carb_source", ["protein_sources", "fat_sources"]],
    ["n_fat_exclusion_cards", "fat_source", ["protein_sources", "carb_sources"]],
  ] as const;

  const validationOf = (nodeId: string) => {
    const v = getNodeStructure(nodeId).other_capture?.validation;
    if (!v) throw new Error(`${nodeId} has no other_capture.validation`);
    return v as { payload: { section?: unknown; context?: Record<string, unknown> } };
  };

  // --- 1. all three sections are live ----------------------------------------------------------
  console.log("\n=== wiring ===");
  for (const [nodeId, section] of DECKS) {
    check(`${section} is wired in YAML`, validationOf(nodeId).payload.section === section);
    check(`${section} reaches the agent`, VALIDATOR_SECTIONS.has(section));
  }

  console.log("\n=== request contract (MACRO_SOURCES_FRONTEND.md §3) ===");

  // Nothing answered yet — the protein screen runs first on a forward walk.
  const fresh = emptyUserMemory();
  await validateEntries(["salmon", "rocks"], validationOf("n_protein_exclusion_cards"), { memory: fresh }, USER, TOKEN);
  let last = captured[captured.length - 1];
  checkEqual("protein_source body", last.body, {
    user_id: USER,
    section: "protein_source",
    context: { carb_sources: [], fat_sources: [] },
    entries: ["salmon", "rocks"],
  });
  check("the session token is forwarded as a bearer", last.auth === `Bearer ${TOKEN}`, String(last.auth));

  // Mid-flow: protein answered, fat not — the carb screen's context is half-populated.
  const midFlow = emptyUserMemory();
  midFlow.meal_planning_preferences.variety_rules.protein_variety.rotation = ["poultry", "red_meat", "black_beans"];
  await validateEntries(["black beans"], validationOf("n_carb_exclusion_cards"), { memory: midFlow }, USER, TOKEN);
  last = captured[captured.length - 1];
  checkEqual("carb_source body carries the confirmed protein picks as LABELS, and an empty fat list", last.body, {
    user_id: USER,
    section: "carb_source",
    // "Red meat", not "red_meat" — the agent quotes these back to the user. `black_beans` has
    // no curated option (it was typed), so it falls back to the humanised form, which is the
    // same style the agent labels its own entries with.
    context: { protein_sources: ["Poultry", "Red meat", "Black Beans"], fat_sources: [] },
    entries: ["black beans"],
  });

  // The fat screen runs last, so both other macros are populated — the cross-macro duplicate case.
  const late = emptyUserMemory();
  late.meal_planning_preferences.variety_rules.protein_variety.rotation = ["poultry"];
  late.meal_planning_preferences.variety_rules.carb_variety.rotation = ["rice", "oats"];
  await validateEntries(["olive oil"], validationOf("n_fat_exclusion_cards"), { memory: late }, USER, TOKEN);
  last = captured[captured.length - 1];
  checkEqual("fat_source body carries both other macros", last.body, {
    user_id: USER,
    section: "fat_source",
    context: { protein_sources: ["Poultry"], carb_sources: ["Rice", "Oats"] },
    entries: ["olive oil"],
  });

  console.log("\n=== every body, checked structurally ===");
  for (const [, section, contextKeys] of DECKS) {
    const sent = captured.filter((c) => c.body.section === section);
    check(`${section}: at least one call captured`, sent.length > 0);
    for (const call of sent) {
      const context = call.body.context as Record<string, unknown>;
      checkEqual(`${section}: context has exactly the other two macros`, Object.keys(context).sort(), [...contextKeys].sort());
      check(
        `${section}: never sends its own macro back to itself`,
        !Object.keys(context).some((k) => section.startsWith(k.replace(/_sources$/, ""))),
        Object.keys(context).join(",")
      );
      check(
        `${section}: both context values are arrays, never null or omitted`,
        Object.values(context).every((v) => Array.isArray(v)),
        JSON.stringify(context)
      );
      // The agent quotes these straight back at the user, so a stored slug leaking through
      // shows up as "Red_meat" in real copy. Labels start capitalised and carry no underscore.
      const values = Object.values(context).flat() as string[];
      check(
        `${section}: context carries display labels, never stored slugs`,
        values.every((v) => !v.includes("_") && v[0] === v[0].toUpperCase()),
        JSON.stringify(values)
      );
    }
  }

  // --- 3. verdicts come back untouched ---------------------------------------------------------
  console.log("\n=== response pass-through (§4/§5) ===");
  const verdicts = await validateEntries(
    ["salmon", "black beans", "rocks"],
    validationOf("n_protein_exclusion_cards"),
    { memory: fresh },
    USER,
    TOKEN
  );
  checkEqual("one result per entry, same order", verdicts.map((r) => r.entry), ["salmon", "black beans", "rocks"]);
  checkEqual("verdicts pass through unmodified", verdicts.map((r) => r.verdict), ["valid", "flag", "invalid"]);
  check("the agent's normalisation survives — it's what gets written", verdicts[1].value === "black_beans", verdicts[1].value ?? "null");
  check("a flag's reason survives — it IS the copy the user reads", verdicts[1].reason === "Both carbs and protein.", verdicts[1].reason ?? "null");

  // --- 4. a rejecting function degrades safely --------------------------------------------------
  // The failure mode that matters most here: an unknown section 400s, and that degrades rather
  // than throwing — so a rename on either side goes quiet instead of loud. This is exactly what
  // probe-macro-source-sections.mjs exists to catch before a user does.
  console.log("\n=== a 400 from the function degrades, it does not throw ===");
  server.close();
  const rejecting = createServer((_req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "section must be one of the known onboarding sections" }));
  });
  await new Promise<void>((r) => rejecting.listen(port, r));
  const degraded = await validateEntries(["cassava"], validationOf("n_carb_exclusion_cards"), { memory: fresh }, USER, TOKEN);
  check("every entry becomes a flag, not a silent accept", degraded.every((r) => r.verdict === "flag"));
  check("carrying the total-failure reason the user would see", /temporary issue on our end/.test(degraded[0].reason ?? ""), degraded[0].reason ?? "null");
  rejecting.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
