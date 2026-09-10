import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecipes, getCollections, getUserProfile } from "@/lib/supabase/queries";
import { AppShell } from "./AppShell";

export default async function RecipesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [recipes, collections, profile] = await Promise.all([
    getRecipes(user.id),
    getCollections(user.id).catch((e) => { console.error("[getCollections] failed:", e?.message); return []; }),
    getUserProfile(user.id).catch((e) => { console.error("[getUserProfile] failed:", e?.message); return null; }),
  ]);

  return (
    <Suspense>
      <AppShell
        user={{ id: user.id, email: user.email ?? "" }}
        initialRecipes={recipes}
        initialCollections={collections}
        profile={profile}
      />
    </Suspense>
  );
}
