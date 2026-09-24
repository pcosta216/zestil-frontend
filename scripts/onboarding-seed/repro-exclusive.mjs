// Verifies exclusive_value behavior on n_diet_style_cards: picking
// "Balanced / no specific style" clears+disables everything else; picking
// a normal option clears it back.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/zestil/, { timeout: 15000 });
  await page.goto(`${BASE}/onboarding`);
  await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 15000 });
  await page.waitForTimeout(300);

  console.log("=== Step 1: select Vegan + Keto normally ===");
  await page.getByRole("button", { name: "Vegan", exact: true }).click();
  await page.getByRole("button", { name: "Keto", exact: true }).click();
  await page.waitForTimeout(150);

  const veganSelected = await page.getByRole("button", { name: "Vegan", exact: true }).evaluate((el) => el.className.includes("green-light"));
  console.log("Vegan shows selected:", veganSelected, "(expect true)");

  console.log("\n=== Step 2: now tap Balanced / no specific style ===");
  await page.getByRole("button", { name: "Balanced / no specific style", exact: true }).click();
  await page.waitForTimeout(150);

  const veganAfter = await page.getByRole("button", { name: "Vegan", exact: true });
  const veganClass = await veganAfter.evaluate((el) => el.className);
  const veganDisabled = await veganAfter.isDisabled();
  const veganStillSelected = veganClass.includes("green-light");
  console.log("Vegan disabled:", veganDisabled, "(expect true)");
  console.log("Vegan still shows selected:", veganStillSelected, "(expect false — should have been cleared)");

  const balancedClass = await page.getByRole("button", { name: "Balanced / no specific style", exact: true }).evaluate((el) => el.className);
  console.log("Balanced shows selected:", balancedClass.includes("green-light"), "(expect true)");

  // Try clicking a disabled option — should be a no-op.
  await page.getByRole("button", { name: "Keto", exact: true }).click({ force: true }).catch(() => {});
  await page.waitForTimeout(150);
  const ketoClassAfterForceClick = await page.getByRole("button", { name: "Keto", exact: true }).evaluate((el) => el.className);
  console.log("Keto still unselected after forced click on disabled tile:", !ketoClassAfterForceClick.includes("green-light"), "(expect true)");

  await page.screenshot({ path: "/tmp/exclusive-value-active.png" });

  console.log("\n=== Step 3: tap Balanced again to un-select it, then Vegan should be re-enabled ===");
  await page.getByRole("button", { name: "Balanced / no specific style", exact: true }).click();
  await page.waitForTimeout(150);
  const veganEnabledAgain = !(await page.getByRole("button", { name: "Vegan", exact: true }).isDisabled());
  console.log("Vegan re-enabled after un-selecting Balanced:", veganEnabledAgain, "(expect true)");

  console.log("\n=== Step 4: submit with Balanced selected, confirm server receives only that value ===");
  await page.getByRole("button", { name: "Balanced / no specific style", exact: true }).click();
  await page.waitForTimeout(150);
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await p;
  await page.waitForTimeout(300);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
