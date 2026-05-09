import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecipes, getCollections } from "@/lib/supabase/queries";
import { AppShell } from "./AppShell";

export default async function RecipesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [recipes, collections] = await Promise.all([
    getRecipes(user.id),
    getCollections(user.id).catch((e) => { console.error("[getCollections] failed:", e?.message); return []; }),
  ]);
  const initials = user.email?.slice(0, 2).toUpperCase() ?? "??";

  return (
    <AppShell
      user={{ id: user.id, email: user.email ?? "", initials }}
      initialRecipes={recipes}
      initialCollections={collections}
    />
  );
}
