// n_pairing_cards: one screen per sampled dish, two questions on each ("goes well" /
// "never pair"), and NO whole-sequence Skip — declining a specific dish is a bare Continue with
// nothing checked, which is a real answer, not a bail-out.
import { openOnboarding, walkTo, makeCheck, click, tap, headingOf } from "./_walk.mjs";

const onPairingScreen = async (p) => (await p.getByText(/goes well with/i).count()) > 0;

const { browser, page } = await openOnboarding();
const { check, finish } = makeCheck();

// The sample is drawn from taste_profile.cuisines, so a region has to be picked or this node
// has nothing to show and is bypassed entirely.
await walkTo(page, onPairingScreen, {
  answers: [[/cuisines do you gravitate/i, async (p) => { await tap(p, "Asia/Pacific"); await click(p, /^continue$/i); }]],
});

console.log("\n=== n_pairing_cards, dish #1 ===");
const dish = await headingOf(page);
console.log("  dish:", dish);

const questions = (await page.locator("p").allTextContents()).filter((t) => /goes well|never pair/i.test(t));
console.log("  questions:", JSON.stringify(questions));
check("both questions render", questions.length === 2, JSON.stringify(questions));
check("the heading is the dish itself, not a slug", dish.length > 0 && !dish.includes("_"), dish);

const labels = (await page.locator("button").allTextContents()).map((t) => t.trim()).filter(Boolean);
check("no Skip — there is no one-tap bail on the sequence", !labels.some((t) => /^skip$/i.test(t)), JSON.stringify(labels));

const sides = labels.filter((t) => !/^(← back|continue)$/i.test(t));
check("both questions offer the dish's 4 curated sides", sides.length === 8, `${sides.length} side buttons`);
await page.screenshot({ path: "/tmp/pairing-dish1.png" });

// An opinion on one side in each direction.
await tap(page, sides[0]);
await tap(page, sides[4]);
await page.screenshot({ path: "/tmp/pairing-dish1-selected.png" });
await click(page, /^continue$/i);

const second = await headingOf(page);
console.log("\n=== next screen ===");
console.log("  heading:", second);
check("advances to another dish in the sample", await onPairingScreen(page), second);
check("it's a different dish", second !== dish, `${dish} -> ${second}`);

// No opinion at all is still a valid answer.
await click(page, /^continue$/i);
check("a bare Continue with nothing checked is accepted", (await headingOf(page)).length > 0);
await page.screenshot({ path: "/tmp/pairing-after-empty.png" });

await finish(browser);
