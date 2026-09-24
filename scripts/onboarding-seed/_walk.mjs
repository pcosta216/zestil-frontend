// Shared browser-walk helpers for the verify-*/repro-* scripts.
//
// Every one of these scripts has to get past a dozen screens it doesn't care about before it
// reaches the one it does. Doing that as a fixed sequence of clicks couples each script to the
// flow's ORDER, so moving a node breaks all of them at once — and silently rots them, since a
// walk that ends on the wrong screen still runs and still prints output.
//
// `walkTo` dispatches on the heading instead: it answers whatever is in front of it, generically,
// until the target screen appears. Reordering the flow, inserting a node or removing one costs
// nothing here. A script only spells out the screens it has an opinion about, via `answers`.
//
//   import { openOnboarding, walkTo, makeCheck } from "./_walk.mjs";
//   const { page, context, browser } = await openOnboarding();
//   await walkTo(page, /tolerate a little of/i);
import { chromium } from "playwright";
import { execSync } from "node:child_process";

export const BASE = "http://localhost:3000";
export const EMAIL = "doe@gmail.com";
export const PASSWORD = "diagnostic-reset-pw-123!";

/** Wipes the doe@gmail.com test account back to a fresh pre-onboarding state. */
export function resetDoe() {
  execSync("node scripts/onboarding-seed/reset-doe.mjs", { stdio: "ignore" });
}

/** ok/FAIL reporter with a process exit code. */
export function makeCheck() {
  let failures = 0;
  const check = (label, cond, detail = "") => {
    if (cond) console.log(`  ok   ${label}`);
    else {
      console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
      failures++;
    }
  };
  const finish = async (closeable) => {
    await closeable?.close?.();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  };
  return { check, finish, failures: () => failures };
}

/**
 * Logs in and lands on the first onboarding screen.
 * `route` is handed the context BEFORE the first navigation — context.route, never page.route:
 * page-level routes are dropped across navigations, which has produced fixture tests that
 * quietly passed against the live agent instead of the stub.
 */
export async function openOnboarding({ reset = true, route, viewport = { width: 390, height: 844 } } = {}) {
  if (reset) resetDoe();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport });
  if (route) await route(context);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await signIn(page);
  return { browser, context, page };
}

/** Logs in and lands on onboarding, for a page the caller built itself (its own context/routes). */
export async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/zestil/, { timeout: 20000 });
  await page.goto(`${BASE}/onboarding`);
  await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 20000 });
  await page.waitForTimeout(700);
  return page;
}

/** The current screen's heading, trimmed. */
export const headingOf = async (page) => (await page.locator("h1").first().textContent())?.trim() ?? "";

/** Click something that submits an answer, and wait for the round trip. */
export async function click(page, name) {
  const res = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 30000 });
  await page.getByRole("button", { name, exact: typeof name === "string" }).click();
  await res;
  await page.waitForTimeout(450);
}

/** Tap something that only changes local selection state. */
export async function tap(page, name) {
  await page.getByRole("button", { name, exact: typeof name === "string" }).first().click();
  await page.waitForTimeout(200);
}

/**
 * Several screens gate Continue on a selection (n_goal, n_cuisine_broad, n_allergies). When the
 * caller has no opinion about which option, tap options until Continue comes alive rather than
 * teaching this helper every screen's copy.
 */
export async function satisfyGate(page) {
  const cont = page.getByRole("button", { name: /^continue$/i });
  if (!(await cont.count()) || (await cont.isEnabled())) return;
  const options = page.locator("button").filter({ hasNotText: /^(← back|continue|skip|\+ add this meal)$/i });
  for (let i = 0; i < (await options.count()); i++) {
    // Disabled tiles are normal here — the exclusion decks grey out everything a diet or
    // allergy rules out rather than removing it. Clicking one just hangs on Playwright's
    // "waiting for element to be enabled", so skip past them.
    if (await options.nth(i).isDisabled()) continue;
    await options.nth(i).click();
    await page.waitForTimeout(200);
    if (await cont.isEnabled()) return;
  }
}

// How to get past each screen that can't simply be skipped. Matched against the heading, in
// order, before the generic Skip/Continue fallbacks. Keep these keyed on copy that identifies
// the QUESTION, not on node ids (the DOM has none) and not on position.
const DEFAULT_ANSWERS = [
  [/allergies we should treat/i, async (page) => { await tap(page, "None of these"); await click(page, /^continue$/i); }],
  [/tolerate a little of/i, async (page) => { await tap(page, "I don't have any"); await click(page, /^continue$/i); }],
  [/size your macros/i, async (page) => {
    await tap(page, /metric/i);
    await tap(page, /^(female|male|prefer not to say)$/i);
    await click(page, /^continue$/i);
  }],
];

/**
 * Advances screen by screen until `target` matches.
 *
 * @param target   a RegExp tested against the heading, or an async predicate taking the page —
 *                 n_pairing_cards' heading is the sampled dish's name, which nothing can know
 *                 ahead of time, so it's identified by its body copy instead.
 * @param answers  [RegExp, handler] pairs tried BEFORE the defaults — for screens this script
 *                 wants answered its own way (e.g. actually naming favourite recipes rather
 *                 than skipping past them). The handler receives (page) and must leave the flow
 *                 on the next screen.
 * @param max      loop guard; throws with the heading it got stuck on.
 */
export async function walkTo(page, target, { answers = [], max = 30, log = true } = {}) {
  for (let i = 0; i < max; i++) {
    const heading = await headingOf(page);
    if (typeof target === "function" ? await target(page) : target.test(heading)) return heading;
    if (log) console.log("at:", heading.slice(0, 55));

    const override = answers.find(([re]) => re.test(heading));
    if (override) {
      await override[1](page);
      continue;
    }
    const preset = DEFAULT_ANSWERS.find(([re]) => re.test(heading));
    if (preset) {
      await preset[1](page);
      continue;
    }

    // Generic controls, cheapest first. "Looks right" is the allergy confirm gate; "Let's start
    // planning" is n_summary's CTA (no Continue on that screen).
    if (await page.getByRole("button", { name: /^get started$/i }).count()) { await click(page, /^get started$/i); continue; }
    if (await page.getByRole("button", { name: /^i agree$/i }).count()) { await click(page, /^i agree$/i); continue; }
    if (await page.getByRole("button", { name: "Looks right", exact: true }).count()) { await click(page, "Looks right"); continue; }
    if (await page.getByRole("button", { name: /^skip$/i }).count()) { await click(page, /^skip$/i); continue; }
    if (await page.getByRole("button", { name: /let's start planning/i }).count()) { await click(page, /let's start planning/i); continue; }
    await satisfyGate(page);
    const cont = page.getByRole("button", { name: /^continue$/i });
    if (!(await cont.count()) || !(await cont.isEnabled())) {
      // Otherwise this is a 30s wait on a response that was never going to come. Nearly always
      // means the script needs an `answers` entry for this screen (or a reset it didn't do).
      throw new Error(`walkTo: nothing to click on "${heading}" — no Skip, and Continue is ${(await cont.count()) ? "disabled" : "absent"}`);
    }
    await click(page, /^continue$/i);
  }
  throw new Error(`walkTo: never reached ${target} — stuck on "${await headingOf(page)}"`);
}
