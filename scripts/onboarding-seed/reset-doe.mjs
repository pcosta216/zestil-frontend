import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: userList } = await supabase.auth.admin.listUsers();
const user = userList.users.find((u) => u.email === "doe@gmail.com");
const { data, error } = await supabase.from("tbl_user_memory").update({ memory_json: {}, flow_position: [] }).eq("account_key", user.id).select();
console.log(error ? error.message : `Reset ${data.length} row(s)`);
