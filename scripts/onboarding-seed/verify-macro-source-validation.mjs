// End-to-end, against the LIVE agent: the "Other" box on a macro exclusion deck runs what the
// user types past the Onboarding Validator Agent, and acts on the verdict.
//
// Reached the only way this box opens: keto excludes all 8 carb categories, so nothing is
// selectable and MultiSelect forces the free-text field (see exclusion-decks.md's
// needsAlternative). That makes this the one screen where the user MUST type something — which
// is exactly why the entry is worth validating.
//
// No stub here on purpose. verify-macro-source-payload.ts pins the request shape against a
// mock; this proves the deployed function is actually reached and its verdict drives the UI.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
import { openOnboarding, walkTo, makeCheck, click, tap, headingOf } from "./_walk.mjs";
config({ path: resolve(process.cwd(), ".env.local") });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function memoryJson() {
  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === "doe@gmail.com").id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  return data?.memory_json;
}

const { browser, page } = await openOnboarding();
const { check, finish } = makeCheck();

let validatorCalls = 0;
page.on("request", (r) => {
  if (r.url().includes("/api/onboarding/validate-other")) validatorCalls++;
});

await walkTo(page, /none of our usual carb sources fit/i, {
  answers: [
    [/eating style best describes you/i, async (p) => { await tap(p, "Keto"); await click(p, /^continue$/i); }],
    [/proteins you'd never eat/i, async (p) => { await click(p, /^continue$/i); }],
  ],
});

console.log("\n=== n_carb_exclusion_cards, nothing selectable ===");
console.log("  heading:", await headingOf(page));
const box = page.locator('input[placeholder="Type here…"]');
check("the free-text box is open without the user asking", await box.isVisible().catch(() => false));

// --- a real food, but for the wrong macro -> invalid, no way to force it through -------------
console.log("\n--- typing 'game meat' (a protein, on the carb screen) ---");
await box.fill("game meat");
await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(14000); // live call: p90 ~7.4s function time, plus transit

check("the box is wired to the validator", validatorCalls === 1, `calls=${validatorCalls}`);
const copy = (await page.locator("p").allTextContents()).filter((t) => t.length > 20);
console.log("  agent said:", JSON.stringify(copy.filter((t) => /game meat/i.test(t))));
check("the flow did not advance", /none of our usual carb sources fit/i.test(await headingOf(page)), await headingOf(page));
check(
  "the agent's own reason is shown, naming the macro it belongs under",
  copy.some((t) => /game meat/i.test(t) && /protein/i.test(t)),
  JSON.stringify(copy)
);
check(
  "no accept-as-typed affordance for an `invalid` verdict",
  (await page.getByRole("button", { name: /^yes\s+[—-]/i }).count()) === 0
);
check("Continue stays blocked until it's resolved", await page.getByRole("button", { name: /^continue$/i }).isDisabled());
await page.screenshot({ path: "/tmp/macro-source-invalid.png", fullPage: true });

// --- correcting it: a real carb the curated list doesn't cover -------------------------------
console.log("\n--- correcting to 'cassava' ---");
await box.fill("cassava");
await page.waitForTimeout(400);
const advanced = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 40000 });
await page.getByRole("button", { name: /^continue$/i }).click();
await advanced;
await page.waitForTimeout(900);

check("re-typing re-validates rather than reusing the old verdict", validatorCalls === 2, `calls=${validatorCalls}`);
console.log("  now on:", await headingOf(page));
check("a valid entry submits and the flow moves on", !/none of our usual carb sources fit/i.test(await headingOf(page)));

const memory = await memoryJson();
const rotation = memory?.meal_planning_preferences?.variety_rules?.carb_variety?.rotation;
console.log("  carb_variety.rotation:", JSON.stringify(rotation));
console.log("  other.carb_source:    ", JSON.stringify(memory?.other?.carb_source));
check("the accepted entry is the whole carb rotation", Array.isArray(rotation) && rotation.length === 1, JSON.stringify(rotation));
check("and is staged under the section's own slug", Array.isArray(memory?.other?.carb_source), JSON.stringify(memory?.other));
check("the rejected entry was never written", !JSON.stringify(memory ?? {}).match(/game[_ ]meat/i));

await finish(browser);
