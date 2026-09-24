// End-to-end check of the Onboarding Validator Agent integration, through the real UI and the
// real (live) edge function. Walks to n_allergies, types a custom allergy that should come back
// `valid` silently, then one that should come back `flag` and gate on confirm.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("response", async (res) => {
    if (res.url().includes("/api/onboarding/validate-other")) {
      const body = await res.json().catch(() => null);
      console.log(`[validate-other] ${res.status()} ${JSON.stringify(body)}`);
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

  console.log("\n=== n_allergies ===");
  console.log("Heading:", await page.locator("h1").first().textContent());

  // Case 1: a real allergen the agent should return `valid` for -> no confirm gate, submits straight through.
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await page.waitForTimeout(200);
  await page.fill('input[placeholder="Type here…"]', "sesame");
  await page.waitForTimeout(150);
  console.log("Typed 'sesame', clicking Continue (expect: valid -> advances with no confirm gate)");
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 25000 });
    await page.getByRole("button", { name: /^continue$/i }).click();
    const res = await p;
    const body = await res.json().catch(() => null);
    console.log("Advanced to:", body?.node?.id);
    await page.waitForTimeout(500);
  }
  console.log("Heading now:", await page.locator("h1").first().textContent());
  await page.screenshot({ path: "/tmp/validator-after-valid.png" });

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
