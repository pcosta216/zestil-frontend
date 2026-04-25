"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { RecipeGrid } from "@/components/RecipeGrid";
import type { RecipeCollection } from "@/lib/supabase/queries";
import { BookOpenText, Search } from "@/lib/icons";

interface Props {
  recipes: RecipeCollection[];
}

export function SavedTab({ recipes }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const collections = useMemo(() => {
    const seen = new Set<string>();
    return recipes
      .map((r) => r.collections_short_desc)
      .filter((c): c is string => !!c && !seen.has(c) && !!seen.add(c))
      .sort((a, b) => a.localeCompare(b));
  }, [recipes]);

  const displayed = useMemo(() => recipes.filter((r) => {
    if (selected && r.collections_short_desc !== selected) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return r.meal_title?.toLowerCase().includes(q) ?? false;
    }
    return true;
  }), [recipes, selected, query]);

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
    <div className="flex-1 min-h-0 flex flex-col relative">
      {/* Scroll area */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 sm:px-5 py-5 pr-6"
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
            <BookOpenText size={16} strokeWidth={1.5} aria-hidden="true" />
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

      {/* Search bar */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 pb-3 bg-white border-t border-[rgba(0,0,0,0.07)] flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-mid flex-shrink-0" />
        <div className="flex-1 relative">
          <Search size={14} strokeWidth={1.8} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#B4B2A9] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes…"
            className="w-full bg-warm border border-[rgba(0,0,0,0.1)] rounded-[22px] pl-9 pr-4 py-2 text-[13.5px] text-text-main placeholder:text-[#B4B2A9] outline-none leading-relaxed focus:border-green-mid transition-colors"
          />
        </div>
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-[#B4B2A9] hover:text-text-main transition-colors flex-shrink-0"
            aria-label="Clear search"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Backdrop */}
      {panelOpen && (
        <div
          className="absolute inset-0 z-10"
          onClick={() => setPanelOpen(false)}
        />
      )}

      {/* Collections panel */}
      <div
        className="absolute top-0 right-0 bottom-0 w-52 bg-white/50 backdrop-blur-sm border-l border-[rgba(0,0,0,0.07)] shadow-xl z-20 flex flex-col rounded-l-2xl"
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
