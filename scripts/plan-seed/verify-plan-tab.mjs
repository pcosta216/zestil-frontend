// Verifies the Plan tab (app/zestil/PlanTab.tsx, mounted by app/zestil/AppShell.tsx at
// /zestil?tab=plan) end to end: walks doe through onboarding for real (the only sanctioned way to
// populate her goals/active_slots/week_start_day — see docs/app/onboarding/n_compile.md, and
// project memory on tbl_user_goals/tbl_user_memory), seeds one tbl_week_plan row + four
// tbl_week_plan_entries rows for her directly via the service-role client (mirrors
// scripts/onboarding-seed/reset-doe.mjs's exact connection pattern), then drives the real Plan tab
// in the browser and asserts against lib/plan-card.ts's actual mapping behaviour rather than
// guessed selectors/copy.
//
// Row shapes seeded (see rowToMealCard in lib/plan-card.ts):
//   breakfast / today    — entry_type "recipe", adjusted_snapshot null  → baseline mapping
//   dinner    / today    — entry_type "recipe", adjusted_snapshot SET, different from
//                           original_snapshot → is_optimised true, "✦ optimised" badge
//                           (WeekdayRecipeCard.tsx ~L361-372), original_macros computed live by
//                           extractRecipeMacros(original_snapshot, serving_multiplier) when the
//                           badge is toggled.
//   snack     / today    — entry_type "ingredient", meal_slot "snack", quantity_g set → exercises
//                           currentQtyG()/card.quantity_g (lib/entry-quantity.ts). NOTE:
//                           extractIngredientMacros itself only runs inside rowToMealCard's
//                           `if (isOptimised && e.original_snapshot)` guard, and this row's
//                           approved shape has no adjusted_snapshot — so the live UI never calls
//                           it for this row (same as every other non-optimised row, its `macros`
//                           badge comes straight from the DB `macros` column, not a live
//                           extraction). A realistic ingredient_nutrients array is still seeded on
//                           original_snapshot for shape-fidelity and to match what production data
//                           looks like.
//   lunch     / tomorrow — entry_type "recipe", plain → delete-flow target only.
//
// Card names are prefixed "Verify Plan " so they can't collide with anything else already on
// doe's plan, and so the seeded rows are easy to find/clean up later by name if ever needed.
//
// ── this performs REAL writes ────────────────────────────────────────────────────────────────
// openOnboarding()'s default reset wipes doe's tbl_user_memory; walking her through onboarding
// autosaves each answer to tbl_user_memory via /api/onboarding/answer (see
// docs/app/onboarding/n_compile.md); and this script inserts directly into tbl_week_plan /
// tbl_week_plan_entries with the service-role key. It does NOT delete the four seeded entries or
// the week-plan row unless CLEANUP=1 is set — by default it leaves everything in place and prints
// the ids so they're easy to find later.
//
//   node scripts/plan-seed/verify-plan-tab.mjs            (leaves seed data in place)
//   CLEANUP=1 node scripts/plan-seed/verify-plan-tab.mjs   (deletes the 4 entries + the week-plan
//                                                            row afterward, if nothing else
//                                                            references it)
//
// tbl_week_plan's exact schema (column names, and whether tbl_week_plan_entries carries a
// plan_id FK at all) is NOT discoverable from this repo — there are no migration/SQL files here;
// lib/entry-quantity.ts notes the real schema lives in a separate "agent repo". The upsert/columns
// below follow what was explicitly specified when this script was approved; the CLEANUP path's
// plan_id lookup is defensive (logs and leaves the row in place rather than guessing wrong) in
// case that column doesn't exist as named.
import { openOnboarding, walkTo, headingOf, makeCheck } from "../onboarding-seed/_walk.mjs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";

// Shaped like verify-summary-screen.mjs's stub — the real /api/onboarding/summary 500s on its
// happy path, so every verify script that needs to get past n_summary fakes both the failure and
// the retry-success response rather than depending on a broken upstream.
const SUMMARY_MD = [
  "## Diet & Eating Style",
  "",
  "- You follow a Mediterranean diet.",
  "",
  "## Meal Planning",
  "",
  "- Planning breakfast, lunch and dinner.",
].join("\n");

