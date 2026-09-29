"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { RecipeGrid } from "@/components/RecipeGrid";
import type { RecipeCollection } from "@/lib/supabase/queries";
import { BookOpenText, Search, Plus } from "@/lib/icons";

interface Props {
  recipes: RecipeCollection[];
  collections?: { id: number; name: string }[];
  onRecipeSaved?: () => void;
}

// A single line with no whitespace that parses as a URL (or looks like a bare domain, e.g.
// "example.com/recipe" with no scheme) is treated as a link to scrape; anything else — including
// a URL with surrounding prose — is sent as raw recipe text.
function parseRecipeInput(raw: string): { url: string } | { text: string } {
  const trimmed = raw.trim();
  if (!/\s/.test(trimmed)) {
    try {
      new URL(trimmed);
      return { url: trimmed };
    } catch {
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(trimmed)) {
        return { url: `https://${trimmed}` };
      }
    }
  }
  return { text: trimmed };
}

export function SavedTab({ recipes, collections: rawCollections = [], onRecipeSaved }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [subTab, setSubTab] = useState<"mine" | "recent">("mine");
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [pickCollectionsOpen, setPickCollectionsOpen] = useState(false);
  const [checkedCollections, setCheckedCollections] = useState<Set<number>>(new Set());
  const [banner, setBanner] = useState<{ type: "success" | "info" | "error"; message: string } | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Same filter Explore/Plan apply to their own collections checklist — "main" is where an
  // unassigned recipe already lives by default, so it isn't offered as a pick here either.
  const addCollections = useMemo(
    () => rawCollections.filter((c) => c.name.toLowerCase() !== "main"),
    [rawCollections]
  );

  function toggleAddCollection(id: number) {
    setCheckedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function showBanner(b: { type: "success" | "info" | "error"; message: string }) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(b);
    bannerTimer.current = setTimeout(() => setBanner(null), 5000);
  }

  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  async function handleAddRecipe() {
    if (!addText.trim() || addSaving || checkedCollections.size === 0) return;
    setAddSaving(true);
    showBanner({ type: "info", message: "We're cooking the data — we'll let you know when it's ready" });
    try {
      const res = await fetch("/api/recipe/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parseRecipeInput(addText)),
      });
      if (!res.ok) throw new Error("submit failed");
      const data = await res.json();
      const recipeUuid: string | null = data.recipe_uuid ?? null;

      // /recipe/submit alone doesn't attach the recipe to any collection — without this it saves
      // but never shows up in Saved. Same call ExploreTab's own save flow makes once a user has
      // checked at least one collection box.
      if (recipeUuid && checkedCollections.size > 0) {
        await fetch("/api/recipe/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe_uuid: recipeUuid, collection_ids: Array.from(checkedCollections) }),
        });
      }

      setAddOpen(false);
      setAddText("");
      setCheckedCollections(new Set());
      showBanner({ type: "success", message: "Recipe added to your collection!" });
      onRecipeSaved?.();
    } catch {
      showBanner({ type: "error", message: "Couldn't save the recipe. Please try again." });
    } finally {
      setAddSaving(false);
    }
  }

  const collections = useMemo(() => {
    const seen = new Set<string>();
    return recipes
      .map((r) => r.collections_short_desc)
      .filter((c): c is string => !!c && c.toLowerCase() !== "main" && !seen.has(c) && !!seen.add(c))
      .sort((a, b) => a.localeCompare(b));
  }, [recipes]);

  // The view carries one row per collection membership, so the same recipe_uuid can repeat with
  // (potentially) different created_at values across rows — keep the most recent one per recipe.
  const recentRecipes = useMemo(() => {
    const byUuid = new Map<string, RecipeCollection>();
    for (const r of recipes) {
      const existing = byUuid.get(r.recipe_uuid);
      if (!existing || (r.created_at ?? "") > (existing.created_at ?? "")) {
        byUuid.set(r.recipe_uuid, r);
      }
    }
    return [...byUuid.values()]
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
      .slice(0, 10);
  }, [recipes]);

  const displayed = useMemo(() => {
    if (subTab === "recent") return recentRecipes;

    let filtered = recipes;
    if (selected) filtered = filtered.filter((r) => r.collections_short_desc === selected);
    if (query.trim()) {
      const q = query.toLowerCase();
      filtered = filtered.filter((r) => r.meal_title?.toLowerCase().includes(q) ?? false);
    }
    const seen = new Set<string>();
    return filtered.filter((r) => {
      if (seen.has(r.recipe_uuid)) return false;
      seen.add(r.recipe_uuid);
      return true;
    });
  }, [recipes, selected, query, subTab, recentRecipes]);

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
    <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
      {/* Scroll area */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 sm:px-5 py-5 pr-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center bg-warm rounded-full p-0.5 border border-[rgba(0,0,0,0.07)]">
            <button
              onClick={() => setSubTab("mine")}
              className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
                subTab === "mine"
                  ? "bg-green-primary text-white"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              My recipes
            </button>
            <button
              onClick={() => {
                setSubTab("recent");
                setPanelOpen(false);
              }}
              className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
                subTab === "recent"
                  ? "bg-green-primary text-white"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Recent
            </button>
          </div>
          {subTab === "mine" && (
            <button
              onClick={() => setPanelOpen((o) => !o)}
              aria-label="Filter by collection"
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                panelOpen
                  ? "bg-green-primary text-white"
                  : "bg-green-light text-green-primary hover:bg-green-border"
              }`}
            >
              <BookOpenText size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          )}
        </div>

        {subTab === "mine" && selected && (
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

      {/* Floating add button — clears the search bar's height on My recipes, sits lower on
          Recent since that tab has no search bar. z-10 so the collections-panel backdrop (also
          z-10, rendered later) paints over it while the panel is open. */}
      <button
        onClick={() => setAddOpen(true)}
        aria-label="Add recipe"
        className={`absolute right-4 z-10 w-12 h-12 rounded-full bg-green-primary text-white flex items-center justify-center shadow-lg hover:bg-green-primary/90 active:bg-green-primary/80 transition-colors ${
          subTab === "mine" ? "bottom-20" : "bottom-4"
        }`}
      >
        <Plus size={24} strokeWidth={2} aria-hidden="true" />
      </button>

      {/* Add-recipe overlay — same fixed/centered-card pattern as the delete confirm dialog in
          RecipeDetailHero.tsx. Stays open (Add disabled, "Adding…") until the submit resolves,
          same as Explore's own save button doesn't dismiss until its fetch completes. */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex justify-center bg-black/40 p-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="font-display text-base text-text-main">Add a recipe</p>
              <p className="text-sm text-text-muted">Paste a recipe link or the recipe text.</p>
            </div>
            <textarea
              autoFocus
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              placeholder="https://… or paste recipe text"
              disabled={addSaving}
              className="flex-1 min-h-0 w-full resize-none bg-warm border border-[rgba(0,0,0,0.1)] rounded-xl px-4 py-3 text-[13.5px] text-text-main placeholder:text-[#B4B2A9] outline-none focus:border-green-mid transition-colors disabled:opacity-60"
            />
            <div className="flex gap-3 items-center">
              <button
                onClick={() => {
                  setAddOpen(false);
                  setAddText("");
                  setCheckedCollections(new Set());
                }}
                disabled={addSaving}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[rgba(0,0,0,0.1)] text-sm text-text-main hover:bg-warm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => setPickCollectionsOpen(true)}
                disabled={addSaving}
                aria-label="Choose collections"
                className={`w-11 h-11 flex-shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
                  checkedCollections.size > 0
                    ? "bg-green-primary text-white"
                    : "bg-green-light text-green-primary hover:bg-green-border"
                }`}
              >
                <BookOpenText size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
              <button
                onClick={handleAddRecipe}
                disabled={!addText.trim() || addSaving || checkedCollections.size === 0}
                className="flex-1 px-4 py-2.5 rounded-xl bg-green-primary hover:bg-green-primary/90 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {addSaving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collections picker — opened from within the add-recipe overlay, same fixed/centered-card
          presentation as that overlay itself, stacked above it (z-[55], still below the banner's
          z-[60]). Multi-select via checkedCollections, mirroring ExploreTab's own `checked` Set. */}
      {pickCollectionsOpen && (
        <div className="fixed inset-0 z-[55] flex justify-center bg-black/40 p-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4">
            <p className="font-display text-base text-text-main">Choose collections</p>
            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-1">
              {addCollections.length === 0 ? (
                <p className="text-[12px] text-text-muted px-1 py-2">No collections yet</p>
              ) : (
                addCollections.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-warm cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checkedCollections.has(c.id)}
                      onChange={() => toggleAddCollection(c.id)}
                      className="accent-green-primary w-3.5 h-3.5"
                    />
                    <span className="text-[13px] text-text-main">{c.name}</span>
                  </label>
                ))
              )}
            </div>
            <button
              onClick={() => setPickCollectionsOpen(false)}
              className="px-4 py-2.5 rounded-xl bg-green-primary hover:bg-green-primary/90 text-white text-sm font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Banner — slides in from bottom, same pattern as ExploreTab's save-status banner. z-[60]
          so it stays visible above the add-recipe overlay (z-50) while a submit is in flight. */}
      <div className={`fixed bottom-4 left-4 right-4 z-[60] transition-all duration-300 ease-out ${banner ? "translate-y-0 opacity-100" : "translate-y-[120%] opacity-0 pointer-events-none"}`}>
        <div className={`rounded-2xl px-4 py-3 text-[13px] font-medium text-white shadow-lg ${banner?.type === "error" ? "bg-red-500" : banner?.type === "success" ? "bg-green-primary" : "bg-blue-500"}`}>
          {banner?.message}
        </div>
      </div>

      {/* Search bar */}
      {subTab === "mine" && (
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
