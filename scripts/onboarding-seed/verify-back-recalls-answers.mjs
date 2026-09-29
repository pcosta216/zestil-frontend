// Going back used to land on a blank screen: the node's writes are reverted on the way in (by
// design — see engine.ts's goBack), so nothing showed what had been chosen, and a typed-in
// "Other" entry was impossible to see, let alone take back. Both routes into an already-answered
// screen are covered here: the Back button, and n_allergy_confirm's "something's missing or
// wrong" rewind (which is the same problem with a different door).
import { openOnboarding, walkTo, makeCheck, click, tap, headingOf, BASE } from "./_walk.mjs";

let validatorCalls = 0;

// Stubbed so this stays a test of recall, not of the validator agent. Everything typed comes
// back valid with a capitalized label — deliberately DIFFERENT from the raw text, so the
// recalled row proves it renders the agent's label rather than echoing the input box.
const { browser, page } = await openOnboarding({
  route: async (context) => {
    await context.route(/\/api\/onboarding\/validate-other/, async (route) => {
      validatorCalls++;
      const body = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: (body.entries ?? []).map((entry) => ({
            entry,
            verdict: "valid",
            value: null,
            label: entry.charAt(0).toUpperCase() + entry.slice(1),
            reason: null,
          })),
        }),
      });
    });
  },
});
const { check, finish } = makeCheck();

/** The Back button — a different round trip from click()'s /answer one. */
async function back(page) {
  const res = page.waitForResponse((r) => r.url().includes("/api/onboarding/back"), { timeout: 30000 });
  await page.getByRole("button", { name: /back/i }).click();
  await res;
  await page.waitForTimeout(450);
}

const isSelected = (page, name) =>
  page.getByRole("button", { name, exact: true }).evaluate((el) => el.className.includes("green-light"));

// --- 1. single_select: the earlier pick comes back highlighted ------------------------------
await walkTo(page, /mainly optimizing for/i);
await tap(page, "Build muscle / strength");
await click(page, /^continue$/i);

console.log("\n=== Back onto n_goal ===");
await back(page);
check("Back lands on the goal screen", /mainly optimizing for/i.test(await headingOf(page)), await headingOf(page));
check("the pick that was made is selected again", await isSelected(page, "Build muscle / strength"));
check("a pick that was NOT made stays unselected", !(await isSelected(page, "Lose weight / lean out")));

// --- 2. multi_select + a typed "Other" entry -------------------------------------------------
await click(page, /^continue$/i); // re-submit the same goal, forward to allergies
await walkTo(page, /allergies we should treat/i);
await tap(page, "Nuts");
await tap(page, "Other");
await page.locator('input[placeholder="Type here…"]').fill("pumpkin");
await click(page, /^continue$/i);
check("the validator stub actually fired", validatorCalls === 1, `calls=${validatorCalls}`);

const recap = async () => ((await page.locator("h1").locator("..").textContent()) ?? "") + ((await page.locator("p").allTextContents()).join(" | "));
check("the confirm gate recaps both answers", /nuts/i.test(await recap()) && /pumpkin/i.test(await recap()));

// The rewind door: "Something's missing or wrong" re-enters n_allergies the same way Back does.
console.log("\n=== confirm_edit rewind onto n_allergies ===");
await click(page, /something.s missing or wrong/i);
check("the rewind lands on the allergies screen", /allergies we should treat/i.test(await headingOf(page)), await headingOf(page));
check("the tapped allergy is selected again", await isSelected(page, "Nuts"));
check("an untapped one is still unselected", !(await isSelected(page, "Gluten")));
check("the Other tile is selected, so the free-text field is open", await isSelected(page, "Other"));

const typedRow = page.locator("div").filter({ hasText: /^Pumpkin\s*Remove$/ }).last();
check("the typed entry is listed, under the agent's label", await typedRow.isVisible().catch(() => false));
check(
  "the input box is empty — the entry is settled, not back to being retyped",
  (await page.locator('input[placeholder="Type here…"]').inputValue()) === ""
);

await page.screenshot({ path: "/tmp/back-recalls-answers.png", fullPage: true });

// --- 3. removing a recalled entry actually drops it ------------------------------------------
await typedRow.getByRole("button", { name: /^remove$/i }).click();
await page.waitForTimeout(250);
check("removing the row takes it off screen", !(await typedRow.isVisible().catch(() => false)));

await click(page, /^continue$/i);
check("the confirm gate no longer recaps the removed entry", !/pumpkin/i.test(await recap()), await recap());
check("and still recaps the one that was kept", /nuts/i.test(await recap()));
check("no second validator call — a recalled entry is already settled", validatorCalls === 1, `calls=${validatorCalls}`);

// --- 4. Back through the confirm gate lands on the corrected answer, not the original ---------
console.log("\n=== Back from n_intolerances (skips the confirm gate) ===");
await click(page, "Looks right");
await back(page);
check("Back skips the confirm gate and lands on allergies", /allergies we should treat/i.test(await headingOf(page)), await headingOf(page));
check("the kept allergy is still selected", await isSelected(page, "Nuts"));
check(
  "the removed entry does not come back",
  !(await page.getByText("Pumpkin", { exact: true }).isVisible().catch(() => false))
);

// --- 5. a reload right after Back keeps the recall (it lives on the open history entry) -------
await page.goto(`${BASE}/onboarding`);
await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 20000 });
await page.waitForTimeout(700);
check("reload lands back on the same screen", /allergies we should treat/i.test(await headingOf(page)), await headingOf(page));
check("and the selection survived the reload", await isSelected(page, "Nuts"));

// --- 6. a repeat_for screen: Back must restore THAT iteration's answer --------------------
// n_pairing_cards repeats per sampled dish and holds two independent groups sharing the same
// four side labels, so the answer is only identifiable by (node, item) and by group position —
// the case where echoing back the wrong entry would be least visible.
console.log("\n=== Back onto a repeat_for iteration ===");
await walkTo(page, async (p) => (await p.getByText(/goes well with/i).count()) > 0, {
  // The sample is drawn from taste_profile.cuisines — without a region there's no pool and the
  // whole node is bypassed.
  answers: [[/cuisines do you gravitate/i, async (p) => { await tap(p, "Asia/Pacific"); await click(p, /^continue$/i); }]],
});

/** The side tiles in DOM order: four for "goes well", then four for "never pair". */
async function sideTiles() {
  const out = [];
  for (const b of await page.locator("button").all()) {
    const text = ((await b.textContent()) ?? "").trim();
    if (!text || /^(← back|continue)$/i.test(text)) continue;
    out.push({ button: b, text });
  }
  return out;
}
const dish = await headingOf(page);
const before = await sideTiles();
console.log(`  dish: ${dish} — ${before.length} side tiles`);
await before[0].button.click(); // one "goes well"
await before[5].button.click(); // a different side, "never pair"
await page.waitForTimeout(200);
await click(page, /^continue$/i);
check("advanced to the next dish", (await headingOf(page)) !== dish, await headingOf(page));

await back(page);
check("Back returns to the same dish, not a re-sampled one", (await headingOf(page)) === dish, await headingOf(page));
const after = await sideTiles();
const selectedNow = await Promise.all(after.map((t) => t.button.evaluate((el) => el.className.includes("green-light"))));
console.log("  restored:", JSON.stringify(after.filter((_, i) => selectedNow[i]).map((t) => t.text)));
check("the 'goes well' side is checked again", selectedNow[0] === true);
check("the 'never pair' side is checked again, in its own group", selectedNow[5] === true);
check("and nothing else got checked", selectedNow.filter(Boolean).length === 2, JSON.stringify(selectedNow));

await finish(browser);
