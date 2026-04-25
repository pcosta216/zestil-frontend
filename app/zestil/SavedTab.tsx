"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { RecipeGrid } from "@/components/RecipeGrid";
import type { RecipeCollection } from "@/lib/supabase/queries";

interface Props {
  recipes: RecipeCollection[];
}

export function SavedTab({ recipes }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const collections = useMemo(() => {
    const seen = new Set<string>();
    return recipes
      .map((r) => r.collections_short_desc)
      .filter((c): c is string => !!c && !seen.has(c) && !!seen.add(c))
      .sort((a, b) => a.localeCompare(b));
  }, [recipes]);

  const displayed = selected
    ? recipes.filter((r) => r.collections_short_desc === selected)
    : recipes;

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
  }, [updateThumb, displayed]);

  function toggleCollection(name: string) {
    setSelected((prev) => (prev === name ? null : name));
  }

  return (
    <div className="flex-1 min-h-0 relative">
      {/* Scroll area */}
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto no-scrollbar px-4 sm:px-5 py-5 pr-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-lg text-text-main">My recipes</h1>
          <button
            onClick={() => setPanelOpen((o) => !o)}
            aria-label="Filter by collection"
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
              panelOpen || selected
                ? "bg-green-primary text-white"
                : "bg-green-light text-green-primary hover:bg-green-border"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        </div>

        {selected && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] text-green-primary bg-green-light border border-green-border px-2.5 py-0.5 rounded-full">
              {selected}
            </span>
            <button
              onClick={() => setSelected(null)}
              className="text-[11px] text-text-muted hover:text-text-main transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        <RecipeGrid recipes={displayed} />
      </div>

      {/* Scroll indicator */}
      {thumb && (
        <div className="absolute right-2 top-4 bottom-4 w-[3px] rounded-full bg-green-light pointer-events-none">
          <div
            className="absolute inset-x-0 rounded-full bg-green-border transition-[top] duration-75"
            style={{ top: thumb.top, height: thumb.height }}
          />
        </div>
      )}

      {/* Backdrop */}
      {panelOpen && (
        <div
          className="absolute inset-0 z-10"
          onClick={() => setPanelOpen(false)}
        />
      )}

      {/* Collections panel */}
      <div
        className="absolute top-0 right-0 bottom-0 w-52 bg-white border-l border-[rgba(0,0,0,0.07)] shadow-xl z-20 flex flex-col"
        style={{ transform: panelOpen ? "translateX(0)" : "translateX(100%)", transition: "transform 0.25s ease-in-out" }}
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[rgba(0,0,0,0.07)]">
          <span className="text-[12px] font-medium text-text-main uppercase tracking-wide">
            Collections
          </span>
          <button
            onClick={() => setPanelOpen(false)}
            className="text-text-muted hover:text-text-main transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar py-2">
          {collections.length === 0 ? (
            <p className="text-[12px] text-text-muted px-4 py-3">No collections</p>
          ) : (
            collections.map((name) => (
              <button
                key={name}
                onClick={() => {
                  toggleCollection(name);
                  setPanelOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors ${
                  selected === name
                    ? "text-green-primary bg-green-light font-medium"
                    : "text-text-main hover:bg-warm"
                }`}
              >
                {name}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
