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
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: /^i agree$/i }).click();
    await p;
    await page.waitForTimeout(400);
  }

  console.log("Heading:", await page.locator("h1").first().textContent());
  await page.screenshot({ path: "/tmp/biometrics-before.png" });

  const allButtons = await page.locator("button").allTextContents();
  console.log("Buttons:", JSON.stringify(allButtons));

  // Click a units option and a gender option, check highlighting, check no auto-advance.
  await page.getByRole("button", { name: /metric|imperial|cm.*kg|lb/i }).first().click();
  await page.waitForTimeout(300);
  const headingAfterUnitsClick = await page.locator("h1").first().textContent();
  console.log("Heading after clicking a units option (expect unchanged, no auto-advance):", headingAfterUnitsClick);
  await page.screenshot({ path: "/tmp/biometrics-after-units-click.png" });

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
