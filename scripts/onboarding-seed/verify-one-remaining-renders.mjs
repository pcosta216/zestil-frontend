// vegan + soy + gluten leaves exactly 1 selectable protein option (lentils_legumes).
// That screen must still RENDER — it used to auto-skip whenever the filtered list got thin,
// which hid from the user both the one option they had and the reason the rest were gone.
import { openOnboarding, walkTo, makeCheck, click, tap } from "./_walk.mjs";

const { browser, page } = await openOnboarding();
const { check, finish } = makeCheck();

await walkTo(page, /proteins you'd never eat/i, {
  answers: [
    [/eating style best describes you/i, async (p) => { await tap(p, "Vegan"); await click(p, /^continue$/i); }],
    [/allergies we should treat/i, async (p) => { await tap(p, "Soy"); await tap(p, "Gluten"); await click(p, /^continue$/i); }],
  ],
});

console.log("\n=== n_protein_exclusion_cards ===");
const labels = (await page.locator("button").allTextContents()).map((t) => t.trim()).filter(Boolean);
console.log("  buttons:", JSON.stringify(labels));

// Classified by accessible name rather than by locator filtering — the screen's controls
// (Back / Continue / the skip) have to be told apart from the option tiles, and naming them
// explicitly is the only way that stays true when a tile's copy changes.
const CONTROLS = /^(← back|continue|i can eat everything)$/i;
const selectable = [];
const greyed = [];
for (const btn of await page.locator("button").all()) {
  const text = ((await btn.textContent()) ?? "").trim();
  if (!text || CONTROLS.test(text)) continue;
  ((await btn.isDisabled()) ? greyed : selectable).push(text);
}
console.log("  selectable:", JSON.stringify(selectable));
console.log("  greyed:    ", JSON.stringify(greyed));
const enabled = selectable.length;
const disabled = greyed.length;

check("the screen renders instead of auto-skipping", /proteins you'd never eat/i.test((await page.locator("h1").first().textContent()) ?? ""));
check("exactly one option is still selectable", enabled === 1, `enabled=${enabled}`);
check("the excluded options stay visible, greyed rather than removed", disabled >= 7, `disabled=${disabled}`);
check(
  "the disclaimer explains why they're greyed",
  await page.getByText(/greyed-out options don't fit/i).isVisible().catch(() => false)
);

// ...and names the specific answer behind each greying. The disclaimer alone can only list the
// three KINDS of answer that filter this screen, which is how a greying gets blamed on the wrong
// one (a Vegan pick took the blame for a lactose intolerance once).
const attribution = (await page.locator("li").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
console.log("  attribution:", JSON.stringify(attribution));
check("the diet that ruled options out is named", attribution.some((t) => /^Vegan diet:/.test(t)), JSON.stringify(attribution));
check("each allergy is named too", ["Soy allergy:", "Gluten allergy:"].every((c) => attribution.some((t) => t.startsWith(c))), JSON.stringify(attribution));
check(
  "a named cause lists the tiles it greyed",
  attribution.every((t) => /: .+/.test(t)),
  JSON.stringify(attribution)
);

await page.screenshot({ path: "/tmp/one-remaining-renders.png", fullPage: true });
await finish(browser);
