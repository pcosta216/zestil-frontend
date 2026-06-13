"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Trash2 } from "@/lib/icons";
import type { RecipeCollection } from "@/lib/supabase/queries";

function parseInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-text-main">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <span key={i} className="text-text-muted">{part.slice(1, -1)}</span>;
    return part;
  });
}

function isValidUrl(url: string): boolean {
  try { new URL(url); return true; } catch { return false; }
}

export function RecipeDetailHero({ recipe }: { recipe: RecipeCollection }) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const imageUrl = recipe.image_url && isValidUrl(recipe.image_url) ? recipe.image_url : null;

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/recipe/${recipe.recipe_uuid}`, { method: "DELETE" });
    router.push("/zestil?tab=saved");
  }

  return (
    <div>
      {/* Hero image */}
      <div className="w-full h-52 bg-green-light flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <Image
            src={imageUrl}
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

      <div className="px-5 py-5 flex flex-col gap-3">
        {/* Title */}
        <div>
          <h1 className="font-display text-2xl text-text-main leading-snug mb-3">
            {recipe.meal_title ?? "Untitled recipe"}
          </h1>

        {/* Author & date */}
        {(recipe.author || recipe.date) && (
          <div className="flex items-center text-sm text-text-muted pb-2">
            {recipe.author && <span>By {recipe.author}</span>}
            {recipe.author && recipe.date && (
              <span className="w-1 h-1 rounded-full bg-[rgba(0,0,0,0.15)]" />
            )}
            {recipe.date && <span>{recipe.date}</span>}
          </div>
        )}

          {/* Meta badges */}
          <div className="flex gap-3 flex-wrap">
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
        {/* Ingredients */}
        {recipe.recipe_data?.recipe_lines && recipe.recipe_data.recipe_lines.length > 0 && (
          <div>
            <h2 className="font-display text-base text-text-main mb-3">Ingredients</h2>
            <ul className="flex flex-col gap-2">
              {recipe.recipe_data.recipe_lines.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-text-muted">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-primary flex-shrink-0" />
                  <span>{parseInlineMarkdown(line.ingredient_text)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Instructions */}
        {recipe.recipe_data?.recipe_instructions && recipe.recipe_data.recipe_instructions.length > 0 && (
          <div>
            <h2 className="font-display text-base text-text-main mb-3">Instructions</h2>
            <ol className="flex flex-col gap-4">
              {recipe.recipe_data.recipe_instructions.map((instruction, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-light text-green-primary text-xs font-semibold flex items-center justify-center mt-0.5">
                    {instruction.step}
                  </span>
                  <div className="flex flex-col gap-1">
                    {instruction.actions.map((action, i) => (
                      <p key={i} className="text-sm text-text-muted leading-relaxed">{action}</p>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Collection labels */}
        {recipe.collection_names && recipe.collection_names.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-muted">Collections</span>
            {recipe.collection_names.map((name) => (
              <span key={name} className="text-xs font-medium text-green-primary bg-green-light border border-green-border px-3 py-1 rounded-full">
                {name}
              </span>
            ))}
          </div>
        )}

        {/* Delete */}
        <button
          onClick={() => setShowConfirm(true)}
          className="flex items-center justify-center gap-2 w-full bg-red-500 hover:bg-red-600 active:bg-red-700 transition-colors text-white text-sm font-medium rounded-xl px-4 py-3"
        >
          <Trash2 size={16} strokeWidth={2} />
          Delete Recipe
        </button>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="font-display text-base text-text-main">Delete recipe?</p>
              <p className="text-sm text-text-muted">This will permanently remove the recipe from your collections.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[rgba(0,0,0,0.1)] text-sm text-text-main hover:bg-warm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
