"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { RecipeGrid } from "@/components/RecipeGrid";
import type { RecipeCollection } from "@/lib/supabase/queries";

interface Props {
  recipes: RecipeCollection[];
}

export function SavedTab({ recipes }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);

  const updateThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setThumb(null);
      return;
    }
    const thumbHeight = Math.max((clientHeight / scrollHeight) * clientHeight, 28);
    const thumbTop =
      (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - thumbHeight);
    setThumb({ top: thumbTop, height: thumbHeight });
  }, []);

  useEffect(() => {
    updateThumb();
    const el = scrollRef.current;
    el?.addEventListener("scroll", updateThumb, { passive: true });
    window.addEventListener("resize", updateThumb);
    return () => {
      el?.removeEventListener("scroll", updateThumb);
      window.removeEventListener("resize", updateThumb);
    };
  }, [updateThumb, recipes]);

  return (
    <div className="flex-1 min-h-0 relative">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto no-scrollbar px-4 sm:px-5 py-5 pr-6"
      >
        <h1 className="font-display text-lg text-text-main mb-4">My recipes</h1>
        <RecipeGrid recipes={recipes} />
      </div>

      {thumb && (
        <div className="absolute right-2 top-4 bottom-4 w-[3px] rounded-full bg-green-light pointer-events-none">
          <div
            className="absolute inset-x-0 rounded-full bg-green-border transition-[top] duration-75"
            style={{ top: thumb.top, height: thumb.height }}
          />
        </div>
      )}
    </div>
  );
}
