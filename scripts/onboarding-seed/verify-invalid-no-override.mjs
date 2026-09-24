// An entry the agent marks `invalid` shows the error but offers NO "continue anyway" override —
// only a `flag` is confirmable. Driven through n_dishes with "Italian" typed as a DISH under the
// Italian deck, which the live agent returns as invalid ("that's a cuisine, not a dish").
//
// Hits the real agent on purpose: the point is that a genuine `invalid` verdict is unconfirmable,
// and a stub would only prove the component trusts its own fixture.
import { openOnboarding, walkTo, makeCheck, click, tap, headingOf } from "./_walk.mjs";

const { browser, page } = await openOnboarding();
const { check, finish } = makeCheck();
page.on("response", async (res) => {
  if (res.url().includes("/api/onboarding/validate-other")) {
    console.log(`[validate-other] ${res.status()} ${JSON.stringify(await res.json().catch(() => null))}`);
  }
});

await walkTo(page, /dishes from italian/i, {
  answers: [
    [/cuisines do you gravitate/i, async (p) => { await tap(p, "Europe"); await click(p, /^continue$/i); }],
    [/within .*, anything specific/i, async (p) => { await tap(p, "Italian"); await click(p, /^continue$/i); }],
  ],
});

console.log("\n=== n_dishes[italian_cuisine] ===");
console.log("heading:", (await headingOf(page)).slice(0, 60));

await tap(page, "Other");
await page.fill('input[placeholder="Type here…"]', "Italian");
await page.waitForTimeout(300);
console.log("  typed 'Italian' as a dish (expect: invalid, unconfirmable)");

await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForResponse((r) => r.url().includes("/api/onboarding/validate-other"), { timeout: 30000 });
await page.waitForTimeout(1500);

check("stays on the dishes screen", /dishes from italian/i.test(await headingOf(page)), await headingOf(page));
const banners = (await page.locator("p").allTextContents()).filter((t) => t.length > 15);
console.log("  on-screen copy:", JSON.stringify(banners));
check("an explanation is shown", banners.length > 0);
check(
  "no 'continue anyway' override for an invalid entry",
  (await page.getByRole("button", { name: /continue anyway/i }).count()) === 0
);

await page.screenshot({ path: "/tmp/invalid-no-override.png" });
await finish(browser);
