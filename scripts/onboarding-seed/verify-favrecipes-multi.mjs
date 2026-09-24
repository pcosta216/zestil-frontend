// n_favorite_recipes: one comma-separated Add should stage several picks and validate ALL of
// them in a single batched call, then write each as its own preferred_recipes entry.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function readRecipes() {
  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === "doe@gmail.com").id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  return data?.memory_json?.meal_planning_preferences?.preferred_recipes;
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("response", async (r) => {
  if (r.url().includes("/api/onboarding/validate-other")) console.log("[validate-other]", JSON.stringify(await r.json().catch(() => null)));
});
page.on("request", (r) => { if (r.url().includes("/api/onboarding/validate-other")) console.log("[sent entries]", r.postData()); });

await page.goto("http://localhost:3000/login");
await page.fill('input[type="email"]', "doe@gmail.com");
await page.fill('input[type="password"]', "diagnostic-reset-pw-123!");
await page.click('button[type="submit"]');
await page.waitForURL(/zestil/, { timeout: 15000 });
await page.goto("http://localhost:3000/onboarding");
await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 15000 });
await page.waitForTimeout(500);
async function step(name) {
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
  await page.getByRole("button", { name, exact: true }).click(); await p; await page.waitForTimeout(400);
}
async function skip() {
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
  await page.getByRole("button", { name: /^skip$/i }).first().click(); await p; await page.waitForTimeout(400);
}
await step(/^get started$/i); await step(/^i agree$/i);
await skip(); await skip(); await skip(); await skip();
await page.getByRole("button", { name: "None of these", exact: true }).click(); await page.waitForTimeout(200);
await step(/^continue$/i);                       // n_allergies
await step("Looks right");                       // n_allergy_confirm
await page.getByRole("button", { name: "I don't have any", exact: true }).click(); await page.waitForTimeout(200);
await step(/^continue$/i);                       // n_intolerances

console.log("\n=== n_favorite_recipes ===");
console.log("Heading:", (await page.locator("h1").first().textContent())?.slice(0, 50));
console.log("Comma hint present:", await page.getByText(/separate them with commas/i).isVisible().catch(() => false));

await page.fill('input[placeholder="e.g. Butter chicken"]', "pizza, lasagna, pad thai");
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(400);
const chips = await page.locator("span.inline-flex").allTextContents();
console.log("Chips staged:", JSON.stringify(chips.map((c) => c.replace("×", "").trim())), "(expect 3)");
await page.screenshot({ path: "/tmp/favrecipes-multi.png" });

await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(14000);
console.log("Gated (still on favorites):", (await page.locator("h1").first().textContent())?.slice(0, 40));
const override = page.getByRole("button", { name: /continue anyway/i });
console.log("'continue anyway' present:", (await override.count()) > 0, "(expect true - only flags, no invalid)");
if (await override.count()) {
  const p2 = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
  await override.click(); await p2; await page.waitForTimeout(1000);
}
console.log("Heading after confirm:", (await page.locator("h1").first().textContent())?.slice(0, 40));
console.log("preferred_recipes in DB:", JSON.stringify((await readRecipes())?.map((r) => r.title)));
await browser.close();
