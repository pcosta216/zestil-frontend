import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecipes, getImagePlaceholder } from "@/lib/supabase/queries";
import { AppShell } from "./AppShell";

export default async function RecipesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [recipes, placeholderUrl] = await Promise.all([
    getRecipes(user.id),
    getImagePlaceholder(),
  ]);
  const initials = user.email?.slice(0, 2).toUpperCase() ?? "??";

  return (
    <AppShell
      user={{ id: user.id, email: user.email ?? "", initials }}
      initialRecipes={recipes}
      placeholderUrl={placeholderUrl}
    />
  );
}
