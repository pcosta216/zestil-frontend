// Checks the comma hint renders on an other_capture screen (n_allergies) and, separately,
// that a multi-entry comma submission still splits into distinct validated entries.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("response", async (res) => {
    if (res.url().includes("/api/onboarding/validate-other")) {
      console.log(`[validate-other] ${JSON.stringify(await res.json().catch(() => null))}`);
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
  console.log("Hint visible BEFORE tapping Other:", await page.getByText(/separate them with commas/i).isVisible().catch(() => false), "(expect false — field not open yet)");

  await page.getByRole("button", { name: "Other", exact: true }).click();
  await page.waitForTimeout(300);
  const hint = page.getByText(/separate them with commas/i);
  console.log("Hint visible AFTER tapping Other:", await hint.isVisible().catch(() => false), "(expect true)");
  console.log("Hint text:", await hint.textContent().catch(() => "(none)"));
  await page.screenshot({ path: "/tmp/comma-hint.png" });

  // And confirm a comma-separated submission really does split into separate entries.
  await page.fill('input[placeholder="Type here…"]', "sesame, kiwi");
  await page.waitForTimeout(400);
  console.log("\nSubmitting 'sesame, kiwi' (expect TWO separate entries in the validate call)");
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForTimeout(9000);
  console.log("Heading now:", (await page.locator("h1").first().textContent())?.slice(0, 50));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
