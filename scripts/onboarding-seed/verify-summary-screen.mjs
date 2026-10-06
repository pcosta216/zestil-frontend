// n_summary renders the Onboarding Summary Agent's markdown, and never blocks Continue on it.
//
// Both calls are stubbed so the screen's two states are deterministic: the agent's own output
// varies per user and per run, and the live function currently 500s on its happy path (its
// 400/401/403 branches answer correctly — probed directly), so a real call would only ever
// exercise the failure half here.
//
//   node scripts/onboarding-seed/verify-summary-screen.mjs   (needs a running dev server)
import { openOnboarding, walkTo, headingOf } from "./_walk.mjs";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const BASE = "http://localhost:3000";
const EMAIL = "doe@gmail.com";

// Shaped like the documented response: `## `-headed sections, `- ` bullets underneath.
const SUMMARY_MD = [
  "## Diet & Eating Style",
  "",
  "- You follow a Mediterranean diet.",
  "",
  "## Allergies & Intolerances",
  "",
  "- No allergies reported.",
  "- Lactose intolerance noted.",
  "",
  "## Meal Planning",
  "",
  "- Planning breakfast, lunch and dinner.",
].join("\n");

let failures = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
};

async function main() {
  // First call fails, every later one succeeds — so one walk covers the failure state, the
  // retry, and the rendered document.
  let calls = 0;
  const { browser, context, page } = await openOnboarding({
    route: async (ctx) =>
      ctx.route(/\/api\/onboarding\/summary/, async (route) => {
        calls++;
        await route.fulfill(
          calls === 1
            ? { status: 502, contentType: "application/json", body: JSON.stringify({ error: "Couldn't put your summary together" }) }
            : { status: 200, contentType: "application/json", body: JSON.stringify({ summary_markdown: SUMMARY_MD }) }
        );
      }),
  });

  await walkTo(page, /here's what we've got/i);

  console.log("\n=== n_summary ===");
  console.log("heading:", await headingOf(page));
  const cta = page.getByRole("button", { name: /let's start planning/i });

  // --- the summary call failed -------------------------------------------------------------
  check("the screen calls the summary endpoint on mount", calls === 1, `calls=${calls}`);
  const bodyText = async () => (await page.locator("body").textContent()) ?? "";
  check("a failed summary explains itself", /couldn't put your recap together/i.test(await bodyText()));
  check("Continue is NOT blocked by the failure", await cta.isEnabled());
  check("a retry is offered", (await page.getByRole("button", { name: /try again/i }).count()) > 0);

  // The old copy came from the node's content row and was an instruction to whoever built the
  // screen, never anything a user should read.
  check("no authoring instruction on screen", !/render a short human-readable recap/i.test(await bodyText()));
  await page.screenshot({ path: "/tmp/summary-failed.png" });

  // --- retry succeeds ----------------------------------------------------------------------
  await page.getByRole("button", { name: /try again/i }).click();
  await page.waitForTimeout(1200);
  check("retry re-calls the endpoint", calls === 2, `calls=${calls}`);

  const h2s = await page.locator("h2").allTextContents();
  console.log("  rendered sections:", JSON.stringify(h2s));
  check("markdown headings render as headings", h2s.includes("Diet & Eating Style") && h2s.includes("Meal Planning"), JSON.stringify(h2s));
  const bullets = await page.locator("li").allTextContents();
  console.log("  rendered bullets: ", JSON.stringify(bullets));
  check("bullets render as list items", bullets.some((b) => /Mediterranean diet/.test(b)) && bullets.length === 4, JSON.stringify(bullets));
  check("the raw markdown syntax is not shown", !/^##\s/m.test(await bodyText()));
  check("the failure copy is gone", !/couldn't put your recap together/i.test(await bodyText()));
  await page.screenshot({ path: "/tmp/summary-rendered.png" });

  // --- and it still commits ----------------------------------------------------------------
  // Two round trips behind one tap: /answer advances to n_compile, whose effect POSTs /commit.
  // Waited for explicitly — a fixed sleep raced the second one on a cold dev route.
  await cta.click();
  // Lands on the recipe-discovery screen, which replaced "You're all set" — see
  // docs/app/onboarding/discovery_progress.md. Either heading means the commit went through.
  const finished = await page
    .getByRole("heading", { name: /finding recipes you.ll like|your recipes are ready/i })
    .waitFor({ timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check("Continue finishes onboarding", finished, (await headingOf(page)).slice(0, 60));
  check("the commit screen showed no authoring copy", !/terminal node/i.test(await bodyText()));

  await context.close();
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
