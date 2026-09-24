import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("response", async (res) => {
  if (res.url().includes("/api/onboarding/validate-other")) {
    console.log(`[validate-other] ${JSON.stringify(await res.json().catch(() => null))}`);
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

console.log("\n=== n_allergies: typing 'window' ===");
await page.getByRole("button", { name: "Other", exact: true }).click();
await page.waitForTimeout(300);
await page.fill('input[placeholder="Type here…"]', "window");
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(10000);

console.log("Heading:", (await page.locator("h1").first().textContent())?.slice(0, 45));
const banners = (await page.locator("p").allTextContents()).filter((t) => t.length > 20);
console.log("Banner(s):", JSON.stringify(banners));
const override = page.getByRole("button", { name: /continue anyway/i });
console.log("'continue anyway' present:", (await override.count()) > 0, "(expect false)");
await page.screenshot({ path: "/tmp/window-invalid.png" });
await browser.close();
