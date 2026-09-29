// Verifies the double-submission guard: deliberately fires two rapid clicks on the same button
// (a human double-click, or React StrictMode's dev-mode double effect invocation) and confirms
// only ONE /answer request actually goes out.
//
// Retargeted from an OPTION tile to Continue: options used to submit on tap, which is what the
// original repro double-clicked. Every select screen now needs an explicit Continue (see
// SingleSelect.tsx), so Continue is the only button a double-click can double-submit — and the
// one the guards in OnboardingFlow.tsx actually protect.
import { openOnboarding, walkTo, makeCheck, tap, headingOf } from "./_walk.mjs";

const { browser, page } = await openOnboarding();
const { check, finish } = makeCheck();

let answerRequests = 0;
page.on("request", (req) => {
  if (req.url().includes("/api/onboarding/answer")) {
    answerRequests++;
    console.log(`[request #${answerRequests}]`, req.postData());
  }
});

await walkTo(page, /mainly optimizing for/i);
console.log("\nAt node:", await headingOf(page));
await tap(page, "Eat healthier, balanced meals");

answerRequests = 0;
console.log("\nFiring TWO rapid clicks on Continue (no wait between them)...");
// Two synchronous DOM clicks in one evaluate, rather than two Playwright clicks: Playwright
// waits for the element to be actionable between them, so the second would sit there until the
// button re-enables — which is never, since a successful first submit navigates away. Both
// events landing before React can re-render IS the race the guard exists for.
await page.getByRole("button", { name: /^continue$/i }).evaluate((el) => {
  el.click();
  el.click();
});
await page.waitForTimeout(2000);

console.log(`\nTotal /answer requests fired: ${answerRequests}`);
check("a double-click submits exactly once", answerRequests === 1, `fired=${answerRequests}`);
check("and the flow advanced past the goal screen", !/mainly optimizing for/i.test(await headingOf(page)), await headingOf(page));

await finish(browser);
