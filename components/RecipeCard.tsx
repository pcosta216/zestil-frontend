"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import type { RecipeCollection } from "@/lib/supabase/queries";

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function RecipeCard({ recipe }: { recipe: RecipeCollection }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Link href={`/recipes/${recipe.recipe_uuid}`}>
        <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-2xl overflow-hidden hover:border-green-border transition-colors cursor-pointer group">
          {/* Photo */}
          <div className="w-full h-28 bg-green-light flex items-center justify-center overflow-hidden">
            {recipe.image_url && isValidUrl(recipe.image_url) ? (
              <Image
                src={recipe.image_url}
                alt={recipe.meal_title ?? "Recipe"}
                width={300}
                height={112}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                unoptimized
              />
            ) : (
              <span className="text-2xl">🍽️</span>
            )}
          </div>

          {/* Info */}
          <div className="p-3">
            <p className="font-display text-[13px] text-text-main leading-snug line-clamp-2 mb-2">
              {recipe.meal_title ?? "Untitled"}
            </p>

            <div className="flex items-center gap-1.5 flex-wrap">
              {recipe.total_time && (
                <span className="text-[10px] text-green-primary bg-green-light px-2 py-0.5 rounded-full">
                  {recipe.total_time}
                </span>
              )}
              {recipe.prep_time && !recipe.total_time && (
                <span className="text-[10px] text-green-primary bg-green-light px-2 py-0.5 rounded-full">
                  {recipe.prep_time} prep
                </span>
              )}
              {recipe.servings_value && (
                <span className="text-[10px] text-text-muted">
                  {recipe.servings_value} srv
                </span>
              )}
            </div>

            {recipe.author && (
              <p className="text-[10px] text-text-muted mt-1.5 truncate">
                {recipe.author}
              </p>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
