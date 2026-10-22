"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Heart, Trash2, Plus } from "@/lib/icons";
import { createClient } from "@/lib/supabase/browser";
import { announceItemSaved } from "@/lib/diet";
import type { RecipeCollection, Collection } from "@/lib/supabase/queries";
import { isValidUrl, formatTime, formatDate } from "@/lib/recipe-format";
import { CreateCollectionButton } from "@/components/CreateCollectionButton";
import { PlanningSwitch, useRecipePlanningSwitch } from "@/components/PlanningSwitch";

// The source link and the planning switch share one row, at one height.
const ROW_HEIGHT = "h-[27.6px]";

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

// `saved`: whether the recipe is one of the user's. The recipe page always is (the default); the Plan tab's
// overlay opens a recipe from a plan entry, which may not be: it passes null while it finds out, then false
// or true. A recipe that is not the user's gets a Save button at the bottom instead of Delete, and no
// collections yet (they are added once it is saved). `onSaved` tells the caller the user's recipes changed.
export function RecipeDetailHero({ recipe, asOverlay = false, saved = true, onSaved }: {
  recipe: RecipeCollection;
  asOverlay?: boolean;
  saved?: boolean | null;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [isSaved, setIsSaved] = useState<boolean | null>(saved);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [saveBanner, setSaveBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const saveBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveBannerTimer.current) clearTimeout(saveBannerTimer.current); }, []);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [collectionNames, setCollectionNames] = useState<string[]>(recipe.collection_names ?? []);
  const [showPicker, setShowPicker] = useState(false);
  const [allCollections, setAllCollections] = useState<Collection[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [createDirty, setCreateDirty] = useState(false);
  const visibleNames = collectionNames.filter((n) => n.toLowerCase() !== "main");
  const available = allCollections.filter(
    (c) => c.name.toLowerCase() !== "main" && !collectionNames.includes(c.name)
  );
  const imageUrl = recipe.image_url && isValidUrl(recipe.image_url) ? recipe.image_url : null;
  // A recipe that is not the user's has no auto_plan to read, and may still be kept out of planning: the switch
  // shows, taken as on until it is flipped. While it is still being found out, no switch.
  const planning = useRecipePlanningSwitch(
    recipe.recipe_uuid,
    recipe.meal_title,
    isSaved === null ? null : isSaved ? recipe.auto_plan : (recipe.auto_plan ?? true),
    recipe.auto_reason,
  );

  function showSaveBanner(b: { type: "success" | "error"; message: string }) {
    if (saveBannerTimer.current) clearTimeout(saveBannerTimer.current);
    setSaveBanner(b);
    saveBannerTimer.current = setTimeout(() => setSaveBanner(null), 5000);
  }

  // The same link the Plan chat's heart makes for a recipe that already exists.
  async function handleSave() {
    if (savingRecipe) return;
    setSavingRecipe(true);
    try {
      const { error } = await createClient().rpc("link_user_recipe", { p_recipe_uuid: recipe.recipe_uuid });
      if (error) throw new Error(error.message);
      setIsSaved(true);
      showSaveBanner({ type: "success", message: recipe.meal_title ? `"${recipe.meal_title}" saved to your recipes.` : "Recipe saved to your recipes." });
      announceItemSaved("recipe", recipe.recipe_uuid);
      onSaved?.();
    } catch {
      showSaveBanner({ type: "error", message: "Couldn't save the recipe. Please try again." });
    } finally {
      setSavingRecipe(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/recipe/${recipe.recipe_uuid}`, { method: "DELETE" });
    router.push("/zestil?tab=saved");
  }

  async function openPicker() {
    setChecked(new Set());
    setShowPicker(true);
    setLoadingCollections(true);
    try {
      const res = await fetch("/api/recipe/collections");
      if (res.ok) setAllCollections(await res.json());
    } finally {
      setLoadingCollections(false);
    }
  }

  async function closePicker() {
    setShowPicker(false);
    if (checked.size === 0) return;
    const ids = Array.from(checked);
    const res = await fetch("/api/recipe/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe_uuid: recipe.recipe_uuid, collection_ids: ids }),
    });
    if (!res.ok) return;
    const added = allCollections.filter((c) => checked.has(c.id)).map((c) => c.name);
    setCollectionNames((prev) => [...prev, ...added]);
    router.refresh();
  }

  return (
    <div>
      {/* Title */}

      <div className="font-display text-2xl text-text-main leading-snug flex justify-center overflow-hidden">
        {recipe.meal_title ?? "Untitled recipe"}
      </div>
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
        
        <div>


        {/* Author & date */}
        {(recipe.author || recipe.date) && (
          <div className="flex items-center text-sm text-text-muted pb-2">
            {recipe.author && <span>By {recipe.author}</span>}
            {recipe.author && recipe.date && (
              <span className="w-1 h-1 rounded-full bg-[rgba(0,0,0,0.15)]" />
            )}
            {recipe.date && <span>{formatDate(recipe.date)}</span>}
          </div>
        )}

          {/* Meta badges */}
          <div className="flex gap-3 flex-wrap">
            {recipe.total_time && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-green-primary bg-green-light border border-green-border px-3 py-1 rounded-full">
                  {formatTime(recipe.total_time)}
                </span>
                <span className="text-xs text-text-muted">total</span>
              </div>
            )}
            {recipe.prep_time && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-green-primary bg-green-light border border-green-border px-3 py-1 rounded-full">
                  {formatTime(recipe.prep_time)}
                </span>
                <span className="text-xs text-text-muted">prep</span>
              </div>
            )}
            {recipe.servings && (
              <span className="text-xs text-text-muted border border-[rgba(0,0,0,0.08)] px-3 py-1 rounded-full">
                {recipe.servings} servings
              </span>
            )}
          </div>
        </div>





        {/* Source link, with the planning switch to its right (on its own when there's no link). */}
        {(recipe.url || planning.ready) && (
          <div className="flex items-center gap-2 flex-wrap">
            {recipe.url && (
              <a
                href={recipe.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2 text-sm text-green-primary bg-green-light border border-green-border rounded-xl px-4 ${ROW_HEIGHT} hover:bg-green-border transition-colors w-fit`}
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
            {planning.ready && (
              <PlanningSwitch on={planning.on} why={planning.why} busy={planning.busy} onFlip={planning.flip} className={ROW_HEIGHT} />
            )}
          </div>
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
        {recipe.recipe_data?.recipe_instructions && recipe.recipe_data.recipe_instructions.length > 0 && (() => {
          const groups = recipe.recipe_data!.recipe_instructions.reduce((map, inst) => {
            const list = map.get(inst.title) ?? [];
            list.push(inst);
            map.set(inst.title, list);
            return map;
          }, new Map<string, typeof recipe.recipe_data.recipe_instructions>());

          return (
            <div className="flex flex-col gap-5">
              <h2 className="font-display text-base text-text-main">Instructions</h2>
              {[...groups.entries()].map(([title, steps]) => (
                <div key={title}>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-green-primary mb-3">{title}</p>
                  <ol className="flex flex-col gap-4">
                    {steps.map((instruction, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-light text-green-primary text-xs font-semibold flex items-center justify-center mt-0.5">
                          {instruction.step}
                        </span>
                        <div className="flex flex-col gap-1">
                          {instruction.actions.map((action, j) => (
                            <p key={j} className="text-sm text-text-muted leading-relaxed">{action}</p>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Collection labels */}
        {isSaved && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted">Collections</span>
          <button
            onClick={openPicker}
            aria-label="Add to collections"
            className="w-5 h-5 rounded-full bg-green-primary text-white flex items-center justify-center hover:bg-green-primary/90 active:bg-green-primary/80 transition-colors"
          >
            <Plus size={12} strokeWidth={2.5} />
          </button>
          {visibleNames.map((name) => (
            <span key={name} className="text-xs font-medium text-green-primary bg-green-light border border-green-border px-3 py-1 rounded-full">
              {name}
            </span>
          ))}
        </div>
        )}

        {/* Macros */}
        {recipe.recipe_data?.recipe_totals && recipe.recipe_data.recipe_totals.length > 0 && (() => {
          const servings = recipe.servings_value && recipe.servings_value > 0 ? recipe.servings_value : 1;
          const find = (name: string) =>
            (recipe.recipe_data!.recipe_totals.find((t) => t.nutrientname === name)?.total_value ?? 0) / servings;

          const macros = [
            { label: "kcal",    value: Math.round(find("Energy")),                        unit: ""   },
            { label: "protein", value: Math.round(find("Protein")),                       unit: "g"  },
            { label: "carbs",   value: Math.round(find("Carbohydrate, by difference")),   unit: "g"  },
            { label: "fat",     value: Math.round(find("Total lipid (fat)")),              unit: "g"  },
            { label: "sugar",   value: Math.round(find("Total Sugars")),                   unit: "g"  },
            { label: "sodium",  value: Math.round(find("Sodium, Na")),                     unit: "mg" },
          ];

          const colors: Record<string, { fill: string; track: string }> = {
            kcal:    { fill: "#23BCFD", track: "#C8EDFE" },
            protein: { fill: "#3B6D11", track: "#E8F0DC" },
            carbs:   { fill: "#3B6D11", track: "#E8F0DC" },
            fat:     { fill: "#3B6D11", track: "#E8F0DC" },
            sugar:   { fill: "#3B6D11", track: "#E8F0DC" },
            sodium:  { fill: "#3B6D11", track: "#E8F0DC" },
          };

          return (
            <div>
              <h2 className="font-display text-base text-text-main mb-3">
                Nutrition <span className="text-[11px] text-text-muted ml-2 align-middle">Per serving</span>
              </h2>
              <div className="flex items-center justify-around py-1">
                {macros.map(({ label, value, unit }) => {
                  const { fill, track } = colors[label];
                  const r = 16, circ = 2 * Math.PI * r;
                  return (
                    <div key={label} className="flex flex-col items-center gap-0.5">
                      <svg width="40" height="40" viewBox="0 0 40 40">
                        <circle cx="20" cy="20" r={r} fill="none" stroke={track} strokeWidth="4" />
                        <circle
                          cx="20" cy="20" r={r}
                          fill="none"
                          stroke={fill}
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={`${circ * 0.75} ${circ}`}
                          transform="rotate(-90 20 20)"
                        />
                        <text x="20" y="24" textAnchor="middle" fontSize="8" fontWeight="600" fill="#2c2c2a">
                          {value}{unit}
                        </text>
                      </svg>
                      <span className="text-[9px] text-text-muted">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Save, for a recipe that is not the user's */}
        {isSaved === false && (
          <button
            onClick={handleSave}
            disabled={savingRecipe}
            className="flex items-center justify-center gap-2 w-full bg-green-primary hover:bg-green-dark active:bg-green-dark transition-colors text-white text-sm font-medium rounded-xl px-4 py-3 disabled:opacity-60"
          >
            <Heart size={16} strokeWidth={2} />
            {savingRecipe ? "Saving…" : "Save recipe"}
          </button>
        )}

        {/* Delete */}
        {!asOverlay && isSaved && (
          <button
            onClick={() => setShowConfirm(true)}
            className="flex items-center justify-center gap-2 w-full bg-red-500 hover:bg-red-600 active:bg-red-700 transition-colors text-white text-sm font-medium rounded-xl px-4 py-3"
          >
            <Trash2 size={16} strokeWidth={2} />
            Delete Recipe
          </button>
        )}
      </div>

      {/* Collection picker */}
      {showPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-6" onClick={() => { if (!createDirty) closePicker(); }}>
          <div
            className="bg-white rounded-2xl w-full max-w-sm shadow-xl flex flex-col max-h-[70vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[rgba(0,0,0,0.06)]">
              <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide">Add to collections</span>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {loadingCollections ? (
                <p className="text-[12px] text-text-muted px-4 py-3">Loading…</p>
              ) : available.length === 0 ? (
                <p className="text-[12px] text-text-muted px-4 py-3">No more collections available</p>
              ) : (
                available.map((col) => (
                  <label key={col.id} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-warm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked.has(col.id)}
                      onChange={() => setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(col.id)) next.delete(col.id); else next.add(col.id);
                        return next;
                      })}
                      className="accent-green-primary w-3.5 h-3.5"
                    />
                    <span className="text-sm text-text-main">{col.name}</span>
                  </label>
                ))
              )}
            </div>
            {!loadingCollections && (
              <div className="flex-shrink-0 border-t border-[rgba(0,0,0,0.06)]">
                <CreateCollectionButton
                  className="px-4 py-2.5"
                  onDirtyChange={setCreateDirty}
                  onCreated={(c) => {
                    setAllCollections((prev) => [...prev, c]);
                    setChecked((prev) => new Set(prev).add(c.id));
                  }}
                />
              </div>
            )}
            <div className="px-4 py-3 border-t border-[rgba(0,0,0,0.06)]">
              <button
                onClick={closePicker}
                disabled={createDirty}
                className="w-full text-sm font-medium text-white bg-green-primary hover:bg-green-dark rounded-full py-2 transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* The planning switch's feedback — slides in from the bottom, same pattern as the tabs' save
          banner. z-[70]: above the collection picker (z-[60]), and inside the Plan tab's z-50 overlay. */}
      {(() => {
        const banner = saveBanner ?? planning.banner;
        return (
          <div className={`fixed bottom-4 left-4 right-4 z-[70] transition-all duration-300 ease-out ${banner ? "translate-y-0 opacity-100" : "translate-y-[120%] opacity-0 pointer-events-none"}`}>
            <div className={`rounded-2xl px-4 py-3 text-[13px] font-medium text-white shadow-lg ${banner?.type === "error" ? "bg-red-500" : "bg-green-primary"}`}>
              {banner?.message}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
