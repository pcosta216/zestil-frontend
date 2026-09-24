import { openOnboarding, walkTo } from "./_walk.mjs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function readSlots() {
  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === "doe@gmail.com").id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  return data?.memory_json?.meal_planning_preferences?.active_slots;
}
const { browser, page } = await openOnboarding();
await walkTo(page, /which meals do you want us to plan/i);

const click = async (name) => {
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 30000 });
  await page.getByRole("button", { name, exact: true }).click();
  await p;
  await page.waitForTimeout(500);
};
const tap = async (name) => { await page.getByRole("button", { name, exact: true }).click(); await page.waitForTimeout(200); };

console.log("\n=== n_active_slots ===");
console.log("Heading:", (await page.locator("h1").first().textContent())?.slice(0, 50));
const sel = async (n) => /green-light/.test((await page.getByRole("button", { name: n, exact: true }).getAttribute("class")) ?? "");
console.log("Preselected -> Breakfast:", await sel("Breakfast"), "Lunch:", await sel("Lunch"), "Dinner:", await sel("Dinner"));
await page.screenshot({ path: "/tmp/active-slots-default.png" });

for (const n of ["Breakfast", "Lunch", "Dinner"]) await tap(n);
console.log("All unticked -> Continue disabled?", await page.getByRole("button", { name: /^continue$/i }).isDisabled(), "(expect false)");

await tap("Breakfast"); await tap("Dinner");
await click(/^continue$/i);
console.log("active_slots written:", JSON.stringify(await readSlots()));
console.log("NEXT screen after active slots:", (await page.locator("h1").first().textContent())?.slice(0, 60));
console.log("  (expect the week-start question, NOT the leftovers one)");
await browser.close();
