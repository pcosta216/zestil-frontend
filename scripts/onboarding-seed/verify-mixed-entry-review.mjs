// n_diet_style_cards: a multi-entry "Other" box whose entries come back with DIFFERENT
// verdicts must resolve per entry — approve the flag's suggestion, rectify/remove the invalid
// one — instead of collapsing to the worst verdict and forcing a full retype.
//
// Pass 1 intercepts the validator with a fixed mixed batch so the UI logic is tested
// deterministically; pass 2 repeats it against the LIVE agent.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
import { resetDoe, signIn, walkTo } from "./_walk.mjs";
config({ path: resolve(process.cwd(), ".env.local") });

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";
const PASSWORD = "diagnostic-reset-pw-123!";

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

const otherBox = (page) => page.getByPlaceholder("Type here…");

async function walkToDietStyles(page) {
  await signIn(page);
  await walkTo(page, /eating style best describes you/i);
}

async function typeOtherAndValidate(page, text) {
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

// --- Pass 1: deterministic, intercepted ------------------------------------------------
async function interceptedPass(browser) {
  console.log("\n=== Pass 1: mixed batch (intercepted, deterministic) ===");
  // Route on the CONTEXT, not the page: a page-level route registered before the login
  // navigation was silently dropped on roughly half the runs, letting the live agent answer
  // and making this pass non-deterministic. Context routes survive navigations.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  // Regex, not a "**/" glob — the glob form silently never matches here.
  let intercepted = 0;
  await context.route(/\/api\/onboarding\/validate-other/, async (route) => {
    intercepted++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          { entry: "kketo", verdict: "flag", value: "ketogenic_diet", label: "Ketogenic Diet",
            reason: 'The entry is a clear misspelling of "Ketogenic Diet," which is a real, documented diet.' },
          { entry: "silver surfer", verdict: "invalid", value: null, label: null,
            reason: "The entry refers to a comic book character, not a diet or eating style." },
        ],
      }),
    });
  });

  const page = await context.newPage();
  await walkToDietStyles(page);
  await typeOtherAndValidate(page, "kketo, silver surfer");

  const body = await page.locator("body").innerText();
  check("the validator call was intercepted (fixture, not the live agent)", intercepted === 1, `fired ${intercepted}x`);
  check("both entries are named in the review", body.includes("kketo") && body.includes("silver surfer"), "");
  check("the flag's reason is shown", /clear misspelling/i.test(body));
  check("the invalid's reason is shown", /comic book character/i.test(body));
  check("the invalid entry is called out by name as the one to fix", /fix\s*[“"]silver surfer[”"]/i.test(body), body.slice(0, 400));

  const buttons = await page.locator("button").allTextContents();
  check("the flag offers the model's suggestion", buttons.some((b) => /use\s*[“"]Ketogenic Diet[”"]/i.test(b)), JSON.stringify(buttons));
  check("no blanket 'continue anyway' remains", !buttons.some((b) => /continue anyway/i.test(b)), JSON.stringify(buttons));
  check("Continue is blocked while entries are undecided", await page.getByRole("button", { name: /^continue$/i }).isDisabled());

  // Approve the flag only — Continue must STILL be blocked by the unresolved invalid.
  await page.getByRole("button", { name: /use\s*[“"]Ketogenic Diet[”"]/i }).click();
  await page.waitForTimeout(300);
  check("approving the flag alone does not unblock Continue", await page.getByRole("button", { name: /^continue$/i }).isDisabled());
  check("the approved entry shows what will be saved", /Saving as\s*[“"]Ketogenic Diet[”"]/i.test(await page.locator("body").innerText()));

  // Resolve the invalid by removing it.
  await page.getByRole("button", { name: /remove this one/i }).click();
  await page.waitForTimeout(300);
  check("Continue unblocks once every entry is resolved", await page.getByRole("button", { name: /^continue$/i }).isEnabled());

  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
    await page.getByRole("button", { name: /^continue$/i }).click();
    await p;
    await page.waitForTimeout(1200);
  }

  const mem = await readMem();
  const preferred = mem?.dietary?.diet_type?.preferred ?? [];
  console.log("  diet_type.preferred:", JSON.stringify(preferred));
  check("the approved flag was written using the model's value", preferred.includes("ketogenic_diet"), JSON.stringify(preferred));
  check("the removed invalid entry was NOT written", !preferred.some((v) => /silver|surfer/i.test(String(v))), JSON.stringify(preferred));

  await page.screenshot({ path: "/tmp/mixed-review-intercepted.png" });
  await context.close();
}

