"use client";

import { useState } from "react";
import { Trash2, CircleEllipsis, Plus, Info } from "@/lib/icons";

interface MoreOption {
  label:    string;
  onClick?: () => void;
}

interface Action {
  icon:     React.ReactNode;
  label:    string;
  onClick?: () => void;
  variant?: "default" | "danger" | "info";
}

interface Props {
  cardVariant?:  "recipe" | "ingredient";
  onAdd?:        () => void;
  onDelete?:     () => void;
  onInfo?:       () => void;
  actions?:      Action[];
  moreOptions?:  MoreOption[];
}

const DEFAULT_MORE_OPTIONS: MoreOption[] = [
  { label: "View Recipe" },
  { label: "Option 2"    },
];

export function ResponseCardBar({
  cardVariant = "recipe", onAdd, onDelete, onInfo, actions,
  moreOptions = DEFAULT_MORE_OPTIONS,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  const items: Action[] = actions ?? (
    cardVariant === "ingredient"
      ? [
          { icon: <Plus           size={15} />, label: "Add",  onClick: onAdd  },
          { icon: <CircleEllipsis size={15} />, label: "More", onClick: undefined },
          { icon: <Info           size={15} />, label: "Info", onClick: onInfo, variant: "info" },
        ]
      : [
          { icon: <CircleEllipsis size={15} />, label: "More",   onClick: undefined },
          { icon: <Trash2         size={15} />, label: "Delete", onClick: onDelete, variant: "danger" },
        ]
  );

  return (
    <>
      {menuOpen && (
        <div className="fixed inset-0 z-[9]" onClick={() => setMenuOpen(false)} />
      )}
      <div className="relative px-2 py-1 bg-white rounded-xl border border-green-border inline-flex items-center justify-evenly gap-4 overflow-visible z-10">
        {items.map(({ icon, label, onClick, variant = "default" }) => {
          const isMore = label === "More";
          return (
            <div key={label} className="relative">
              <button
                aria-label={label}
                onClick={isMore ? () => setMenuOpen((v) => !v) : onClick}
                className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                  variant === "danger" ? "text-red-500 hover:text-red-700"
                  : variant === "info" ? "text-[#23BCFD] hover:text-[#0ea5d6]"
                  : "text-text-muted hover:text-text-main"
                }`}
              >
                {icon}
              </button>

              {isMore && menuOpen && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 bg-white border border-[rgba(0,0,0,0.08)] rounded-xl shadow-lg py-1 min-w-[130px]">
                  {moreOptions.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => { setMenuOpen(false); opt.onClick?.(); }}
                      className="w-full text-left px-4 py-2 text-[12px] text-text-main hover:bg-warm transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
