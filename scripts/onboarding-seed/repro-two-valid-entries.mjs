// "keto, atkins" — both come back valid, but reportedly only one lands in memory.
// Captures the validate-other response AND the /answer request body to find where it's lost.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const BASE = "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TYPED = process.argv[2] ?? "keto, atkins";

// With INJECT=1, replay the user's exact reported agent response instead of calling the agent,
// so the client+engine write path is tested against that literal payload.
const INJECT = process.env.INJECT === "1";
const INJECTED = {
  results: [
    { entry: "keto", verdict: "valid", value: "ketogenic_diet", label: "Ketogenic diet", reason: null },
    { entry: "atkins", verdict: "valid", value: "atkins_diet", label: "Atkins diet", reason: null },
  ],
};

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (INJECT) {
    await context.route(/\/api\/onboarding\/validate-other/, async (route) => {
      console.log("    [intercepted — replaying the reported response verbatim]");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INJECTED) });
    });
  }
  const page = await context.newPage();

  page.on("request", (req) => {
    if (/validate-other|onboarding\/answer/.test(req.url()) && req.method() === "POST") {
      console.log(`\n--> ${req.url().replace(BASE, "")}\n    ${req.postData()}`);
    }
  });
  page.on("response", async (res) => {
    if (/validate-other/.test(res.url())) {
      console.log(`<-- validate-other ${res.status()}\n    ${(await res.text().catch(() => "")).slice(0, 600)}`);
    }
  });

  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', "doe@gmail.com");
  await page.fill('input[type="password"]', "diagnostic-reset-pw-123!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/zestil/, { timeout: 20000 });
  await page.goto(`${BASE}/onboarding`);
  await page.waitForResponse((r) => r.url().includes("/api/onboarding/state"), { timeout: 20000 });
  await page.waitForTimeout(600);

  for (const name of [/^get started$/i, /^i agree$/i]) {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
    await page.getByRole("button", { name }).click();
    await p;
    await page.waitForTimeout(500);
  }
  await page.getByRole("button", { name: /metric/i }).first().click();
  await page.getByRole("button", { name: /^(female|male|prefer not to say)$/i }).first().click();
  await page.waitForTimeout(300);
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
    await page.getByRole("button", { name: /^continue$/i }).click();
    await p;
    await page.waitForTimeout(500);
  }
  await page.getByRole("button", { name: /eat healthier|lose weight|gain|maintain/i }).first().click();
  await page.waitForTimeout(300);
  {
    const p = page.waitForResponse((r) => r.url().includes("/api/onboarding/answer"), { timeout: 20000 });
    await page.getByRole("button", { name: /^continue$/i }).click();
    await p;
    await page.waitForTimeout(700);
  }

  console.log(`\n=== typing "${TYPED}" into Other ===`);
  await page.getByRole("button", { name: /^other$/i }).click();
  await page.waitForTimeout(300);
  await page.getByPlaceholder("Type here…").fill(TYPED);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForTimeout(12000);

  console.log("\nHeading now:", (await page.locator("h1").first().textContent())?.trim()?.slice(0, 60));
  const btns = await page.locator("button").allTextContents();
  console.log("Buttons:", JSON.stringify(btns));

  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === "doe@gmail.com").id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  console.log("\ndiet_type.preferred:", JSON.stringify(data?.memory_json?.dietary?.diet_type?.preferred));
  console.log("other.diet_styles:  ", JSON.stringify(data?.memory_json?.other?.diet_styles));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
