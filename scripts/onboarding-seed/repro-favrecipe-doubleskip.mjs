import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone 12/13-ish
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  let answerCount = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/onboarding/answer")) {
      answerCount++;
      console.log(`[request #${answerCount}] ${req.postData()?.slice(0, 150)}`);
    }
  });

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

  const heading1 = await page.locator("h1").first().textContent();
  console.log("\nAt n_favorite_recipes. Heading:", heading1);

  page.on("response", async (res) => {
    if (res.url().includes("/api/onboarding/answer")) {
      const body = await res.json().catch(() => null);
      console.log(`[response] status=${res.status()} next=${body?.node?.id}`);
    }
  });

  console.log("\n=== IMPATIENT RE-CLICK on Skip's old position, fired well AFTER the new screen mounts ===");
  const skipBtn = page.getByRole("button", { name: /skip/i }).first();
  const box = await skipBtn.boundingBox();
  console.log("skip button box:", box);
  const clickX = box.x + box.width / 2;
  const clickY = box.y + box.height / 2;

  const t0 = Date.now();
  await page.mouse.click(clickX, clickY);
  console.log(`click #1 at t=${Date.now() - t0}ms`);

  // Wait for the real transition to complete (poll heading change), then compare where the
  // NEW screen's own primary button sits vs the old Skip coordinates.
  await page.waitForFunction(
    (oldText) => document.querySelector("h1")?.textContent !== oldText,
    heading1,
    { timeout: 10000 }
  );
  const transitionedAt = Date.now() - t0;
  console.log(`node transitioned at t=${transitionedAt}ms, new heading:`, await page.locator("h1").first().textContent());

  const newPrimary = page.getByRole("button", { name: /^continue$/i }).first();
  const newBox = await newPrimary.boundingBox().catch(() => null);
  console.log("new screen's Continue button box:", newBox, " (old skip box was", box, ")");

  // Now wait past the 300ms phantom-click guard (measured from transition time), then click
  // again at the OLD coordinates — simulating a user re-clicking a spot they think is unresponsive.
  const msSinceTransition = Date.now() - t0 - transitionedAt;
  const extraWait = Math.max(0, 600 - msSinceTransition);
  await page.waitForTimeout(extraWait);
  console.log(`clicking #2 at old coords, t=${Date.now() - t0}ms (${Date.now() - t0 - transitionedAt}ms after transition)`);
  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(1500);
  console.log("Heading after re-click:", await page.locator("h1").first().textContent());

  console.log("\nTotal /answer requests:", answerCount);
  await page.screenshot({ path: "/tmp/favrecipe-doubleskip-result.png" });
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
