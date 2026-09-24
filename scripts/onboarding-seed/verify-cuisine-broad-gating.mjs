// n_cuisine_broad: Continue must require a region (it used to be indistinguishable from Skip),
// and Skip must record NO cuisine rather than defaulting to mediterranean.
import { chromium } from "playwright";
import { resetDoe, signIn, walkTo } from "./_walk.mjs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function readMem() {
  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === EMAIL).id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  return data?.memory_json ?? {};
}

let failures = 0;
function check(label, cond, detail = "") {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

const walkToCuisineBroad = (page) => walkTo(page, /cuisines do you gravitate/i);

async function main() {
  const browser = await chromium.launch();

  // --- Pass 1: Continue is gated on a selection -------------------------------------------
  resetDoe();
  let page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(page);
  await walkToCuisineBroad(page);
  console.log("\n=== n_cuisine_broad ===");
  console.log("heading:", (await page.locator("h1").first().textContent())?.trim()?.slice(0, 50));

  const cont = page.getByRole("button", { name: /^continue$/i });
  check("Continue is disabled with no region selected", await cont.isDisabled());
  const buttons = await page.locator("button").allTextContents();
  check("Skip is still offered", buttons.some((b) => /^skip$/i.test(b)), JSON.stringify(buttons));

  await page.getByRole("button", { name: "Asia/Pacific", exact: true }).click();
  await page.waitForTimeout(300);
  check("Continue enables once a region is picked", await cont.isEnabled());

  // Deselecting again must re-disable it.
  await page.getByRole("button", { name: "Asia/Pacific", exact: true }).click();
  await page.waitForTimeout(300);
  check("Continue re-disables when the last region is deselected", await cont.isDisabled());
  await page.close();

  // --- Pass 2: Skip records nothing --------------------------------------------------------
  resetDoe();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(page);
  await walkToCuisineBroad(page);
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 25000 });
    await page.getByRole("button", { name: /^skip$/i }).first().click();
    await p;
    await page.waitForTimeout(1200);
  }
  const mem = await readMem();
  const cuisines = mem?.taste_profile?.cuisines;
  console.log("  taste_profile.cuisines after Skip:", JSON.stringify(cuisines));
  check("skipping records an empty cuisine list", Array.isArray(cuisines) && cuisines.length === 0, JSON.stringify(cuisines));
  check("no invented 'mediterranean'", !(cuisines ?? []).includes("mediterranean"), JSON.stringify(cuisines));
  console.log("  next heading:", (await page.locator("h1").first().textContent())?.trim()?.slice(0, 60));

  await page.screenshot({ path: "/tmp/cuisine-broad-gating.png" });
  await page.close();
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
