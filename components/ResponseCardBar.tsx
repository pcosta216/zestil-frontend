import { Trash2, CircleEllipsis, Plus, Info } from "@/lib/icons";

interface Action {
  icon:     React.ReactNode;
  label:    string;
  onClick?: () => void;
  variant?: "default" | "danger" | "info";
}

interface Props {
  cardVariant?: "recipe" | "ingredient";
  onAdd?:       () => void;
  onMore?:      () => void;
  onDelete?:    () => void;
  onInfo?:      () => void;
  actions?:     Action[];
}

export function ResponseCardBar({ cardVariant = "recipe", onAdd, onMore, onDelete, onInfo, actions }: Props) {
  const items: Action[] = actions ?? (
    cardVariant === "ingredient"
      ? [
          { icon: <Plus            size={15} />, label: "Add",  onClick: onAdd  },
          { icon: <CircleEllipsis  size={15} />, label: "More", onClick: onMore },
          { icon: <Info            size={15} />, label: "Info", onClick: onInfo, variant: "info" },
        ]
      : [
          { icon: <CircleEllipsis  size={15} />, label: "More",   onClick: onMore   },
          { icon: <Trash2          size={15} />, label: "Delete", onClick: onDelete, variant: "danger" },
        ]
  );

  return (
    <div className="px-2 py-1 bg-white rounded-xl border border-green-border inline-flex items-center justify-evenly gap-4 overflow-hidden">
      {items.map(({ icon, label, onClick, variant = "default" }) => (
        <button
          key={label}
          onClick={onClick}
          aria-label={label}
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
            variant === "danger" ? "text-red-500 hover:text-red-700"
            : variant === "info" ? "text-[#23BCFD] hover:text-[#0ea5d6]"
            : "text-text-muted hover:text-text-main"
          }`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
