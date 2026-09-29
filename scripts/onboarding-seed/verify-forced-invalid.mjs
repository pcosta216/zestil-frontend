// Isolates the FRONTEND from the agent: intercepts /api/onboarding/validate-other and returns a
// canned `invalid` result, proving the UI blocks the override regardless of what the agent does.
import { openOnboarding, walkTo, makeCheck, tap, headingOf } from "./_walk.mjs";

let intercepted = 0;

const { browser, page } = await openOnboarding({
  // context.route, not page.route: page-level routes are dropped across navigations, and
  // signIn() navigates twice — a page-level stub here never fired, so this script was silently
  // testing the live agent instead of the canned verdict.
  route: async (context) => {
    await context.route(/\/api\/onboarding\/validate-other/, async (route) => {
      intercepted++;
      console.log("[intercepted] forcing verdict=invalid");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              entry: "window",
              verdict: "invalid",
              value: "window",
              label: "Window",
              reason: "A window isn't typically an allergen. What are you actually allergic to?",
            },
          ],
        }),
      });
    });
  },
});
const { check, finish } = makeCheck();

await walkTo(page, /allergies we should treat/i);
await tap(page, "Other");
await page.fill('input[placeholder="Type here…"]', "window");
await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(4000);

console.log("\nHeading:", (await headingOf(page)).slice(0, 45));
const copy = (await page.locator("p").allTextContents()).filter((t) => t.length > 20);
console.log("Banner:", JSON.stringify(copy));

check("the stub actually fired", intercepted === 1, `intercepted=${intercepted}`);
check("the flow stayed on the allergies screen", /allergies we should treat/i.test(await headingOf(page)), await headingOf(page));
check("the agent's own reason is shown", copy.some((t) => /isn't typically an allergen/i.test(t)), JSON.stringify(copy));
check("no override affordance for an `invalid` verdict", (await page.getByRole("button", { name: /continue anyway/i }).count()) === 0);
check("Continue stays blocked until the entry is resolved", await page.getByRole("button", { name: /^continue$/i }).isDisabled());

await page.screenshot({ path: "/tmp/forced-invalid.png" });
await finish(browser);
