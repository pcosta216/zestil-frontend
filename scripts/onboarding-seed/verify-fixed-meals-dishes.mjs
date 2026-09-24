// n_fixed_meals: the dishes named back at n_favorite_recipes render as pickable badges, and
// "+ Add this meal" stays off until the composer holds a day, a meal AND a dish — the dish
// coming from either a badge or the free-text box, never both at once.
//
// The two inputs are what makes this worth a browser check: the badge/box interplay is entirely
// client state, invisible to the engine (smoke-test.ts scenario S covers the options themselves).
//
// It also checks the node's Back path against the REAL saved row — this node's writes_to carries
// a `{day_of_week}` placeholder, and a snapshot holding the unsubstituted form materialises it as
// a literal key in memory_json on revert (smoke-test.ts scenario T is the engine-level guard).
//
//   node scripts/onboarding-seed/verify-fixed-meals-dishes.mjs   (needs a running dev server)
import { openOnboarding, walkTo, click, tap, headingOf } from "./_walk.mjs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const DISHES = ["Pizza", "Lasagne"];
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function readMem() {
  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === EMAIL).id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  return data?.memory_json ?? {};
}

let failures = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
};

async function main() {
  let intercepted = 0;
  const { browser, context, page } = await openOnboarding({
    // Stubbed so the badge labels are exact and the walk doesn't depend on the live agent's mood.
    route: async (ctx) =>
      ctx.route(/\/api\/onboarding\/validate-other/, async (route) => {
        intercepted++;
        const body = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            results: (body.entries ?? []).map((entry) => ({ entry, verdict: "valid", value: entry.toLowerCase(), label: entry, reason: null })),
          }),
        });
      }),
  });

  await walkTo(page, /basically the same every week/i, {
    answers: [
      // Answered for real — these titles are the badges this screen is being checked for.
      [/go-to meals/i, async (p) => {
        for (const dish of DISHES) {
          await p.getByPlaceholder(/butter chicken/i).fill(dish);
          await p.waitForTimeout(200);
          await p.getByRole("button", { name: /^add$/i }).click();
          await p.waitForTimeout(250);
        }
        await click(p, /^continue$/i);
      }],
    ],
  });

  console.log("\n=== n_fixed_meals ===");
  console.log("heading:", (await headingOf(page)).slice(0, 70));
  check("the validate-other stub actually fired", intercepted > 0, `intercepted=${intercepted}`);
  const titles = ((await readMem())?.meal_planning_preferences?.preferred_recipes ?? []).map((r) => r.title);
  console.log("  preferred_recipes:", JSON.stringify(titles));
  check("both dishes reached preferred_recipes", DISHES.every((d) => titles.includes(d)), JSON.stringify(titles));

  const add = page.getByRole("button", { name: "+ Add this meal", exact: true });
  const isSelected = async (name) => /green-light/.test((await page.getByRole("button", { name, exact: true }).getAttribute("class")) ?? "");

  for (const dish of DISHES) {
    check(`"${dish}" renders as a badge`, (await page.getByRole("button", { name: dish, exact: true }).count()) > 0);
  }
  check("Add is off with an empty composer", await add.isDisabled());

  // Day + meal alone is not enough: without a dish there is nothing to write into fixed_meals.
  await tap(page, "Thursday");
  await tap(page, "Dinner");
  check("Add is still off with day + meal but no dish", await add.isDisabled());

  await tap(page, "Pizza");
  check("picking a badge arms Add", await add.isEnabled());
  check("the picked badge shows as selected", await isSelected("Pizza"));

  // One field, two inputs — typing has to take over the pick rather than sit alongside it.
  await page.getByPlaceholder(/type another dish/i).fill("Roast chicken");
  await page.waitForTimeout(250);
  check("typing clears the badge selection", !(await isSelected("Pizza")));
  check("Add stays armed on typed text alone", await add.isEnabled());

  // ...and back the other way.
  await tap(page, "Lasagne");
  check("picking a badge clears the typed text", (await page.getByPlaceholder(/type another dish/i).inputValue()) === "");

  await add.click();
  await page.waitForTimeout(300);
  const row = await page.locator("text=/thursday · dinner · Lasagne/i").count();
  check("the added entry lists the badge's title", row > 0);
  check("Add is off again after the composer resets", await add.isDisabled());
  check("the badge is no longer selected after adding", !(await isSelected("Lasagne")));

  await page.screenshot({ path: "/tmp/fixed-meals-dishes.png" });
  await click(page, /^continue$/i);

  const fixed = (await readMem())?.cooking_profile?.day_constraints?.thursday?.fixed_meals ?? [];
  console.log("  thursday fixed_meals:", JSON.stringify(fixed));
  check(
    "the badge's title is written exactly as the free-text box would have written it",
    fixed.length === 1 && fixed[0].title === "Lasagne" && fixed[0].meal_slot === "dinner" && fixed[0].recipe_uuid === null,
    JSON.stringify(fixed)
  );

  // Back out of the summary and into this node again: revert writes every snapshotted path, so
  // this is where an unsubstituted `{day_of_week}` would show up as a real key beside the days.
  const backed = page.waitForResponse((r) => r.url().includes("/api/onboarding/back"), { timeout: 30000 });
  await page.getByRole("button", { name: /back/i }).first().click();
  await backed;
  await page.waitForTimeout(1200);
  const dayKeys = Object.keys((await readMem())?.cooking_profile?.day_constraints ?? {});
  console.log("  day_constraints keys after Back:", JSON.stringify(dayKeys));
  check("Back leaves no literal {day_of_week} key in memory_json", !dayKeys.some((k) => k.includes("{")), JSON.stringify(dayKeys));
  check("the seven real days are intact", dayKeys.length === 7, JSON.stringify(dayKeys));

  await context.close();
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