const toDateStr = (d) => d.toLocaleDateString("en-CA"); // matches PlanTab's own YYYY-MM-DD convention

function mondayOfThisWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);
const todayStr = toDateStr(today);
const tomorrowStr = toDateStr(tomorrow);
const weekStartStr = toDateStr(mondayOfThisWeek());

const { check, finish } = makeCheck();

// ── realistic per-row snapshots ──────────────────────────────────────────────────────────────
// NUTRIENT_MAP keys, verbatim from lib/plan-card.ts, are what recipe_totals[].nutrientname and
// ingredient_nutrients[].nutrient_name must match for extractRecipeMacros/extractIngredientMacros
// to pick them up: "Energy", "Carbohydrate, by difference", "Protein", "Total lipid (fat)",
// "Total Sugars", "Sodium, Na".

const breakfastSnapshot = {
  meal_title: "Verify Plan Greek Yogurt Parfait",
  metadata: { meal_title: "Verify Plan Greek Yogurt Parfait", servings_value: 1 },
  recipe_totals: [
    { nutrientname: "Energy", total_value: "320" },
    { nutrientname: "Carbohydrate, by difference", total_value: "38" },
    { nutrientname: "Protein", total_value: "18" },
    { nutrientname: "Total lipid (fat)", total_value: "9" },
    { nutrientname: "Total Sugars", total_value: "22" },
    { nutrientname: "Sodium, Na", total_value: "95" },
  ],
};

// recipe_totals are for the WHOLE recipe (servings_value servings) — extractRecipeMacros divides
// by servings then multiplies by serving_multiplier (1 here), so these are /2 per serving.
const dinnerOriginalSnapshot = {
  meal_title: "Verify Plan Creamy Salmon Pasta",
  metadata: { meal_title: "Verify Plan Creamy Salmon Pasta", servings_value: 2 },
  recipe_totals: [
    { nutrientname: "Energy", total_value: "1400" }, // 700/serving
    { nutrientname: "Carbohydrate, by difference", total_value: "140" }, // 70/serving
    { nutrientname: "Protein", total_value: "80" }, // 40/serving
    { nutrientname: "Total lipid (fat)", total_value: "56" }, // 28/serving
    { nutrientname: "Total Sugars", total_value: "16" }, // 8/serving
    { nutrientname: "Sodium, Na", total_value: "1600" }, // 800/serving
  ],
};
const dinnerAdjustedSnapshot = {
  meal_title: "Verify Plan Creamy Salmon Pasta (lightened)",
  metadata: { meal_title: "Verify Plan Creamy Salmon Pasta (lightened)", servings_value: 2 },
  recipe_totals: [
    { nutrientname: "Energy", total_value: "1000" }, // 500/serving
    { nutrientname: "Carbohydrate, by difference", total_value: "110" }, // 55/serving
    { nutrientname: "Protein", total_value: "76" }, // 38/serving
    { nutrientname: "Total lipid (fat)", total_value: "30" }, // 15/serving
    { nutrientname: "Total Sugars", total_value: "10" }, // 5/serving
    { nutrientname: "Sodium, Na", total_value: "1100" }, // 550/serving
  ],
};

// ingredient_nutrients are per 100g — extractIngredientMacros scales by quantity_g/100.
const snackSnapshot = {
  ingredient_name: "Verify Plan Roasted Salted Almonds",
  description: "Verify Plan Roasted Salted Almonds",
  ingredient_nutrients: [
    { nutrient_name: "Energy", nutrient_value: "598" },
    { nutrient_name: "Carbohydrate, by difference", nutrient_value: "19" },
    { nutrient_name: "Protein", nutrient_value: "21" },
    { nutrient_name: "Total lipid (fat)", nutrient_value: "53" },
    { nutrient_name: "Total Sugars", nutrient_value: "4" },
    { nutrient_name: "Sodium, Na", nutrient_value: "300" },
  ],
};

const lunchSnapshot = {
  meal_title: "Verify Plan Tomorrow Chicken Wrap",
  metadata: { meal_title: "Verify Plan Tomorrow Chicken Wrap", servings_value: 1 },
  recipe_totals: [
    { nutrientname: "Energy", total_value: "450" },
    { nutrientname: "Carbohydrate, by difference", total_value: "40" },
    { nutrientname: "Protein", total_value: "32" },
    { nutrientname: "Total lipid (fat)", total_value: "16" },
    { nutrientname: "Total Sugars", total_value: "6" },
    { nutrientname: "Sodium, Na", total_value: "620" },
  ],
};

