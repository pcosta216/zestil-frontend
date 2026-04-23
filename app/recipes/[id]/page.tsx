import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecipe } from "@/lib/supabase/queries";
import { RecipeDetailHero } from "@/components/RecipeDetailHero";
import { RecipeDetailSkeleton } from "@/components/LoadingSkeleton";
import BackButton from "./BackButton";

async function RecipeDetail({
  recipeUuid,
  userId,
}: {
  recipeUuid: string;
  userId: string;
}) {
  const recipe = await getRecipe(recipeUuid, userId);
  if (!recipe) notFound();
  return <RecipeDetailHero recipe={recipe} />;
}

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-col h-dvh max-w-2xl mx-auto bg-warm">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-[rgba(0,0,0,0.07)] flex-shrink-0 bg-warm">
        <BackButton />
        <span className="font-display text-base text-text-main">Recipe</span>
        <div className="w-16" />
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        <Suspense fallback={<RecipeDetailSkeleton />}>
          <RecipeDetail recipeUuid={id} userId={user!.id} />
        </Suspense>
      </div>
    </div>
  );
}
