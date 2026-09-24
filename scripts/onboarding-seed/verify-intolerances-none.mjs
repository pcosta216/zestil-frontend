// n_intolerances: "I don't have any" is a real exclusive option, not a Skip button.
// Picking it disables every other tile (Other included); deselecting re-enables them.
import { openOnboarding, walkTo, makeCheck, tap } from "./_walk.mjs";

const { browser, page } = await openOnboarding();
const { check, finish } = makeCheck();

await walkTo(page, /tolerate a little of/i);

console.log("\n=== n_intolerances ===");
console.log("heading:", (await page.locator("h1").first().textContent())?.trim()?.slice(0, 60));

const labels = await page.locator("button").allTextContents();
check("no Skip button — the option list covers 'none'", !labels.some((t) => t.trim().toLowerCase() === "skip"), JSON.stringify(labels));

await tap(page, "I don't have any");
await page.screenshot({ path: "/tmp/intolerances-none-selected.png" });

const disabledWhenNoneSelected = [];
for (const btn of await page.locator("button").all()) {
  const text = (await btn.textContent())?.trim();
  if (!text || /^(← back|continue|i don't have any)$/i.test(text)) continue;
  if (await btn.isDisabled()) disabledWhenNoneSelected.push(text);
  else check(`"${text}" is disabled while "I don't have any" is picked`, false);
}
check("every other option is disabled by the exclusive pick", disabledWhenNoneSelected.length > 0, JSON.stringify(disabledWhenNoneSelected));

// Symmetric: deselecting must give them all back.
await tap(page, "I don't have any");
check("'Other' re-enables after deselecting", !(await page.getByRole("button", { name: "Other", exact: true }).isDisabled()));
await page.screenshot({ path: "/tmp/intolerances-none-deselected.png" });

await finish(browser);
