// n_allergy_confirm's "Something's missing or wrong" must rewind to n_allergies AND revert the
// write, so a corrected answer replaces the old one instead of stacking on top of it.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
import { openOnboarding, walkTo, makeCheck, click, tap, headingOf } from "./_walk.mjs";
config({ path: resolve(process.cwd(), ".env.local") });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function readAllergies() {
  const { data: u } = await supabase.auth.admin.listUsers();
  const id = u.users.find((x) => x.email === "doe@gmail.com").id;
  const { data } = await supabase.from("tbl_user_memory").select("memory_json").eq("account_key", id).single();
  return data?.memory_json?.dietary?.allergies;
}

const { browser, page } = await openOnboarding();
const { check, finish } = makeCheck();

await walkTo(page, /allergies we should treat/i);

// Round 1: pick Nuts.
await tap(page, "Nuts");
await click(page, /^continue$/i);
console.log("\n=== n_allergy_confirm ===");
console.log("  after 1st submit:", JSON.stringify(await readAllergies()));
check("landed on the confirm gate", /just to confirm/i.test(await headingOf(page)), await headingOf(page));

const wrong = page.getByRole("button", { name: /something's missing or wrong/i });
check("the 'wrong' affordance is offered", (await wrong.count()) > 0);
await click(page, /something's missing or wrong/i);

check("rewinds to the allergies question", /allergies we should treat/i.test(await headingOf(page)), await headingOf(page));
const reverted = await readAllergies();
console.log("  allergies after 'wrong':", JSON.stringify(reverted));
check("the earlier write is reverted, not kept", Array.isArray(reverted) && reverted.length === 0, JSON.stringify(reverted));

// Round 2: a different answer must REPLACE the first, not stack on it.
await tap(page, "Dairy");
await click(page, /^continue$/i);
const after = await readAllergies();
console.log("  after 2nd submit:", JSON.stringify(after));
check("only the corrected allergy is stored", JSON.stringify(after) === JSON.stringify(["dairy"]), JSON.stringify(after));

await finish(browser);
