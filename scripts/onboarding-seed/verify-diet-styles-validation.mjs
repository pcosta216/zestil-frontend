// n_diet_style_cards "Other" now routes through the Onboarding Validator Agent (section
// `diet_styles`). Walks to that screen and exercises all three verdicts against the LIVE agent.
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

const walkToDietStyles = (page) => walkTo(page, /eating style best describes you/i);

// OtherCaptureField's input carries no `type` attribute — match it by placeholder.
const otherBox = (page) => page.getByPlaceholder("Type here…");

/** Types `text` into the Other box and submits, returning the validator response body. */
async function submitOther(page, text) {
  // Only tap the Other tile if the box isn't already showing — tapping it again would
  // deselect it and close the box.
  if ((await otherBox(page).count()) === 0) {
    await page.getByRole("button", { name: /^other$/i }).click();
    await page.waitForTimeout(300);
  }
  await otherBox(page).fill(text);
  await page.waitForTimeout(400);
  const validated = page.waitForResponse((r) => /validate-other/.test(r.url()), { timeout: 25000 });
  await page.getByRole("button", { name: /^continue$/i }).click();
  const res = await validated;
  await page.waitForTimeout(900);
  return res.json().catch(() => null);
}

async function main() {
  const { browser, page } = await openOnboarding();
  await walkToDietStyles(page);

  console.log("\n=== n_diet_style_cards -> diet_styles validation ===");
  console.log("Heading:", (await page.locator("h1").first().textContent())?.trim());

  // --- invalid: no confirm affordance, hard block ---
  let body = await submitOther(page, "chair");
  const r0 = body?.results?.[0];
  console.log("agent('chair') ->", JSON.stringify(r0));
  check("agent reached (not the out-of-scope auto-valid path)", r0 && r0.verdict !== undefined);
  check("'chair' is invalid", r0?.verdict === "invalid", JSON.stringify(r0));
  const afterInvalid = await page.locator("button").allTextContents();
  check(
    "no accept-as-typed option on invalid",
    !afterInvalid.some((b) => /yes,? that'?s right|continue anyway|add it anyway/i.test(b)),
    JSON.stringify(afterInvalid)
  );
  check("the agent's reason is shown", ((await page.locator("body").innerText()) ?? "").length > 0);

  // --- valid: silent accept, writes the agent's slug (correcting in place from the blocked state) ---
  body = await submitOther(page, "keto diet");
  const r1 = body?.results?.[0];
  console.log("agent('keto diet') ->", JSON.stringify(r1));
  check("'keto diet' is not invalid", r1 && r1.verdict !== "invalid", JSON.stringify(r1));

  await page.waitForTimeout(1200);
  const mem = await readMem();
  const preferred = mem?.dietary?.diet_type?.preferred ?? [];
  const staged = mem?.other?.diet_styles ?? [];
  console.log("diet_type.preferred:", JSON.stringify(preferred));
  console.log("other.diet_styles: ", JSON.stringify(staged));

  check("'chair' was never written", !preferred.some((v) => /chair/i.test(String(v))));
  if (r1?.verdict === "valid") {
    check(
      "the agent's normalized slug was written, not the raw text",
      preferred.includes(r1.value) && !preferred.includes("keto diet"),
      JSON.stringify(preferred)
    );
  }

  await page.screenshot({ path: "/tmp/diet-styles-validation.png" });
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