// --- Pass 2: the real agent -------------------------------------------------------------
async function livePass(browser) {
  console.log("\n=== Pass 2: same batch against the LIVE agent ===");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await walkToDietStyles(page);
  const body = await typeOtherAndValidate(page, "kketo, silver surfer");
  console.log("  agent:", JSON.stringify(body?.results));

  const verdicts = Object.fromEntries((body?.results ?? []).map((r) => [r.entry, r.verdict]));
  check("both entries came back", Object.keys(verdicts).length === 2, JSON.stringify(verdicts));

  const text = await page.locator("body").innerText();
  const buttons = await page.locator("button").allTextContents();
  for (const r of body?.results ?? []) {
    if (r.verdict === "valid") continue;
    check(`"${r.entry}" (${r.verdict}) is shown by name`, text.includes(r.entry));
    if (r.verdict === "invalid") {
      check(`"${r.entry}" is flagged as needing a fix`, new RegExp(`fix\\s*[“"]${r.entry}[”"]`, "i").test(text), text.slice(0, 500));
    }
  }
  check(
    "an approve action exists for each flag",
    (body?.results ?? []).filter((r) => r.verdict === "flag").every(() => buttons.some((b) => /^yes — /i.test(b))),
    JSON.stringify(buttons)
  );

  await page.screenshot({ path: "/tmp/mixed-review-live.png" });
  await page.close();
}

// --- Pass 3: a flag carrying a suggestion, alongside a silently-accepted valid entry ---------
// Regression for the 8s-timeout bug: a slow-but-successful agent call used to be aborted and
// rewritten as synthetic flags with null value/label/reason, which turned "Did you mean South
// Beach Diet?" into "keep “california beach diet”" and downgraded the valid entry to a flag too.
async function flagSuggestionPass(browser) {
  console.log("\n=== Pass 3: flag-with-suggestion + valid entry ===");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let intercepted = 0;
  await context.route(/\/api\/onboarding\/validate-other/, async (route) => {
    intercepted++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          { entry: "california beach diet", verdict: "flag", value: "south_beach_diet",
            label: "South Beach Diet", reason: "Did you mean South Beach Diet?" },
          { entry: "m-plann diet", verdict: "valid", value: "m_plan_diet", label: "M-plan diet", reason: null },
        ],
      }),
    });
  });
  const page = await context.newPage();
  await walkToDietStyles(page);
  await typeOtherAndValidate(page, "california beach diet, m-plann diet");

  check("intercepted", intercepted === 1, `fired ${intercepted}x`);
  const text = await page.locator("body").innerText();
  const buttons = await page.locator("button").allTextContents();
  check("the agent's own reason is shown, not the node's static copy", /Did you mean South Beach Diet\?/.test(text), text.slice(0, 300));
  check("the static allergy/intolerance copy is NOT shown", !/not an allergy or intolerance/i.test(text));
  check("the flag offers the agent's suggestion", buttons.some((b) => /use\s*[“"]South Beach Diet[”"]/i.test(b)), JSON.stringify(buttons));
  check("no 'keep <raw text>' fallback button", !buttons.some((b) => /keep\s*[“"]california beach diet[”"]/i.test(b)), JSON.stringify(buttons));
  check("the valid entry is NOT shown as a problem", !text.includes("m-plann diet"), text.slice(0, 300));
  // Case-insensitive: the heading is uppercased in CSS, so innerText reports it uppercase.
  check("only one entry needs a look", /one entry needs a look/i.test(text), text.slice(0, 300));

  await page.getByRole("button", { name: /use\s*[“"]South Beach Diet[”"]/i }).click();
  await page.waitForTimeout(300);
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
    await page.getByRole("button", { name: /^continue$/i }).click();
    await p;
    await page.waitForTimeout(1200);
  }
  const preferred = (await readMem())?.dietary?.diet_type?.preferred ?? [];
  console.log("  diet_type.preferred:", JSON.stringify(preferred));
  check("the approved suggestion was written", preferred.includes("south_beach_diet"), JSON.stringify(preferred));
  check("the silently-valid entry was written too", preferred.includes("m_plan_diet"), JSON.stringify(preferred));
  check("neither raw typed string was written", !preferred.some((v) => /california|m-plann/i.test(String(v))), JSON.stringify(preferred));

  await context.close();
}

// --- Pass 4: a response that omits an entry must fail CLOSED, with real copy ------------------
async function shortResponsePass(browser) {
  console.log("\n=== Pass 4: validator omits an entry (model drops it) ===");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/\/api\/onboarding\/validate-other/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // Only ONE result for two entries — the ~5% model-drop case seen in tbl_agent_debug_log.
      body: JSON.stringify({
        results: [{ entry: "atkins", verdict: "valid", value: "atkins_diet", label: "Atkins diet", reason: null }],
      }),
    });
  });
  const page = await context.newPage();
  await walkToDietStyles(page);
  await typeOtherAndValidate(page, "atkins, banana juice diet");

  const text = await page.locator("body").innerText();
  check("the uncovered entry is surfaced, not silently accepted", text.includes("banana juice diet"), text.slice(0, 300));
  check("it carries the contract's failure copy, not the node's static message",
    /temporary issue on our end/i.test(text), text.slice(0, 400));
  check("the covered entry is not dragged into the review", !/One entry needs a look[\s\S]*atkins/i.test(text) || text.includes("banana juice diet"));
  check("Continue is blocked until it's resolved", await page.getByRole("button", { name: /^continue$/i }).isDisabled());
  await context.close();
}

async function main() {
  const browser = await chromium.launch();
  await supabaseReset(); // each pass walks from n_welcome, so start from a clean account
  await interceptedPass(browser);
  await supabaseReset();
  await flagSuggestionPass(browser);
  await supabaseReset();
  await shortResponsePass(browser);
  await supabaseReset();
  await livePass(browser);
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

const supabaseReset = () => resetDoe();

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
