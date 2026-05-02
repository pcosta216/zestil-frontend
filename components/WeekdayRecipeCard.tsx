"use client";

import { useState } from "react";
import { Trash2, CircleEllipsis, Plus, Info } from "@/lib/icons";

interface Props {
  title:           string;
  subtitle?:       string;
  kcal?:           number;
  protein?:        number;
  servings_value?: number;
  hasSuggestion?:  boolean;
  hasNotes?:       boolean;
  cardVariant?:    "recipe" | "ingredient";
  onMore?:         () => void;
  onAdd?:          () => void;
  onDelete?:       () => void;
  onInfo?:         () => void;
}

export function WeekdayRecipeCard({
  title, subtitle, kcal, hasSuggestion,
  cardVariant = "recipe", onMore, onAdd, onDelete, onInfo,
}: Props) {
  const [barOpen, setBarOpen] = useState(false);

  const actions = cardVariant === "ingredient"
    ? [
        { icon: <Plus           size={15} />, label: "Add",    fn: onAdd,    variant: "add"     as const },
        { icon: <CircleEllipsis size={15} />, label: "More",   fn: onMore,   variant: "default" as const },
        { icon: <Info           size={15} />, label: "Info",   fn: onInfo,   variant: "info"    as const },
      ]
    : [
        { icon: <CircleEllipsis size={15} />, label: "More",   fn: onMore,   variant: "default" as const },
        { icon: <Trash2         size={15} />, label: "Delete", fn: onDelete, variant: "danger"  as const },
      ];

  // w-8 (32px) per button + 6px inner gap spacer
  const actionsPanelWidth = cardVariant === "ingredient" ? "max-w-[102px]" : "max-w-[70px]";

  return (
    <div className="relative">
      {barOpen && (
        <div className="fixed inset-0 z-[9]" onClick={() => setBarOpen(false)} />
      )}
      <div
        role="button"
        onClick={() => setBarOpen(v => !v)}
        className="relative z-10 w-full h-10 pl-3 bg-white border border-[rgba(0,0,0,0.07)] rounded-lg flex items-center hover:border-green-border transition-colors overflow-hidden cursor-pointer"
      >
        <div className="flex-1 min-w-0 flex flex-col items-start">
          <span className="font-display text-[12px] text-text-main truncate leading-tight w-full">{title}</span>
          {subtitle && (
            <span className="text-[9px] text-text-muted leading-tight">{subtitle}</span>
          )}
        </div>

        {/* Suggestion badge — gap is inside so it animates with the panel */}
        {hasSuggestion && (
          <div className={`flex-shrink-0 overflow-hidden transition-[max-width] duration-200 ${barOpen ? "max-w-0" : "max-w-[86px]"}`}>
            <span className="ml-1.5 px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded text-[9px] text-amber-600 whitespace-nowrap inline-block">
              suggestion
            </span>
          </div>
        )}

        {/* kcal — always visible */}
        {kcal != null && (
          <span className="ml-1.5 flex-shrink-0 px-2 py-[3px] bg-green-light rounded-full text-[10px] text-green-primary whitespace-nowrap">
            {Math.round(kcal)} kcal
          </span>
        )}

        {/* Actions — gap spacer inside keeps everything in sync */}
        <div className={`flex h-full flex-shrink-0 overflow-hidden transition-[max-width] duration-200 ${barOpen ? actionsPanelWidth : "max-w-0"}`}>
          <div className="w-1.5 flex-shrink-0" />
          {actions.map(({ icon, label, fn, variant }) => (
            <button
              key={label}
              onClick={(e) => { e.stopPropagation(); setBarOpen(false); fn?.(); }}
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

        {/* Right padding spacer — transitions width so there's no jump */}
        <div className={`flex-shrink-0 transition-[width] duration-200 ${barOpen ? "w-0" : "w-3"}`} />
      </div>
    </div>
  );
}