async function main() {
  // ── 1. onboard doe for real ────────────────────────────────────────────────────────────────
  // Goals/active_slots/week_start_day come ONLY from actually completing onboarding — there is no
  // sanctioned direct write to tbl_user_goals/tbl_user_memory for that.
  let summaryCalls = 0;
  const { browser, context, page } = await openOnboarding({
    route: async (ctx) =>
      ctx.route(/\/api\/onboarding\/summary/, async (route) => {
        summaryCalls++;
        await route.fulfill(
          summaryCalls === 1
            ? { status: 502, contentType: "application/json", body: JSON.stringify({ error: "Couldn't put your summary together" }) }
            : { status: 200, contentType: "application/json", body: JSON.stringify({ summary_markdown: SUMMARY_MD }) },
        );
      }),
  });

  console.log("=== onboarding ===");
  await walkTo(page, /here's what we've got/i);
  const cta = page.getByRole("button", { name: /let's start planning/i });
  await cta.click();
  const finishedOnboarding = await page
    .getByRole("heading", { name: /you.?re all set/i })
    .waitFor({ timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check("onboarding reaches the terminal screen", finishedOnboarding, (await headingOf(page)).slice(0, 60));

  await page.getByRole("button", { name: /go to my plan/i }).click();
  await page.waitForURL(/\/zestil/, { timeout: 15000 });
  check("'Go to my plan' navigates to /zestil", new URL(page.url()).pathname === "/zestil", page.url());

  // ── 2. seed the plan directly (service-role, exact reset-doe.mjs connection pattern) ─────────
  console.log("\n=== seeding tbl_week_plan / tbl_week_plan_entries ===");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: userList } = await supabase.auth.admin.listUsers();
  const doe = userList.users.find((u) => u.email === EMAIL);
  const doeId = doe?.id;
  check("resolved doe's account id", !!doeId, doeId ?? "not found");
  if (!doeId) {
    console.error("Cannot continue without doe's account id.");
    await finish(browser);
    return;
  }

  const { data: weekPlan, error: weekPlanErr } = await supabase
    .from("tbl_week_plan")
    .upsert(
      { account_key: doeId, week_start_date: weekStartStr, status: "active" },
      { onConflict: "account_key,week_start_date" },
    )
    .select()
    .single();
  check("tbl_week_plan upsert (current week, status active)", !weekPlanErr, weekPlanErr?.message);
  console.log("  week_start_date:", weekStartStr, " plan_id:", weekPlan?.plan_id ?? "(no plan_id column returned)");

  // plan_id ties each entry back to the week-plan row upserted above — required per the schema
  // doc (tbl_week_plan_entries.plan_id uuid not null references tbl_week_plan(plan_id)), and
  // PostgREST fails loudly (not-null violation, or "column does not exist" if that turns out to
  // be wrong) rather than silently if this is omitted or mistaken.
  const rows = [
    {
      account_key: doeId, plan_id: weekPlan?.plan_id, entry_date: todayStr, meal_slot: "breakfast", entry_type: "recipe", role: "main",
      macros: { kcal: 320, protein: 18, carbs: 38, fat: 9, sugar: 22, sodium: 95 },
      agent_suggestion: null, confirmed: true, notes: null, serving_multiplier: 1, quantity_g: null,
      original_snapshot: breakfastSnapshot, adjusted_snapshot: null,
    },
    {
      account_key: doeId, plan_id: weekPlan?.plan_id, entry_date: todayStr, meal_slot: "dinner", entry_type: "recipe", role: "main",
      macros: { kcal: 500, protein: 38, carbs: 55, fat: 15, sugar: 5, sodium: 550 },
      agent_suggestion: null, confirmed: true, notes: null, serving_multiplier: 1, quantity_g: null,
      original_snapshot: dinnerOriginalSnapshot, adjusted_snapshot: dinnerAdjustedSnapshot,
    },
    {
      account_key: doeId, plan_id: weekPlan?.plan_id, entry_date: todayStr, meal_slot: "snack", entry_type: "ingredient", role: "main",
      macros: { kcal: 179, protein: 6.3, carbs: 5.7, fat: 15.9, sugar: 1.2, sodium: 90 },
      agent_suggestion: null, confirmed: true, notes: null, serving_multiplier: 1, quantity_g: 30,
      original_snapshot: snackSnapshot, adjusted_snapshot: null,
    },
    {
      account_key: doeId, plan_id: weekPlan?.plan_id, entry_date: tomorrowStr, meal_slot: "lunch", entry_type: "recipe", role: "main",
      macros: { kcal: 450, protein: 32, carbs: 40, fat: 16, sugar: 6, sodium: 620 },
      agent_suggestion: null, confirmed: true, notes: null, serving_multiplier: 1, quantity_g: null,
      original_snapshot: lunchSnapshot, adjusted_snapshot: null,
    },
  ];
  const { data: inserted, error: insertErr } = await supabase
    .from("tbl_week_plan_entries")
    .insert(rows)
    .select("entry_id, meal_slot, entry_date");
  check("tbl_week_plan_entries insert (4 rows)", !insertErr && inserted?.length === 4, insertErr?.message ?? `${inserted?.length ?? 0} row(s)`);
  const entryIdFor = (slot, date) => inserted?.find((r) => r.meal_slot === slot && r.entry_date === date)?.entry_id;
  const lunchEntryId = entryIdFor("lunch", tomorrowStr);

  // ── 3. drive the real Plan tab, in the SAME authenticated page ────────────────────────────────
  console.log("\n=== Plan tab ===");
  await page.goto(`${BASE}/zestil?tab=plan`);
  await page.waitForResponse((r) => r.url().includes("/api/plan/today"), { timeout: 20000 });
  await page.waitForTimeout(500);

  check("breakfast card renders with its name", (await page.getByText("Verify Plan Greek Yogurt Parfait").count()) > 0);
  check("breakfast card shows non-zero kcal", (await page.getByText("320 kcal").count()) > 0);
  check("dinner card renders with its name", (await page.getByText("Verify Plan Creamy Salmon Pasta (lightened)").count()) > 0);
  check("dinner card shows non-zero kcal", (await page.getByText("500 kcal").count()) > 0);
  check("snack card renders with its name", (await page.getByText("Verify Plan Roasted Salted Almonds").count()) > 0);
  check("snack card shows non-zero kcal (quantity_g-scaled ingredient)", (await page.getByText("179 kcal").count()) > 0);

  // is_optimised indicator — WeekdayRecipeCard.tsx (~L361-372) renders a "✦ optimised" / "original"
  // toggle button whenever isOptimised && !barOpen.
  const optimisedBadge = page.getByText("✦ optimised", { exact: true });
  check("dinner card shows the is_optimised badge", (await optimisedBadge.count()) > 0);
  if (await optimisedBadge.count()) {
    await optimisedBadge.click(); // toggles showOriginal -> renders original_macros via extractRecipeMacros
    await page.waitForTimeout(300);
    check("toggling to original renders extractRecipeMacros(original_snapshot) numbers", (await page.getByText("700 kcal").count()) > 0);
    await page.getByText("original", { exact: true }).click(); // toggle back
    await page.waitForTimeout(300);
  }

  // ── tomorrow, via the date strip ─────────────────────────────────────────────────────────────
  const tomorrowDayNum = String(tomorrow.getDate());
  const tomorrowResp = page.waitForResponse((r) => r.url().includes("/api/plan/today"), { timeout: 20000 });
  await page.getByRole("button", { name: tomorrowDayNum, exact: true }).click();
  await tomorrowResp;
  await page.waitForTimeout(400);
  check("tomorrow's lunch card renders after switching the date strip", (await page.getByText("Verify Plan Tomorrow Chicken Wrap").count()) > 0);
  check("tomorrow's lunch card shows non-zero kcal", (await page.getByText("450 kcal").count()) > 0);

  // ── delete flow ───────────────────────────────────────────────────────────────────────────────
  const lunchRow = page.locator('div[role="button"]').filter({ hasText: "Verify Plan Tomorrow Chicken Wrap" });
  check("found the lunch card row to delete", (await lunchRow.count()) > 0);
  await lunchRow.click(); // opens the action bar (barOpen)
  await page.waitForTimeout(300); // let the 200ms max-width transition finish before clicking Delete
  const deleteResp = page.waitForResponse((r) => r.url().includes("/api/plan/entries/") && r.request().method() === "DELETE", { timeout: 15000 });
  await lunchRow.getByRole("button", { name: "Delete" }).click();
  await deleteResp;
  await page.waitForTimeout(300);
  check("deleted card disappears from the screen", (await page.getByText("Verify Plan Tomorrow Chicken Wrap").count()) === 0);

  const afterDelete = await page.request.get(`${BASE}/api/plan/today?date=${tomorrowStr}`);
  const afterDeleteBody = await afterDelete.json().catch(() => null);
  const stillThere = afterDeleteBody?.entries?.some((e) => e.entry_id === lunchEntryId);
  check(
    "deleted entry_id is gone from GET /api/plan/today",
    afterDelete.ok() && !stillThere,
    JSON.stringify(afterDeleteBody?.entries?.map((e) => e.entry_id) ?? afterDeleteBody),
  );

  // ── /api/recipe/link — confirmed missing in step 1 (app/api/recipe/ only has submit/, [uuid]/,
  // collections/); PlanTab.tsx:864 still posts to it when saving a recipe with a known
  // recipe_uuid. Asserted (not just logged) so this loudly fails the moment the route is added,
  // which is the signal to update docs/app/plan_tab.md instead of this check.
  const linkRes = await page.request.post(`${BASE}/api/recipe/link`, {
    data: { recipe_uuid: "verify-plan-tab-test-uuid" },
    failOnStatusCode: false,
  });
  console.log(`\n  POST /api/recipe/link -> ${linkRes.status()}`);
  check(
    "POST /api/recipe/link is still a 404 (no route file exists under app/api/recipe/)",
    linkRes.status() === 404,
    `got ${linkRes.status()} — route may now exist; update docs/app/plan_tab.md instead of this check`,
  );

  // ── cleanup (opt-in only) ────────────────────────────────────────────────────────────────────
  if (process.env.CLEANUP === "1") {
    console.log("\n=== CLEANUP=1 — removing seeded rows ===");
    const ids = inserted?.map((r) => r.entry_id).filter(Boolean) ?? [];
    if (ids.length) {
      const { error: delErr } = await supabase.from("tbl_week_plan_entries").delete().in("entry_id", ids);
      check("cleanup: deleted seeded entries", !delErr, delErr?.message);
    }
    if (weekPlan?.plan_id) {
      const { count, error: countErr } = await supabase
        .from("tbl_week_plan_entries")
        .select("entry_id", { count: "exact", head: true })
        .eq("plan_id", weekPlan.plan_id);
      if (countErr) {
        console.log(`  couldn't check for other entries on plan_id ${weekPlan.plan_id} (${countErr.message}) — leaving tbl_week_plan row in place rather than risk deleting one still in use`);
      } else if (!count) {
        const { error: planDelErr } = await supabase.from("tbl_week_plan").delete().eq("plan_id", weekPlan.plan_id);
        check("cleanup: deleted week_plan row (no remaining entries reference it)", !planDelErr, planDelErr?.message);
      } else {
        console.log(`  left tbl_week_plan row in place — ${count} other entr${count === 1 ? "y" : "ies"} still reference plan_id ${weekPlan.plan_id}`);
      }
    } else {
      console.log("  tbl_week_plan row has no known plan_id (schema unconfirmed) — leaving it in place; delete manually if needed");
    }
  } else {
    console.log("\n=== leaving seed data in place (CLEANUP not set) ===");
    console.log("  doe account_key:", doeId);
    console.log("  tbl_week_plan.plan_id:", weekPlan?.plan_id ?? "(unknown — see note above)");
    for (const r of inserted ?? []) console.log(`  entry_id ${r.entry_id}  ${r.meal_slot} / ${r.entry_date}`);
    console.log(`  (lunch entry ${lunchEntryId ?? "(unknown)"} was already deleted by the delete-flow check above)`);
  }

  await finish(browser);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
