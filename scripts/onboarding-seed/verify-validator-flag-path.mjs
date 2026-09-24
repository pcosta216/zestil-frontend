// Verifies the `flag` path end-to-end: a custom entry the live agent flags should gate on
// confirm, render the AGENT's own reason (not the node's static copy), and on confirm write the
// agent's normalized value — then reads the real memory row back to prove what landed.

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function readMemory() {
  const supabase = createClient(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: userList } = await supabase.auth.admin.listUsers();
  const user = userList.users.find((u) => u.email === EMAIL);
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", user.id).single();
  return data?.memory_json ?? {};
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("response", async (res) => {
    if (res.url().includes("/api/onboarding/validate-other")) {
      console.log(`[validate-other] ${res.status()} ${JSON.stringify(await res.json().catch(() => null))}`);
    }
  });

  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/zestil/, { timeout: 15000 });
  await page.goto(`${BASE}/onboarding`);
  await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 15000 });
  await page.waitForTimeout(500);

  async function submitAndWait(name) {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
    await page.getByRole("button", { name, exact: true }).click();
    await p;
    await page.waitForTimeout(400);
  }
  async function skipAndWait() {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
    await page.getByRole("button", { name: /^skip$/i }).first().click();
    await p;
    await page.waitForTimeout(400);
  }

  await submitAndWait(/^get started$/i);
  await submitAndWait(/^i agree$/i);
  await skipAndWait(); // biometrics
  await skipAndWait(); // n_goal
  await skipAndWait(); // n_diet_style_cards
  await skipAndWait(); // n_cuisine_broad

  console.log("\n=== n_allergies: entry the agent should FLAG ===");
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await page.waitForTimeout(200);
  await page.fill('input[placeholder="Type here…"]', "197");
  await page.waitForTimeout(400); // let React's controlled-input state settle before clicking
  console.log("Typed '197' (a bare number — agent should flag, never invalid, per the allergies guarantee)");

  const continueBtn = page.getByRole("button", { name: /^continue$/i });
  console.log("Continue disabled before click:", await continueBtn.isDisabled());
  await continueBtn.click();
  await page.waitForTimeout(9000); // let the real LLM round trip finish (8s client timeout + margin)

  const heading = await page.locator("h1").first().textContent();
  console.log("Still on n_allergies (expect yes — gated):", heading?.slice(0, 40));
  const bannerText = await page.locator("p.text-red-600, p[class*='red']").allTextContents();
  console.log("Confirm-gate copy shown:", JSON.stringify(bannerText));
  await page.screenshot({ path: "/tmp/validator-flag-gate.png" });

  const confirmBtn = page.getByRole("button", { name: /continue anyway/i });
  console.log("'continue anyway' button present:", (await confirmBtn.count()) > 0);

  if ((await confirmBtn.count()) > 0) {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
    await confirmBtn.click();
    const res = await p;
    console.log("After confirm, advanced to:", (await res.json().catch(() => null))?.node?.id);
    await page.waitForTimeout(800);
  }

  const mem = await readMemory();
  console.log("\ndietary.allergies in the real DB row:", JSON.stringify(mem?.dietary?.allergies));
  console.log("memory.other.allergies:", JSON.stringify(mem?.other?.allergies));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
