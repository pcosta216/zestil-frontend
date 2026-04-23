import Image from "next/image";
import type { RecipeCollection } from "@/lib/supabase/queries";

export function RecipeDetailHero({ recipe }: { recipe: RecipeCollection }) {
  return (
    <div>
      {/* Hero image */}
      <div className="w-full h-52 bg-green-light flex items-center justify-center overflow-hidden">
        {recipe.image_url ? (
          <Image
            src={recipe.image_url}
            alt={recipe.meal_title ?? "Recipe"}
            width={800}
            height={208}
            className="w-full h-full object-cover"
            unoptimized
          />
        ) : (
          <span className="text-5xl">🍽️</span>
        )}
      </div>

      <div className="px-5 py-5 flex flex-col gap-5">
        {/* Title */}
        <div>
          <h1 className="font-display text-2xl text-text-main leading-snug mb-3">
            {recipe.meal_title ?? "Untitled recipe"}
          </h1>

          {/* Meta badges */}
          <div className="flex gap-2 flex-wrap">
            {recipe.total_time && (
              <span className="text-xs text-green-primary bg-green-light border border-green-border px-3 py-1 rounded-full">
                {recipe.total_time} total
              </span>
            )}
            {recipe.prep_time && (
              <span className="text-xs text-green-primary bg-green-light border border-green-border px-3 py-1 rounded-full">
                {recipe.prep_time} prep
              </span>
            )}
            {recipe.servings && (
              <span className="text-xs text-text-muted border border-[rgba(0,0,0,0.08)] px-3 py-1 rounded-full">
                {recipe.servings} servings
              </span>
            )}
          </div>
        </div>

        {/* Author & date */}
        {(recipe.author || recipe.date) && (
          <div className="flex items-center gap-3 text-sm text-text-muted">
            {recipe.author && <span>By {recipe.author}</span>}
            {recipe.author && recipe.date && (
              <span className="w-1 h-1 rounded-full bg-[rgba(0,0,0,0.15)]" />
            )}
            {recipe.date && <span>{recipe.date}</span>}
          </div>
        )}

        {/* Collection label */}
        {recipe.collections_short_desc && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Collection</span>
            <span className="text-xs font-medium text-green-primary bg-green-light border border-green-border px-3 py-1 rounded-full">
              {recipe.collections_short_desc}
            </span>
          </div>
        )}

        {/* Source link */}
        {recipe.url && (
          <a
            href={recipe.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-green-primary bg-green-light border border-green-border rounded-xl px-4 py-3 hover:bg-green-border transition-colors w-fit"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            View original recipe
          </a>
        )}
      </div>
    </div>
  );
}
