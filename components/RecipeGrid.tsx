import { RecipeCard } from "./RecipeCard";
import type { RecipeCollection } from "@/lib/supabase/queries";
import Link from "next/link";

export function RecipeGrid({ recipes }: { recipes: RecipeCollection[] }) {
  if (recipes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <span className="text-4xl">🥗</span>
        <p className="font-display text-lg text-text-main">No recipes yet</p>
        <p className="text-sm text-text-muted max-w-xs">
          Your saved recipes will appear here once you add them to a collection.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {recipes.map((r) => (
        <RecipeCard key={r.recipe_uuid} recipe={r} />
      ))}
    </div>
  );
}
