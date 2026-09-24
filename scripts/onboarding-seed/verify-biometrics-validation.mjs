import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
import { EMAIL, openOnboarding, walkTo } from "./_walk.mjs";
config({ path: resolve(process.cwd(), ".env.local") });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function readMem() {
  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === EMAIL).id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  return data?.memory_json ?? {};
}

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

// Field inputs are in flow-structure order: age, height, weight.
const numberInput = (page, i) => page.locator('input[type="number"]').nth(i);
const AGE = 0, HEIGHT = 1, WEIGHT = 2;

/** The red <p> that follows a given input inside its field wrapper. */
async function errorFor(page, i) {
  const wrapper = page.locator('input[type="number"]').nth(i).locator("xpath=..");
  const err = wrapper.locator("p.text-red-600");
  return (await err.count()) ? (await err.first().textContent())?.trim() : null;
}

async function main() {
  const { browser, page } = await openOnboarding();
  await walkTo(page, /size your macros/i);

  console.log("\n=== n_biometrics validation ===");
  const heading = (await page.locator("h1").first().textContent())?.trim() ?? "";
  console.log("Heading:", heading);

  // The copy used to promise "skip the whole thing" — untrue since units/gender became required.
  check("prompt no longer offers a whole-section skip", !/skip the whole thing/i.test(heading), heading);
  check("prompt still says the measurements are optional", /leave blank/i.test(heading), heading);

  const cont = page.getByRole("button", { name: /^continue$/i });
  const buttons = await page.locator("button").allTextContents();

  // (a) no skip button — n_biometrics lost `optional: true`
  check(
    "no skip button renders",
    !buttons.some((b) => /skip|not now|prefer not to answer|rather not/i.test(b)),
    JSON.stringify(buttons)
  );

  // (b) Continue disabled until units AND gender are both chosen
  check("Continue starts disabled", await cont.isDisabled());
  check("no errors shown before any interaction", (await page.locator("p.text-red-600").count()) === 0);

  await page.getByRole("button", { name: /metric/i }).first().click();
  await page.waitForTimeout(250);
  check("still disabled with units only (gender missing)", await cont.isDisabled());
  const requiredErrs = await page.locator("p.text-red-600").allTextContents();
  check(
    "gender shows a required error once the user has interacted",
    requiredErrs.some((t) => /pick one to continue/i.test(t)),
    JSON.stringify(requiredErrs)
  );

  await page.getByRole("button", { name: /^(female|male|prefer not to say|non-?binary)$/i }).first().click();
  await page.waitForTimeout(250);
  check("Continue enabled once units + gender are set", await cont.isEnabled());

  // (c) per-field range errors
  await numberInput(page, AGE).fill("4");
  await page.waitForTimeout(250);
  check("age 4 is rejected", /between 18 and 120/.test((await errorFor(page, AGE)) ?? ""), (await errorFor(page, AGE)) ?? "none");
  check("Continue blocked by the bad age", await cont.isDisabled());

  await numberInput(page, AGE).fill("1990");
  await page.waitForTimeout(250);
  check("a birth year in the age field is rejected", (await errorFor(page, AGE)) !== null);

  await numberInput(page, AGE).fill("34");
  await page.waitForTimeout(250);
  check("age 34 clears", (await errorFor(page, AGE)) === null);

  await numberInput(page, HEIGHT).fill("900");
  await page.waitForTimeout(250);
  const hErr = (await errorFor(page, HEIGHT)) ?? "";
  check("height 900 rejected in cm", /between 60 and 270 cm/.test(hErr), hErr);

  await numberInput(page, WEIGHT).fill("5");
  await page.waitForTimeout(250);
  const wErr = (await errorFor(page, WEIGHT)) ?? "";
  check("weight 5 rejected in kg", /between 25 and 350 kg/.test(wErr), wErr);

  // (c cont.) bounds follow the selected unit system
  await page.getByRole("button", { name: /imperial/i }).first().click();
  await page.waitForTimeout(250);
  const hErrImp = (await errorFor(page, HEIGHT)) ?? "";
  const wErrImp = (await errorFor(page, WEIGHT)) ?? "";
  check("height range switches to inches", /between 24 and 106 in/.test(hErrImp), hErrImp);
  check("weight range switches to pounds", /between 55 and 772 lb/.test(wErrImp), wErrImp);
  check("5 lb is still out of range", wErrImp !== "");

  // (d) a valid submission writes through
  await page.getByRole("button", { name: /metric/i }).first().click();
  await numberInput(page, HEIGHT).fill("178");
  await numberInput(page, WEIGHT).fill("74");
  await page.waitForTimeout(300);
  check("all errors clear on valid input", (await page.locator("p.text-red-600").count()) === 0);
  check("Continue enabled for a fully valid form", await cont.isEnabled());

  const answered = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
  await cont.click();
  await answered;
  await page.waitForTimeout(700);
  console.log("Next heading:", (await page.locator("h1").first().textContent())?.trim());

  const mem = await readMem();
  const bio = mem?.profile?.biometrics ?? {};
  const units = mem?.profile?.locale?.units;
  console.log("Written:", JSON.stringify({ units, ...bio }));
  check("units written", units === "metric");
  check("age written", bio.age === 34);
  check("height written", bio.height === 178);
  check("weight written", bio.weight === 74);
  check("gender written", typeof bio.gender === "string" && bio.gender.length > 0);

  await page.screenshot({ path: "/tmp/biometrics-validated.png" });
  await browser.close();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
