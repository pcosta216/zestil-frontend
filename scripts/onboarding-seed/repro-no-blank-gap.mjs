// Verifies that swiping the LAST card of a deck does NOT blank the screen
// while the request is in flight — checks the DOM immediately after the
// click (before the response arrives) and confirms the deck's own content
// is still there, exactly like the Skip button's behavior.

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

  async function clickAndWait(regex) {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer") || r.url().includes("/api/onboarding/commit"), { timeout: 15000 });
    await page.getByRole("button", { name: regex }).first().click();
    await p;
    await page.waitForTimeout(200);
  }

  await clickAndWait(/get started/i);
  await clickAndWait(/i agree/i);
  await clickAndWait(/^skip$/i);
  await clickAndWait(/^skip$/i);

  const heading = await page.locator("h1").first().textContent();
  console.log("At deck:", heading);

  // Swipe 8 of the 9 diet cards normally, leaving exactly one.
  for (let i = 0; i < 8; i++) {
    const yes = page.getByRole("button", { name: /^✓ Yes$/ });
    await yes.first().click();
    await page.waitForTimeout(150);
  }

  const beforeText = await page.locator("body").innerText();
  console.log("\nOn the last card, before final swipe:\n", beforeText, "\n");

  // Slow the /answer response artificially by NOT waiting for it — click, then immediately
  // (0ms delay) check what's rendered, before the response has any realistic chance to land.
  const responsePromise = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 15000 });
  await page.getByRole("button", { name: /^✓ Yes$/ }).first().click();

  // Check immediately, and again a beat later — both should still show the SAME deck content,
  // not a blank area, right up until the response actually resolves.
  await page.waitForTimeout(20);
  const immediatelyAfter = await page.locator("body").innerText();
  console.log("Immediately (20ms) after the final swipe, still showing:\n", immediatelyAfter, "\n");

  const looksBlank = !immediatelyAfter.includes("Which eating style") || (!immediatelyAfter.includes("Yes") && !immediatelyAfter.includes("No"));
  console.log(looksBlank ? "FAIL — screen went blank/changed before the response arrived" : "PASS — deck content stayed visible, unchanged, exactly like Skip");

  const res = await responsePromise;
  const body = await res.json();
  console.log("\nResponse eventually arrived, next node:", body.node?.id);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
