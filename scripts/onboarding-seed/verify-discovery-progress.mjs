// The last onboarding screen: recipe-discovery progress, replacing "You're all set".
//
// The poll is stubbed and scripted through a whole run — nothing yet -> part-done -> complete —
// because a real run takes minutes (measured 3-7) and never shows the in-flight states twice the
// same way. Shapes are copied from doe@gmail.com's own memory_json.onboarding, plus the failure
// shape the owner supplied: a per-item "failed" carrying its own `error` string, sitting
// alongside an overall "recipe_discovery_complete".
import { openOnboarding, walkTo, makeCheck, headingOf, BASE } from "./_walk.mjs";

const PIZZA = {
  name: "pizza", status: "complete", found: 17, saved: 2, accepted: 2, rejected: 15,
  recipes: [{ uuid: "a", title: "Cauliflower Crust Pizza", saved: true },
            { uuid: "b", title: "Polenta Pizza with Roasted Vegetables", saved: true }],
};

const ITEMS_RUNNING = [
  PIZZA,
  { name: "pasta carbonara", status: "in progress", found: 3 },
  { name: "risotto", status: "waiting" },
  // A request that completes having saved nothing — real on doe's earlier runs (Grilled Chicken:
  // found 9, rejected 8, no `saved`/`recipes` at all).
  { name: "Grilled Chicken", status: "complete", found: 9, rejected: 8 },
  { name: "More recipes for you", type: "fill", status: "waiting" },
];

const ITEMS_DONE = [
  PIZZA,
  { name: "pasta carbonara", status: "complete", found: 3, saved: 2, accepted: 2, rejected: 1,
    recipes: [{ uuid: "c", title: "Creamy Zucchini Carbonara", saved: true },
              { uuid: "d", title: "Creamy Polenta with Roasted Vegetables and Poached Egg", saved: true }] },
  { name: "risotto", status: "failed", error: "Explore failed: The operation was aborted due to timeout",
    found: 6, rejected: 6 },
  { name: "Grilled Chicken", status: "complete", found: 9, rejected: 8 },
  { name: "More recipes for you", type: "fill", status: "complete", found: 6, saved: 1, accepted: 1, rejected: 5,
    recipes: [{ uuid: "e", title: "Italian Zucchini Pizza Bites", saved: true }] },
];

// One response per STAGE, advanced explicitly by the test. Keyed on a stage rather than a poll
// count so an extra poll — a reload remounts and polls immediately — can't skip a stage.
const STAGES = [
  { onboarding: null },
  { onboarding: { recipe_discovery_run: "2026-10-06T07:05:13.575Z",
                  status: [{ time: "2026-10-06T07:05:13.575Z", current: "recipe_discovery_started" }],
                  recipe_discovery: ITEMS_RUNNING } },
  { onboarding: { recipe_discovery_run: "2026-10-06T07:05:13.575Z",
                  // Deliberately out of order: currentStatus sorts by time, it does not trust position.
                  status: [{ time: "2026-10-06T07:08:11.509Z", current: "recipe_discovery_complete" },
                           { time: "2026-10-06T07:05:13.575Z", current: "recipe_discovery_started" }],
                  recipe_discovery: ITEMS_DONE } },
];

let polls = 0;
let stage = 0;
const { browser, page } = await openOnboarding({
  route: async (context) => {
    await context.route(/\/api\/onboarding\/discovery/, async (route) => {
      polls++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STAGES[stage]) });
    });
  },
});

/** Advance the stub and wait for the screen to pick it up on its next 10s poll. */
async function advanceTo(next) {
  stage = next;
  await page.waitForTimeout(11000);
}
const { check, finish } = makeCheck();

const icons = async (label) => page.locator(`[aria-label="${label}"]`).count();
const continueBtn = () => page.getByRole("button", { name: /^continue to plan$/i });

// Walk to the very end. The summary agent is allowed to fail — SummaryScreen degrades and still
// offers its CTA, which is what carries us into n_compile and then this screen.
await walkTo(page, /finding recipes you.ll like/i, { max: 40 });

