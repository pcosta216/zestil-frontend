import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecipes } from "@/lib/supabase/queries";
import { AppShell } from "./AppShell";

export default async function RecipesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const recipes = await getRecipes(user.id);
  const initials = user.email?.slice(0, 2).toUpperCase() ?? "??";

  return (
    <AppShell
      user={{ id: user.id, email: user.email ?? "", initials }}
      initialRecipes={recipes}
    />
  );
}
