import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecipes, getCollections, getUserProfile } from "@/lib/supabase/queries";
import { loadUserMemory } from "@/lib/onboarding/server-memory";
import { renderNodeBase } from "@/lib/onboarding/render-node";
import { buildProfileSections } from "@/lib/profile-sections";
import { biometricsFromMemory, type ProfileBiometrics, type ProfileSection } from "@/lib/profile";
import { AppShell } from "./AppShell";

export default async function RecipesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [recipes, collections, profile, profileMemory] = await Promise.all([
    getRecipes(user.id),
    getCollections(user.id).catch((e) => { console.error("[getCollections] failed:", e?.message); return []; }),
    getUserProfile(user.id).catch((e) => { console.error("[getUserProfile] failed:", e?.message); return null; }),
    loadProfileMemory(user.id).catch((e) => { console.error("[loadProfileMemory] failed:", e?.message); return null; }),
  ]);

  return (
    <Suspense>
      <AppShell
        user={{ id: user.id, email: user.email ?? "" }}
        initialRecipes={recipes}
        initialCollections={collections}
        profile={profile}
        biometrics={profileMemory?.biometrics ?? null}
        profileSections={profileMemory?.sections ?? null}
      />
    </Suspense>
  );
}

/**
 * The Profile tab's memory-backed cards, from one memory read: "About you" (n_biometrics' own
 * fields and the stored values) and the read-only sections. A failure building the sections
 * leaves them out rather than taking "About you" down with them.
 */
async function loadProfileMemory(userId: string): Promise<{ biometrics: ProfileBiometrics; sections: ProfileSection[] | null }> {
  const [{ memory }, node] = await Promise.all([loadUserMemory(userId), renderNodeBase("n_biometrics")]);
  const sections = await buildProfileSections(memory).catch((e) => {
    console.error("[buildProfileSections] failed:", e?.message);
    return null;
  });
  return { biometrics: { fields: node.fields ?? [], values: biometricsFromMemory(memory) }, sections };
}
