import { RecipeGrid } from "@/components/RecipeGrid";
import type { RecipeCollection } from "@/lib/supabase/queries";

export function SavedTab({ recipes }: { recipes: RecipeCollection[] }) {
  return (
    <div className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-5 py-5">
      <h1 className="font-display text-lg text-text-main mb-4">My recipes</h1>
      <RecipeGrid recipes={recipes} />
    </div>
  );
}
