"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Trash2, CircleEllipsis, Plus, Info, Gauge } from "@/lib/icons";
import { ServingInfo } from "./serving_info";
import { RecipeDetailHero } from "./RecipeDetailHero";
import type { RecipeCollection } from "@/lib/supabase/queries";

function isValidUrl(url: string): boolean {
  try { new URL(url); return true; } catch { return false; }
}
function formatTime(value: string): string {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? `${trimmed} min` : trimmed;
}
function formatDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime()))
      return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  return value;
}

export interface MoreOption {
  label:    string;
  onClick?: () => void;
}

interface MacroSet {
  kcal:    number;
  protein: number;
  carbs:   number;
  fat:     number;
  sugar:   number;
  sodium:  number;
}

interface Props {
  title:               string;
  subtitle?:           string;
  kcal?:               number;
  protein?:            number;
  macros?:             MacroSet;
  servings_value?:     number;
  serving_multiplier?: number;
  hasSuggestion?:      boolean;
  hasNotes?:           boolean;
  cardVariant?:        "recipe" | "ingredient";
  moreOptions?:        MoreOption[];
  recipeUuid?:         string;
  onMore?:             () => void;
  onAdd?:              () => void;
  onDelete?:           () => void;
  onInfo?:             () => void;
}

const DEFAULT_MORE_OPTIONS: MoreOption[] = [
  { label: "View Recipe" },
  { label: "Show Macros" },
];

const MACRO_RINGS = [
  { key: "kcal"    as const, label: "kcal",    unit: "",   fill: "#23BCFD", track: "#C8EDFE" },
  { key: "protein" as const, label: "protein", unit: "g",  fill: "#3B6D11", track: "#E8F0DC" },
  { key: "carbs"   as const, label: "carbs",   unit: "g",  fill: "#3B6D11", track: "#E8F0DC" },
  { key: "fat"     as const, label: "fat",     unit: "g",  fill: "#3B6D11", track: "#E8F0DC" },
  { key: "sugar"   as const, label: "sugar",   unit: "g",  fill: "#3B6D11", track: "#E8F0DC" },
  { key: "sodium"  as const, label: "sodium",  unit: "mg", fill: "#3B6D11", track: "#E8F0DC" },
];

