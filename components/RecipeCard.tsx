"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { RecipeCollection } from "@/lib/supabase/queries";

let placeholderUrl: string | null = null;
let fetching = false;

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

async function sendRecipeCardLog(message: string) {
  try {
    await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch {
    // swallow logging failures to avoid breaking the UI
  }
}

export function RecipeCard({ recipe }: { recipe: RecipeCollection }) {
  const [localPlaceholderUrl, setLocalPlaceholderUrl] = useState<string | null>(placeholderUrl);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!placeholderUrl && !fetching) {
      fetching = true;
      const fetchPlaceholder = async () => {
        try {
          await sendRecipeCardLog(`placeholder fetch start for recipe ${recipe.recipe_uuid}`);
          const supabase = createClient();
          const { data, error } = await supabase
            .from('tbl_app_config')
            .select('config')
            .eq('description', 'image_placeholder')
            .limit(1);
          if (error) {
            await sendRecipeCardLog(`placeholder fetch error: ${String(error)}`);
            return;
          }
          if (data && data.length > 0 && data[0].config) {
            let config;
            if (typeof data[0].config === 'string') {
              config = JSON.parse(data[0].config);
            } else {
              config = data[0].config;
            }
            placeholderUrl = config.url;
            setLocalPlaceholderUrl(config.url);
            await sendRecipeCardLog(`placeholder url loaded: ${config.url}`);
          } else {
            await sendRecipeCardLog(`placeholder fetch result missing config row for description=image_placeholder`);
          }
        } catch (err) {
          await sendRecipeCardLog(`placeholder fetch exception: ${String(err)}`);
        }
      };
      fetchPlaceholder();
    }
  }, []);

  useEffect(() => {
    if (recipe.image_url && isValidUrl(recipe.image_url)) {
      setImageSrc(recipe.image_url);
    } else if (localPlaceholderUrl) {
      setImageSrc(localPlaceholderUrl);
    } else {
      setImageSrc(null);
    }
  }, [recipe.image_url, localPlaceholderUrl]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Link href={`/recipes/${recipe.recipe_uuid}`}>
        <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-2xl overflow-hidden hover:border-green-border transition-colors cursor-pointer group h-48">
          {/* Photo */}
          <div className="w-full h-28 bg-green-light flex items-center justify-center overflow-hidden">
            {imageSrc ? (
              <Image
                src={imageSrc}
                alt={recipe.meal_title ?? "Recipe"}
                width={300}
                height={112}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                unoptimized
                onError={() => {
                  void sendRecipeCardLog(`image load failed for recipe ${recipe.recipe_uuid}, tried ${imageSrc}, fallback ${localPlaceholderUrl ?? "none"}`);
                  if (imageSrc === recipe.image_url && localPlaceholderUrl) {
                    setImageSrc(localPlaceholderUrl);
                  } else {
                    setImageSrc(null);
                  }
                }}
              />
            ) : (
              <span className="text-2xl">🍽️</span>
            )}
          </div>

          {/* Info */}
          <div className="p-3">
            <p className="font-display text-[13px] text-text-main leading-snug line-clamp-2 mb-2 min-h-[2.7em]">
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
