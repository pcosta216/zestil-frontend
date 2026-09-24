// Reproduces the reported bug with a real headless browser against the
// live dev server on :3000, signed in as the actual test account whose
// stuck state we found in the DB (alex@gmail.com, password reset for
// this diagnostic). Logs every /api/onboarding/* request+response and
// every console message/page error so the failure is visible directly,
// not guessed at.
//
//   npx playwright install chromium   (one-time)
//   node scripts/onboarding-seed/browser-repro.mjs

import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on("console", (msg) => console.log(`[console:${msg.type()}]`, msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message, "\n", err.stack));

  page.on("request", (req) => {
    if (req.url().includes("/api/onboarding/")) console.log(`[request] ${req.method()} ${req.url()}`, req.postData()?.slice(0, 300));
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/onboarding/")) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        body = "<unreadable>";
      }
      console.log(`[response] ${res.request().method()} ${res.url()} -> ${res.status()}`);
      console.log(body.slice(0, 400));
    }
  });
  page.on("requestfailed", (req) => {
    if (req.url().includes("/api/onboarding/")) console.log("[request FAILED]", req.method(), req.url(), req.failure());
  });

  console.log("=== Signing in ===");
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', "doe@gmail.com");
  await page.fill('input[type="password"]', "diagnostic-reset-pw-123!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/zestil/, { timeout: 15000 });
  console.log("Landed on:", page.url());

  console.log("\n=== Navigating to /onboarding ===");
  await page.goto(`${BASE}/onboarding`);
  await page.waitForTimeout(1500);

  async function dumpScreen(label) {
    const heading = await page.locator("h1").first().textContent().catch(() => "<no h1>");
    console.log(`\n=== ${label} === heading: "${heading}"`);
  }

  // Advances through ONE node fully: repeatedly clicks "Yes" for a swipe deck until Continue
  // appears, or clicks the first option for single/multi-select, or clicks the primary button
  // directly for system/consent screens. Returns once it has clicked something that should
  // move the flow forward (Continue / an auto-advancing single_select option).
  async function advanceOneNode(label) {
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(400);
      const continueBtn = page.getByRole("button", { name: /^continue$|get started|i agree|let's start planning|looks right/i });
      const continueCount = await continueBtn.count();
      if (continueCount) {
        const el = continueBtn.first();
        const html = await el.evaluate((n) => n.outerHTML);
        const disabled = await el.isDisabled();
        console.log(`[${label}] found ${continueCount} continue-style button(s); clicking iteration ${i}; disabled=${disabled}; html=${html}`);
        await el.click();
        await page.waitForTimeout(1200);
        return;
      }
      const yesBtn = page.getByRole("button", { name: /^✓ Yes$/ });
      if (await yesBtn.count()) {
        console.log(`[${label}] swipe deck: clicking Yes (iteration ${i})`);
        await yesBtn.first().click();
        continue;
      }
      const anyOption = page.locator("button").filter({ hasNotText: /skip|back|no,|✕/i });
      const n = await anyOption.count();
      if (n > 0) {
        console.log(`[${label}] clicking first of ${n} option buttons (iteration ${i})`);
        await anyOption.first().click();
        await page.waitForTimeout(800);
        return;
      }
      console.log(`[${label}] no actionable button found (iteration ${i}) — stopping`);
      return;
    }
    console.log(`[${label}] gave up after 15 iterations`);
  }

  await dumpScreen("Initial state (resume)");

  for (let step = 1; step <= 70; step++) {
    const doneCheck = await page.locator("text=You're all set").count();
    if (doneCheck) {
      console.log(`[step ${step}] reached the completion screen — stopping`);
      break;
    }
    await advanceOneNode(`step ${step}`);
    await dumpScreen(`After step ${step}`);
  }
  await page.screenshot({ path: "/tmp/onboarding-repro-final.png" });
  console.log("\nScreenshot saved to /tmp/onboarding-repro-final.png");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
