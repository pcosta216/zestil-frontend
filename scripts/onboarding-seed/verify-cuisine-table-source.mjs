// n_cuisine_narrow and n_dishes source their options from tbl_cuisines_onboarding (not the
// curated blobs), and their prompts interpolate real labels rather than raw slugs.
// Regression guard for: the region->table region mapping, the RLS read policy (without it the
// table returns zero rows and NO error, leaving only the "Other" tile), and the two different
// label columns — display_name on tiles, cuisine_name inside prompt copy.
import { openOnboarding, walkTo, click, tap } from "./_walk.mjs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let failures = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
};
const tilesOf = async (page) =>
  (await page.locator("button").allTextContents()).filter((t) => t && !/^(← back|continue|skip)$/i.test(t.trim()));

async function main() {
  const { browser, page } = await openOnboarding();
  const answer = async (fn) => {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 25000 });
    await fn();
    await p;
    await page.waitForTimeout(500);
  };

  await walkTo(page, /within .*, anything specific/i, {
    answers: [[/cuisines do you gravitate/i, async (pg) => { await tap(pg, "Central/South America"); await click(pg, /^continue$/i); }]],
  });

  console.log("\n=== n_cuisine_narrow ===");
  const narrowPrompt = (await page.locator("h1").first().textContent())?.trim() ?? "";
  const narrowTiles = await tilesOf(page);
  console.log("  prompt:", narrowPrompt);
  console.log("  tiles :", JSON.stringify(narrowTiles));
  check("prompt shows the region label, not the slug",
    narrowPrompt.includes("Central/South America") && !narrowPrompt.includes("central_latin_america"), narrowPrompt);
  check("options came from the table, not just the Other fallback", narrowTiles.length === 5, JSON.stringify(narrowTiles));
  check("Other renders last", narrowTiles[narrowTiles.length - 1] === "Other", JSON.stringify(narrowTiles));

  const firstTile = narrowTiles[0];
  await page.getByRole("button", { name: firstTile, exact: true }).click();
  await page.waitForTimeout(250);
  await answer(() => page.getByRole("button", { name: /^continue$/i }).click());

  console.log("\n=== n_dishes ===");
  const dishPrompt = (await page.locator("h1").first().textContent())?.trim() ?? "";
  const dishTiles = await tilesOf(page);
  console.log("  prompt:", dishPrompt);
  console.log("  tiles :", JSON.stringify(dishTiles));
  check("prompt shows a cuisine name, not a slug", !/_cuisine|_/.test(dishPrompt.replace(/[^\w_]/g, " ")), dishPrompt);
  check("prompt uses cuisine_name (the noun form)", /cuisine|food/i.test(dishPrompt), dishPrompt);
  check("dishes came from popular_dishes", dishTiles.length > 1, JSON.stringify(dishTiles));

  await page.getByRole("button", { name: dishTiles[0], exact: true }).click();
  await page.waitForTimeout(250);
  await answer(() => page.getByRole("button", { name: /^continue$/i }).click());

  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === EMAIL).id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  const tp = data?.memory_json?.taste_profile ?? {};
  console.log("\n  sub_cuisines   :", JSON.stringify(tp.sub_cuisines));
  console.log("  favorite_dishes:", JSON.stringify(tp.favorite_dishes));
  check("memory stores the cuisine SLUG, not the label",
    (tp.sub_cuisines ?? []).some((s) => /_/.test(s)), JSON.stringify(tp.sub_cuisines));
  check("a dish was recorded", (tp.favorite_dishes ?? []).length > 0, JSON.stringify(tp.favorite_dishes));

  await page.screenshot({ path: "/tmp/cuisine-table-source.png" });
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
