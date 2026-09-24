// Isolates the FRONTEND from the agent: intercepts /api/onboarding/validate-other and returns a
// canned `invalid` result, proving the UI blocks the override regardless of what the agent does.
import { chromium } from "playwright";
const BASE = "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.route(/\/api\/onboarding\/validate-other/, async (route) => {
  console.log("[intercepted] forcing verdict=invalid");
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      results: [{ entry: "window", verdict: "invalid", value: "window", label: "Window",
                  reason: "A window isn't typically an allergen. What are you actually allergic to?" }],
    }),
  });
});

await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', "doe@gmail.com");
await page.fill('input[type="password"]', "diagnostic-reset-pw-123!");
await page.click('button[type="submit"]');
await page.waitForURL(/zestil/, { timeout: 15000 });
await page.goto(`${BASE}/onboarding`);
await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 15000 });
await page.waitForTimeout(500);

async function submitAndWait(name) {
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
  await page.getByRole("button", { name, exact: true }).click();
  await p; await page.waitForTimeout(400);
}
async function skipAndWait() {
  const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
  await page.getByRole("button", { name: /^skip$/i }).first().click();
  await p; await page.waitForTimeout(400);
}
await submitAndWait(/^get started$/i);
await submitAndWait(/^i agree$/i);
await skipAndWait(); await skipAndWait(); await skipAndWait(); await skipAndWait();

await page.getByRole("button", { name: "Other", exact: true }).click();
await page.waitForTimeout(300);
await page.fill('input[placeholder="Type here…"]', "window");
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(4000);

console.log("Heading:", (await page.locator("h1").first().textContent())?.slice(0, 45));
console.log("Banner:", JSON.stringify((await page.locator("p").allTextContents()).filter((t) => t.length > 20)));
console.log("'continue anyway' present:", (await page.getByRole("button", { name: /continue anyway/i }).count()) > 0, "(expect FALSE)");
await page.screenshot({ path: "/tmp/forced-invalid.png" });
await browser.close();
