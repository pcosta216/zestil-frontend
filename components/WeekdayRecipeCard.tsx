"use client";

import { useState } from "react";
import { ResponseCardBar } from "@/components/ResponseCardBar";

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

export function WeekdayRecipeCard({ title, subtitle, kcal, servings_value, hasSuggestion, cardVariant = "recipe", onMore, onAdd, onDelete, onInfo }: Props) {
  const [barOpen, setBarOpen] = useState(false);

  return (
    <div className="relative">
      {barOpen && (
        <div className="fixed inset-0 z-[9]" onClick={() => setBarOpen(false)} />
      )}
      {barOpen && (
        <div className="absolute bottom-full right-0 mb-0.5 z-10 p-0.5">
          <ResponseCardBar
            cardVariant={cardVariant}
            onAdd={() => { setBarOpen(false); onAdd?.(); }}
            onMore={() => { setBarOpen(false); onMore?.(); }}
            onDelete={() => { setBarOpen(false); onDelete?.(); }}
            onInfo={() => { setBarOpen(false); onInfo?.(); }}
          />
        </div>
      )}
      <button
        onClick={() => setBarOpen((v) => !v)}
        className="w-full h-10 px-3 bg-white border border-[rgba(0,0,0,0.07)] rounded-lg flex justify-between items-center hover:border-green-border transition-colors"
      >
        <div className="flex flex-col items-start min-w-0">
          <span className="font-display text-[11px] text-text-main truncate leading-tight">{title}</span>
          {subtitle && (
            <span className="text-[9px] text-text-muted leading-tight">{subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasSuggestion && (
            <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded text-[9px] text-amber-600">
              suggestion
            </span>
          )}
          {kcal != null && (
            <span className="px-2 py-[3px] bg-green-light rounded-full text-[10px] text-green-primary">
              {Math.round(kcal)} kcal
            </span>
          )}
        </div>
      </button>
    </div>
  );
}
