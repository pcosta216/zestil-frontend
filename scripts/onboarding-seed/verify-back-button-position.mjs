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

  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: /^get started$/i }).click();
    await p;
    await page.waitForTimeout(400);
  }
  // n_consent has no Back (first real step); take a screenshot pre-agree, then agree to reach
  // n_biometrics, which DOES show Back (canBack should be true by then).
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: /^i agree$/i }).click();
    await p;
    await page.waitForTimeout(400);
  }

  console.log("Heading:", await page.locator("h1").first().textContent());
  const backBtn = page.getByRole("button", { name: /back/i });
  const count = await backBtn.count();
  console.log("Back button count:", count);
  if (count > 0) {
    const box = await backBtn.boundingBox();
    console.log("Back button box:", box);
    const viewport = page.viewportSize();
    console.log("Viewport:", viewport);
    console.log("Distance from right edge:", viewport.width - (box.x + box.width));
    console.log("Distance from top edge:", box.y);
  }
  await page.screenshot({ path: "/tmp/back-button-position.png" });

  // Scroll down a bit if content is tall, to confirm fixed positioning stays anchored.
  await page.evaluate(() => window.scrollTo(0, 100));
  await page.waitForTimeout(200);
  await page.screenshot({ path: "/tmp/back-button-position-scrolled.png" });

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
