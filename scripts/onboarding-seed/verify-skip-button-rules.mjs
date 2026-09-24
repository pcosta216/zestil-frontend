// The exclusion decks' skip button ("I can eat everything") follows what's actually selectable:
//
//   1. vegan + soy + gluten -> protein screen has 1 selectable option -> the skip is rendered but
//      DISABLED. Claiming "I can eat everything" would contradict what the user just told us.
//   2. keto alone -> carb screen has 0 selectable (all 8 excluded) -> no skip at all, and the
//      free-text alternative opens instead, because there is nothing left to say yes to.
//
// Two passes, each from a fresh account: the filters are driven by what was answered earlier.
import { openOnboarding, walkTo, makeCheck, click, tap, headingOf } from "./_walk.mjs";

const { check, finish } = makeCheck();
const labelsOn = async (page) => (await page.locator("button").allTextContents()).map((t) => t.trim()).filter(Boolean);

async function partiallyFiltered() {
  console.log("\n=== 1: vegan + soy + gluten -> protein screen, 1 selectable ===");
  const { browser, page } = await openOnboarding();
  await walkTo(page, /proteins you'd never eat/i, {
    answers: [
      [/eating style best describes you/i, async (p) => { await tap(p, "Vegan"); await click(p, /^continue$/i); }],
      [/allergies we should treat/i, async (p) => { await tap(p, "Soy"); await tap(p, "Gluten"); await click(p, /^continue$/i); }],
    ],
  });
  console.log("  heading:", await headingOf(page));

  const skip = page.getByRole("button", { name: "I can eat everything" });
  check("the skip is still rendered", (await skip.count()) > 0);
  check("...but disabled — it would contradict the allergies just given", await skip.isDisabled());
  await page.screenshot({ path: "/tmp/skip-rules-partial.png" });
  await browser.close();
}

async function zeroRemaining() {
  console.log("\n=== 2: keto -> carb screen, 0 selectable ===");
  const { browser, page } = await openOnboarding();
  // The target is the ALTERNATIVE heading, not the node's normal prompt: once every option is
  // excluded, MultiSelect swaps the question for "none of these fit" and opens the free-text box.
  await walkTo(page, /none of our usual carb sources fit/i, {
    answers: [
      [/eating style best describes you/i, async (p) => { await tap(p, "Keto"); await click(p, /^continue$/i); }],
      // The protein screen comes first and keto leaves 9 selectable there — accept its
      // select_all_by_default state and move on.
      [/proteins you'd never eat/i, async (p) => { await click(p, /^continue$/i); }],
    ],
  });
  console.log("  heading:", await headingOf(page));

  const labels = await labelsOn(page);
  console.log("  buttons:", JSON.stringify(labels));
  check(
    "no skip-like escape hatch when nothing is selectable",
    !labels.some((t) => /skip|i can eat everything|i don't have an alternative/i.test(t)),
    JSON.stringify(labels)
  );
  check(
    "the exclusion disclaimer explains the greying",
    await page.getByText(/greyed-out options don't fit/i).isVisible().catch(() => false)
  );
  check(
    "the free-text alternative opens instead",
    await page.getByText(/what carb sources work for you/i).isVisible().catch(() => false)
  );
  await page.screenshot({ path: "/tmp/skip-rules-zero.png", fullPage: true });
  await browser.close();
}

const which = process.argv[2]; // "1" | "2" | omitted for both
if (which !== "2") await partiallyFiltered();
if (which !== "1") await zeroRemaining();
await finish();
