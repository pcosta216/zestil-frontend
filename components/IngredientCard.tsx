"use client";

import { useState } from "react";
import { CircleEllipsis, Plus, Info } from "@/lib/icons";

// One ingredient the agent suggests adding (an `ingredients_list` reply). Not a planned item, so none of
// the plan card's expand-on-tap applies: it keeps the original behaviour, a 40px bar that slides in
// Add / More / Info on tap. Add is the only button that does anything: Info has no handler, and More's
// two items have nothing to open for a bare ingredient name (they used to open an empty screen).

interface MoreOption {
  label:    string;
  onClick?: () => void;
}

interface Props {
  title:        string;
  onAdd?:       () => void;
  onInfo?:      () => void;
  moreOptions?: MoreOption[];
}

const DEFAULT_MORE_OPTIONS: MoreOption[] = [
  { label: "View Recipe" },
  { label: "Show Macros" },
];

export function IngredientCard({ title, onAdd, onInfo, moreOptions = DEFAULT_MORE_OPTIONS }: Props) {
  const [barOpen,      setBarOpen]      = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const actions = [
    { icon: <Plus           size={15} />, label: "Add",  fn: onAdd,     variant: "add"     as const },
    { icon: <CircleEllipsis size={15} />, label: "More", fn: undefined, variant: "default" as const },
    { icon: <Info           size={15} />, label: "Info", fn: onInfo,    variant: "info"    as const },
  ];

  return (
    <div className="relative">
      {(barOpen || moreMenuOpen) && (
        <div className="fixed inset-0 z-[9]" onClick={() => { setBarOpen(false); setMoreMenuOpen(false); }} />
      )}

      {moreMenuOpen && (
        <div
          className="absolute bottom-full mb-1 right-0 z-20 bg-white border border-[rgba(0,0,0,0.08)] rounded-xl shadow-lg py-1 min-w-[130px]"
          onClick={(e) => e.stopPropagation()}
        >
          {moreOptions.map((opt) => (
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
        onClick={() => { setBarOpen((v) => !v); setMoreMenuOpen(false); }}
        className="relative z-10 w-full h-10 pl-3 bg-white border border-[rgba(0,0,0,0.07)] rounded-lg flex items-center hover:border-green-border transition-colors overflow-hidden cursor-pointer"
      >
        <div className="flex-1 min-w-0 flex flex-col items-start">
          <span className="font-display text-[12px] text-text-main truncate leading-tight w-full">{title}</span>
        </div>

        <div className={`flex h-full flex-shrink-0 overflow-hidden transition-[max-width] duration-200 ${barOpen ? "max-w-[102px]" : "max-w-0"}`}>
          <div className="w-1.5 flex-shrink-0" />
          {actions.map(({ icon, label, fn, variant }) => (
            <button
              key={label}
              onClick={(e) => {
                e.stopPropagation();
                if (label === "More") {
                  setMoreMenuOpen((v) => !v);
                } else {
                  setBarOpen(false);
                  fn?.();
                }
              }}
              aria-label={label}
              className={`h-full w-8 flex items-center justify-center transition-colors text-white ${
                variant === "info" ? "bg-[#23BCFD] hover:bg-[#0ea5d6]"
                : variant === "add" ? "bg-gray-300 hover:bg-gray-400"
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
  );
}
