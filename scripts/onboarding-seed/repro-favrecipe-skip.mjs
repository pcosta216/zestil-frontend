// Vegan + gluten allergy -> n_favorite_recipes -> Skip. User reports this lands past the
// protein exclusion screen entirely. Engine-level check already proved 2 options remain
// (should render, not auto-skip) — this tests the real browser with CAREFUL single clicks
// first, then a rapid double-click on Skip specifically.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function walkToFavoriteRecipes(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/zestil/, { timeout: 15000 });
  await page.goto(`${BASE}/onboarding`);
  await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 15000 });
  await page.waitForTimeout(500);

  async function clickAndWait(name) {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name, exact: true }).click();
    await p;
    await page.waitForTimeout(400);
  }

  await clickAndWait(/^get started$/i);
  await clickAndWait(/^i agree$/i);
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: /skip/i }).first().click();
    await p;
    await page.waitForTimeout(400);
  }
  await clickAndWait("Eat healthier, balanced meals");

  await page.getByRole("button", { name: "Vegan", exact: true }).click();
  await page.waitForTimeout(150);
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: /^continue$/i }).click();
    await p;
    await page.waitForTimeout(400);
  }
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: /skip/i }).first().click();
    await p;
    await page.waitForTimeout(400);
  }
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: "Gluten", exact: true }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: /^continue$/i }).click();
    await p;
    await page.waitForTimeout(400);
  }
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: /looks right|confirm/i }).first().click();
    await p;
    await page.waitForTimeout(400);
  }
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: /skip|don't have any/i }).first().click();
    await p;
    await page.waitForTimeout(400);
  }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  let answerCount = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/onboarding/answer")) {
      answerCount++;
      console.log(`[request #${answerCount}] ${req.postData()?.slice(0, 150)}`);
    }
  });

  await walkToFavoriteRecipes(page);
  const heading1 = await page.locator("h1").first().textContent();
  console.log("\nAt n_favorite_recipes. Heading:", heading1);

  console.log("\n=== CAREFUL single click on Skip ===");
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
  await page.getByRole("button", { name: /skip/i }).first().click();
  const res = await p;
  const body = await res.json().catch(() => null);
  console.log("Response next node:", body?.node?.id);
  await page.waitForTimeout(500);
  console.log("Heading now:", await page.locator("h1").first().textContent());

  await page.screenshot({ path: "/tmp/favrecipe-skip-result.png" });
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
