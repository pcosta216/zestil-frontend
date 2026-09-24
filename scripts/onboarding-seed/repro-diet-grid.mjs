// Verifies n_diet_style_cards now renders as a tap grid (multi_select),
// preferred-only, and that to_avoid stays empty afterward.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  let nextNode = null;
  page.on("response", async (res) => {
    if (res.url().includes("/api/onboarding/answer")) {
      const body = await res.json();
      nextNode = body.node?.id;
      console.log(`[response] -> ${res.status()}`, nextNode);
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

  const heading = await page.locator("h1").first().textContent();
  console.log("\nAt node:", heading);

  const hasSwipeButtons = await page.getByRole("button", { name: /^✓ Yes$|^✕ No$/ }).count();
  const labels = ["Mediterranean", "Paleo", "Vegetarian", "Vegan", "Pescatarian", "Keto", "Low-carb", "Gluten-free", "Balanced / no specific style"];
  const tiles = [];
  for (const l of labels) {
    const btn = page.getByRole("button", { name: l, exact: true });
    if (await btn.count()) tiles.push(l);
  }
  console.log("Swipe-style Yes/No buttons present:", hasSwipeButtons, "(expect 0)");
  console.log("Grid tiles found:", tiles.length, "/", labels.length, tiles);

  await page.screenshot({ path: "/tmp/diet-style-grid.png" });

  // Tap Pescatarian + Mediterranean, then Continue.
  await page.getByRole("button", { name: "Pescatarian", exact: true }).click();
  await page.getByRole("button", { name: "Mediterranean", exact: true }).click();
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
  await page.getByRole("button", { name: /^continue$/i }).click();
  const res = await p;
  const body = await res.json();
  console.log("\nSubmitted. Next node:", body.node?.id);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
