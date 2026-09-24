import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const BASE = "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function readMem() {
  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === "doe@gmail.com").id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  return data?.memory_json ?? {};
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("request", (r) => {
  if (r.url().includes("/api/onboarding/answer")) console.log("[answer REQUEST BODY]", r.postData());
});
page.on("response", async (r) => {
  if (r.url().includes("/api/onboarding/validate-other")) console.log("[validate-other]", JSON.stringify(await r.json().catch(() => null)));
});

await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', "doe@gmail.com");
await page.fill('input[type="password"]', "diagnostic-reset-pw-123!");
await page.click('button[type="submit"]');
await page.waitForURL(/zestil/, { timeout: 15000 });
await page.goto(`${BASE}/onboarding`);
await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 15000 });
await page.waitForTimeout(500);

async function step(name) {
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
  await page.getByRole("button", { name, exact: true }).click();
  await p; await page.waitForTimeout(400);
}
async function skip() {
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
  await page.getByRole("button", { name: /^skip$/i }).first().click();
  await p; await page.waitForTimeout(400);
}
await step(/^get started$/i); await step(/^i agree$/i);
await skip(); await skip(); await skip(); await skip();

console.log("\n=== typing 'round table with kiwis' on n_allergies ===");
await page.getByRole("button", { name: "Other", exact: true }).click();
await page.waitForTimeout(300);
await page.fill('input[placeholder="Type here…"]', "round table with kiwis");
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(12000);

console.log("Heading after continue:", (await page.locator("h1").first().textContent())?.slice(0, 40));
const m1 = await readMem();
console.log("\n[BEFORE confirm screen] dietary.allergies:", JSON.stringify(m1?.dietary?.allergies));
console.log("[BEFORE confirm screen] other.allergies  :", JSON.stringify(m1?.other?.allergies));

const looksRight = page.getByRole("button", { name: "Looks right", exact: true });
if (await looksRight.count()) {
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
  await looksRight.click(); await p; await page.waitForTimeout(600);
  const m2 = await readMem();
  console.log("[AFTER  confirm screen] dietary.allergies:", JSON.stringify(m2?.dietary?.allergies));
}
await browser.close();
