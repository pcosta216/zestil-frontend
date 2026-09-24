// Verifies the double-submission guard: deliberately fires two rapid clicks
// on the same button (simulating a human double-click / React StrictMode's
// dev-mode double effect invocation) and confirms only ONE /answer request
// actually goes out.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  let answerRequestCount = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/onboarding/answer")) {
      answerRequestCount++;
      console.log(`[request #${answerRequestCount}]`, req.postData());
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

  // Walk to n_goal (welcome -> get started, consent -> agree, biometrics -> skip)
  for (const regex of [/get started/i, /i agree/i, /^skip$/i]) {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
    await page.getByRole("button", { name: regex }).first().click();
    await p;
    await page.waitForTimeout(200);
  }

  const heading = await page.locator("h1").first().textContent();
  console.log("\nAt node:", heading);

  answerRequestCount = 0;
  console.log("\nFiring TWO rapid clicks on the same option (no wait between them)...");
  const optionBtn = page.getByRole("button", { name: /eat healthier/i }).first();
  // Fire both clicks essentially simultaneously — this is what a real double-click does.
  await Promise.all([optionBtn.click(), optionBtn.click({ force: true }).catch(() => {})]);
  await page.waitForTimeout(2000);

  console.log(`\nTotal /answer requests fired: ${answerRequestCount} (expected: 1)`);
  console.log(answerRequestCount === 1 ? "PASS — guard prevented the duplicate." : "FAIL — duplicate request got through.");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
