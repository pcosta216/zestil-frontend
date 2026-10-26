"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Plus } from "@/lib/icons";
import { CreateCollectionButton } from "@/components/CreateCollectionButton";
import { announceItemSaved } from "@/lib/diet";

// The floating "+" that adds a recipe from a link or pasted text, with its dialog, its collections picker
// and its status banner. The Saved tab and the Plan tab both show it; each places the button itself
// (`className`: position and stacking), the rest is the same.

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

export function AddRecipeButton({ className = "", collections: rawCollections = [], onRecipeSaved, onCollectionCreated }: {
  className?: string;
  collections?: { id: number; name: string }[];
  onRecipeSaved?: () => void;
  onCollectionCreated?: (c: { id: number; name: string }) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [pickCollectionsOpen, setPickCollectionsOpen] = useState(false);
  const [checkedCollections, setCheckedCollections] = useState<Set<number>>(new Set());
  const [createDirty, setCreateDirty] = useState(false);
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
      announceItemSaved("recipe", recipeUuid);
      onRecipeSaved?.();
    } catch {
      showBanner({ type: "error", message: "Couldn't save the recipe. Please try again." });
    } finally {
      setAddSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setAddOpen(true)}
        aria-label="Add recipe"
        className={`w-[35px] h-[35px] rounded-full bg-green-primary text-white flex items-center justify-center shadow-lg hover:bg-green-primary/90 active:bg-green-primary/80 transition-colors ${className}`}
      >
        <Plus size={17} strokeWidth={2} aria-hidden="true" />
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
            <div className="flex-shrink-0">
              <CreateCollectionButton
                className="px-3 py-2.5"
                onDirtyChange={setCreateDirty}
                onCreated={(c) => {
                  onCollectionCreated?.(c);
                  setCheckedCollections((prev) => new Set(prev).add(c.id));
                }}
              />
            </div>
            <button
              onClick={() => setPickCollectionsOpen(false)}
              disabled={createDirty}
              className="px-4 py-2.5 rounded-xl bg-green-primary hover:bg-green-primary/90 text-white text-sm font-medium transition-colors disabled:opacity-50"
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
    </>
  );
}