console.log("\n=== nothing reported yet ===");
console.log("  heading:", await headingOf(page));
check("the discovery screen replaced 'You're all set'", /finding recipes you.ll like/i.test(await headingOf(page)));
check("it says it's getting started", await page.getByText(/getting started/i).isVisible().catch(() => false));
check("Continue to plan is disabled", await continueBtn().isDisabled());
check("no escape hatch this early", (await page.getByRole("button", { name: /continue without waiting/i }).count()) === 0);

// A refresh here used to drop the user at the very start of onboarding: commitUserMemory
// clears flow_position, so a committed account looked identical to a brand-new one. This screen
// asks the user to wait minutes, which makes a mid-wait reload ordinary rather than exotic.
console.log("\n=== reload mid-wait ===");
await page.reload();
await page.waitForTimeout(2500);
console.log("  heading:", await headingOf(page));
check("a reload stays on the discovery screen", /finding recipes you.ll like/i.test(await headingOf(page)), await headingOf(page));
check("it does not restart onboarding", !/a few quick questions/i.test(await page.locator("body").innerText()));

console.log("\n=== mid-run ===");
await advanceTo(1);
const names = (await page.locator("li").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
console.log("  rows:", JSON.stringify(names.slice(0, 4)));
check("every dish is listed", ["pizza", "pasta carbonara", "risotto", "More recipes for you"].every((n) => names.some((t) => t.includes(n))));
check("an in-flight request shows a spinner", (await icons("in progress")) === 1, `running=${await icons("in progress")}`);
check("queued requests show the waiting marker", (await icons("waiting")) === 2, `waiting=${await icons("waiting")}`);
// The tick belongs to the RECIPE, not the request: pizza completed with two saved dishes, so
// exactly two ticks — not three, which is what marking the request as well would produce.
check("each saved recipe carries its own tick", (await icons("saved")) === 2, `saved=${await icons("saved")}`);
check("a completed request carries no tick of its own", (await icons("done")) === 0, `done=${await icons("done")}`);
check("a request that completed with nothing says so", await page.getByText(/no matches saved for this one/i).isVisible().catch(() => false));
check("the spinner actually spins", (await page.locator('[aria-label="in progress"] .animate-spin').count()) >= 1);
check("found/saved counts render", await page.getByText(/17 found · 2 saved/).isVisible().catch(() => false));
check("titles of what was saved render", await page.getByText(/Cauliflower Crust Pizza/).isVisible().catch(() => false));
check("Continue is still disabled mid-run", await continueBtn().isDisabled());
await page.screenshot({ path: "/tmp/discovery-running.png", fullPage: true });

check("no escape hatch while the run is reporting progress",
  (await page.getByRole("button", { name: /continue without waiting/i }).count()) === 0);

console.log("\n=== complete ===");
await advanceTo(2);
console.log("  heading:", await headingOf(page));
check("the heading switches to ready", /your recipes are ready/i.test(await headingOf(page)), await headingOf(page));
check("Continue to plan is now enabled", await continueBtn().isEnabled());
check("the failed request shows a red cross", (await icons("failed")) === 1, `failed=${await icons("failed")}`);
check("and the job's own error text, not copy we invented",
  await page.getByText(/Explore failed: The operation was aborted due to timeout/).isVisible().catch(() => false));
check("the overall run still reads as complete despite that failure", /your recipes are ready/i.test(await headingOf(page)));
check("the fill bucket's titles populate", await page.getByText(/Italian Zucchini Pizza Bites/).isVisible().catch(() => false));
// 2 pizza + 2 carbonara + 1 fill = 5 saved recipes; risotto failed and Grilled Chicken saved none.
check("one tick per saved recipe, across every request", (await icons("saved")) === 5, `saved=${await icons("saved")}`);
check("no spinners left", (await icons("in progress")) === 0);
check("nothing is left waiting", (await icons("waiting")) === 0);
await page.screenshot({ path: "/tmp/discovery-complete.png", fullPage: true });

const pollsAtComplete = polls;
console.log("\n=== polling stops, then auto-continues ===");
await page.waitForTimeout(12000);
check("polling stopped once the run finished", polls === pollsAtComplete, `${pollsAtComplete} -> ${polls}`);

await page.waitForURL(/\/zestil/, { timeout: 20000 }).catch(() => {});
check("it auto-continues to the app ~15s after completing", /\/zestil/.test(page.url()), page.url());
console.log("  landed on:", page.url().replace(BASE, ""));

await finish(browser);
