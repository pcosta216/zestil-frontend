import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await supabase.from("tbl_agent_configs").select("config").eq("agent_name", "Onboarding Validator Agent").single();
const s = data.config.system_prompt.sections;
for (const key of ["output_contract", "reason_policy"]) {
  console.log(`\n--- ${key} (order ${s[key]?.order}) ---\n${s[key]?.content}`);
}
