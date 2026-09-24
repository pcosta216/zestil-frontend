// Verifies n_cuisine_broad now renders as a tap grid (multi_select), not a
// swipe deck, and that selecting a few tiles + Continue submits correctly.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("response", async (res) => {
    if (res.url().includes("/api/onboarding/answer")) {
      const body = await res.text();
      console.log(`[response] -> ${res.status()}`, JSON.parse(body).node?.id);
    }
  });

  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/zestil/, { timeout: 15000 });
  await page.goto(`${BASE}/onboarding`);
  await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 15000 });
  await page.waitForTimeout(300);

  async function clickAndWait(regex) {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: regex }).first().click();
    await p;
    await page.waitForTimeout(250);
  }

  // (Test account was seeded directly to land on n_cuisine_broad — see reset script.)
  const heading = await page.locator("h1").first().textContent();
  console.log("\nAt node:", heading);

  // Check it's rendered as a grid, not swipe cards.
  const hasSwipeButtons = await page.getByRole("button", { name: /^✓ Yes$|^✕ No$/ }).count();
  const gridTiles = await page.locator("button").filter({ hasText: /^(Asian|Mediterranean|Latin American|Middle Eastern|African|European|American|Other)$/ }).all();
  console.log("Swipe-style Yes/No buttons present:", hasSwipeButtons, "(expect 0)");
  console.log("Tap-grid tiles found:", gridTiles.length, "(expect 8)");

  // Check the layout is visually a grid (2 columns) by comparing bounding box positions.
  const box1 = await gridTiles[0].boundingBox();
  const box2 = await gridTiles[1].boundingBox();
  const sameRow = box1 && box2 && Math.abs(box1.y - box2.y) < 5;
  console.log("First two tiles on the same row (grid, not stacked list):", sameRow);

  await page.screenshot({ path: "/tmp/cuisine-grid.png" });

  // Tap Asian and Mediterranean, then Continue.
  await page.getByRole("button", { name: "Asian" }).click();
  await page.getByRole("button", { name: "Mediterranean" }).click();
  await clickAndWait(/^continue$/i);

  const nextHeading = await page.locator("h1").first().textContent();
  console.log("\nAfter Continue, now on:", nextHeading);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
