import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

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

  console.log("\nAt n_favorite_recipes (known-slow transition to protein_exclusion_cards). Heading:", await page.locator("h1").first().textContent());
  const skipBtn = page.getByRole("button", { name: /skip/i }).first();
  console.log("Skip button disabled BEFORE click:", await skipBtn.isDisabled());
  const handle = await skipBtn.elementHandle(); // stable reference — survives the text changing to "…"

  const t0 = Date.now();
  const responsePromise = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
  await skipBtn.click();

  for (const gap of [100, 400, 500]) {
    await page.waitForTimeout(gap);
    const state = await handle
      .evaluate((el) => ({ disabled: el.disabled, text: el.textContent, connected: el.isConnected }))
      .catch((e) => ({ error: e.message.split("\n")[0] }));
    console.log(`t=${Date.now() - t0}ms `, state);
  }
  await page.screenshot({ path: "/tmp/skip-loading-state.png" });

  await responsePromise;
  await page.waitForTimeout(400);
  console.log(`Response arrived at t=${Date.now() - t0}ms. Heading after response:`, await page.locator("h1").first().textContent());

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
