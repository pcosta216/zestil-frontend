import { RecipeGrid } from "@/components/RecipeGrid";
import type { RecipeCollection } from "@/lib/supabase/queries";

interface Props {
  recipes: RecipeCollection[];
}

export function SavedTab({ recipes }: Props) {
  return (
    <div className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-5 py-5">
      <h1 className="font-display text-lg text-text-main mb-4">My recipes</h1>
      <RecipeGrid recipes={recipes} />
    </div>
  );
}