export function WeekdayRecipeCard({
  title, subtitle, kcal, hasSuggestion,
  servings_value, serving_multiplier,
  cardVariant = "recipe", moreOptions = DEFAULT_MORE_OPTIONS,
  recipeUuid, macros, onAdd, onDelete, onInfo,
}: Props) {
  const [barOpen,        setBarOpen]        = useState(false);
  const [moreMenuOpen,   setMoreMenuOpen]   = useState(false);
  const [recipe,         setRecipe]         = useState<RecipeCollection | null>(null);
  const [overlayOpen,    setOverlayOpen]    = useState(false);
  const [macroOverlay,   setMacroOverlay]   = useState(false);
  const [loading,        setLoading]        = useState(false);

  useEffect(() => {
    if (!recipeUuid) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/recipe/${recipeUuid}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data) setRecipe(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recipeUuid]);


  function openRecipe() {
    setOverlayOpen(true);
  }

  function openMacroPanel() {
    setMacroOverlay(true);
  }

  const resolvedOptions: MoreOption[] = moreOptions.map((opt) => {
    if (opt.label === "View Recipe") return { ...opt, onClick: openRecipe };
    if (opt.label === "Show Macros") return { ...opt, onClick: openMacroPanel };
    return opt;
  });

  const actions = cardVariant === "ingredient"
    ? [
        { icon: <Plus           size={15} />, label: "Add",    fn: onAdd,         variant: "add"     as const },
        { icon: <CircleEllipsis size={15} />, label: "More",   fn: undefined,     variant: "default" as const },
        { icon: <Info           size={15} />, label: "Info",   fn: onInfo,        variant: "info"    as const },
      ]
    : [
        { icon: <Gauge          size={15} />, label: "Macros", fn: openMacroPanel, variant: "info"   as const },
        { icon: <CircleEllipsis size={15} />, label: "More",   fn: undefined,     variant: "default" as const },
        { icon: <Trash2         size={15} />, label: "Delete", fn: onDelete,      variant: "danger"  as const },
      ];

  const actionsPanelWidth = cardVariant === "ingredient" ? "max-w-[102px]" : "max-w-[70px]";

  return (
    <>
      {/* Recipe full-screen overlay */}
      {overlayOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-warm overflow-hidden">
          <header className="flex items-center justify-between px-5 py-4 border-b border-[rgba(0,0,0,0.07)] flex-shrink-0 bg-warm">
            <button
              onClick={() => setOverlayOpen(false)}
              className="text-sm text-text-muted flex items-center gap-1 hover:text-text-main transition-colors"
            >
              ← Back
            </button>
            <span className="font-display text-base text-text-main">Recipe</span>
            <div className="w-16" />
          </header>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {loading && (
              <div className="flex items-center justify-center py-20 text-text-muted text-sm">Loading…</div>
            )}
            {!loading && recipe && <RecipeDetailHero recipe={recipe} asOverlay />}
          </div>
        </div>
      )}

      <div className="relative">
        {(barOpen || moreMenuOpen) && (
          <div className="fixed inset-0 z-[9]" onClick={() => { setBarOpen(false); setMoreMenuOpen(false); }} />
        )}

        {macroOverlay && (
          <div
            className="fixed inset-0 z-[15] backdrop-blur-sm bg-black/25"
            onClick={() => setMacroOverlay(false)}
          />
        )}

        {/* Expanded macro / recipe summary panel */}
        {macroOverlay && (
          <div className="fixed top-4 left-2 right-2 z-20 bg-white rounded-xl shadow-xl overflow-y-auto max-h-[calc(100vh-2rem)]">
            {loading && (
              <div className="flex items-center justify-center py-8 text-text-muted text-xs">Loading…</div>
            )}

            {!loading && recipe && (() => {
              const imageUrl = recipe.image_url && isValidUrl(recipe.image_url) ? recipe.image_url : null;
              return (
                <>
                  {/* Hero image */}
                  <div className="w-full h-28 bg-green-light flex items-center justify-center overflow-hidden flex-shrink-0">
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={recipe.meal_title ?? "Recipe"}
                        width={400}
                        height={112}
                        className="w-full h-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="text-3xl">🍽️</span>
                    )}
                  </div>

                  <div className="px-3 py-3 flex flex-col gap-2">
                    {/* Title */}
                    <p className="font-display text-sm text-text-main leading-snug">
                      {recipe.meal_title ?? title}
                    </p>

                    {/* Author & date */}
                    {(recipe.author || recipe.date) && (
                      <div className="flex items-center gap-1.5 text-[10px] text-text-muted flex-wrap">
                        {recipe.author && <span>By {recipe.author}</span>}
                        {recipe.author && recipe.date && (
                          <span className="w-1 h-1 rounded-full bg-[rgba(0,0,0,0.15)]" />
                        )}
                        {recipe.date && <span>{formatDate(recipe.date)}</span>}
                      </div>
                    )}

                    {/* Time badges */}
                    <div className="flex gap-2 flex-wrap">
                      {recipe.total_time && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-green-primary bg-green-light border border-green-border px-2 py-0.5 rounded-full">
                            {formatTime(recipe.total_time)}
                          </span>
                          <span className="text-[9px] text-text-muted">total</span>
                        </div>
                      )}
                      {recipe.prep_time && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-green-primary bg-green-light border border-green-border px-2 py-0.5 rounded-full">
                            {formatTime(recipe.prep_time)}
                          </span>
                          <span className="text-[9px] text-text-muted">prep</span>
                        </div>
                      )}
                      {recipe.servings && (
                        <span className="text-[10px] text-text-muted border border-[rgba(0,0,0,0.08)] px-2 py-0.5 rounded-full">
                          {recipe.servings} servings
                        </span>
                      )}
                    </div>

                    {/* Source link */}
                    {recipe.url && (
                      <a
                        href={recipe.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[10px] text-green-primary bg-green-light border border-green-border rounded-lg px-2.5 py-1.5 w-fit"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        View original recipe
                      </a>
                    )}

                    {/* Collections */}
                    {recipe.collection_names && recipe.collection_names.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] text-text-muted">Collections</span>
                        {recipe.collection_names.map((name) => (
                          <span key={name} className="text-[9px] font-medium text-green-primary bg-green-light border border-green-border px-2 py-0.5 rounded-full">
                            {name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Macro rings */}
                    {macros && (
                      <div className="flex items-center justify-between pt-1">
                        {MACRO_RINGS.map(({ key, label, unit, fill, track }) => {
                          const value = Math.round(macros[key]);
                          const r = 16, circ = 2 * Math.PI * r;
                          return (
                            <div key={key} className="flex flex-col items-center gap-0.5">
                              <svg width="40" height="40" viewBox="0 0 40 40">
                                <circle cx="20" cy="20" r={r} fill="none" stroke={track} strokeWidth="4" />
                                <circle cx="20" cy="20" r={r} fill="none" stroke={fill} strokeWidth="4"
                                  strokeLinecap="round" strokeDasharray={`${circ * 0.75} ${circ}`}
                                  transform="rotate(-90 20 20)" />
                                <text x="20" y="24" textAnchor="middle" fontSize="8" fontWeight="600" fill="#2c2c2a">
                                  {value}{unit}
                                </text>
                              </svg>
                              <span className="text-[9px] text-text-muted">{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {/* Fallback: just rings if no recipe data available */}
            {!loading && !recipe && macros && (
              <div className="px-3 py-2.5">
                <div className="flex items-center justify-between">
                  {MACRO_RINGS.map(({ key, label, unit, fill, track }) => {
                    const value = Math.round(macros[key]);
                    const r = 16, circ = 2 * Math.PI * r;
                    return (
                      <div key={key} className="flex flex-col items-center gap-0.5">
                        <svg width="40" height="40" viewBox="0 0 40 40">
                          <circle cx="20" cy="20" r={r} fill="none" stroke={track} strokeWidth="4" />
                          <circle cx="20" cy="20" r={r} fill="none" stroke={fill} strokeWidth="4"
                            strokeLinecap="round" strokeDasharray={`${circ * 0.75} ${circ}`}
                            transform="rotate(-90 20 20)" />
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
            )}
          </div>
        )}

        {/* More dropdown */}
        {moreMenuOpen && (
          <div
            className="absolute bottom-full mb-1 right-0 z-20 bg-white border border-[rgba(0,0,0,0.08)] rounded-xl shadow-lg py-1 min-w-[130px]"
            onClick={(e) => e.stopPropagation()}
          >
            {resolvedOptions.map((opt) => (
              <button
                key={opt.label}
                onClick={() => { setMoreMenuOpen(false); setBarOpen(false); opt.onClick?.(); }}
                className="w-full text-left px-4 py-2 text-[12px] text-text-main hover:bg-warm transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        <div
          role="button"
          onClick={() => { setBarOpen(v => !v); setMoreMenuOpen(false); }}
          className="relative z-10 w-full h-10 pl-3 bg-white border border-[rgba(0,0,0,0.07)] rounded-lg flex items-center hover:border-green-border transition-colors overflow-hidden cursor-pointer"
        >
          <div className="flex-1 min-w-0 flex flex-col items-start">
            <span className="font-display text-[12px] text-text-main truncate leading-tight w-full">{title}</span>
            {subtitle && (
              <span className="text-[9px] text-text-muted leading-tight">{subtitle}</span>
            )}
          </div>

          {hasSuggestion && (
            <div className={`flex-shrink-0 overflow-hidden transition-[max-width] duration-200 ${barOpen ? "max-w-0" : "max-w-[86px]"}`}>
              <span className="ml-1.5 px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded text-[9px] text-amber-600 whitespace-nowrap inline-block">
                suggestion
              </span>
            </div>
          )}

          {serving_multiplier != null && servings_value != null && (
            <span className="ml-1.0 flex-shrink-0">
              <ServingInfo servingMultiplier={serving_multiplier} servingsValue={servings_value} />
            </span>
          )}

          {kcal != null && (
            <span className="ml-1.5 flex-shrink-0 w-14 px-2 py-[3px] bg-green-light rounded-full text-[10px] text-green-primary whitespace-nowrap">
              {Math.round(kcal)} kcal
            </span>
          )}

          <div className={`flex h-full flex-shrink-0 overflow-hidden transition-[max-width] duration-200 ${barOpen ? actionsPanelWidth : "max-w-0"}`}>
            <div className="w-1.5 flex-shrink-0" />
            {actions.map(({ icon, label, fn, variant }) => (
              <button
                key={label}
                onClick={(e) => {
                  e.stopPropagation();
                  if (label === "More") {
                    setMoreMenuOpen(v => !v);
                  } else if (label === "Macros") {
                    fn?.();
                  } else {
                    setBarOpen(false);
                    fn?.();
                  }
                }}
                aria-label={label}
                className={`h-full w-8 flex items-center justify-center transition-colors text-white ${
                  variant === "danger" ? "bg-red-500 hover:bg-red-600"
                  : variant === "info"  ? "bg-[#23BCFD] hover:bg-[#0ea5d6]"
                  : variant === "add"   ? "bg-gray-300 hover:bg-gray-400"
                  : "bg-gray-400 hover:bg-gray-500"
                }`}
              >
                {icon}
              </button>
            ))}
          </div>

          <div className={`flex-shrink-0 transition-[width] duration-200 ${barOpen ? "w-0" : "w-3"}`} />
        </div>
      </div>
    </>
  );
}
