"use client";

interface Props {
  label?: string;
  onClick?: () => void;
}

export function RecipeCardEmpty({ label = "Add recipe", onClick }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-full h-48 bg-warm border border-green-border rounded-2xl flex flex-col justify-center items-center gap-1.5 overflow-hidden cursor-pointer hover:border-green-mid transition-colors"
    >
      <span className="text-green-mid text-3xl font-normal leading-none" aria-hidden="true">
        +
      </span>
      <span className="text-text-muted text-xs min-h-[2.7em]">{label}</span>
    </button>
  );
}
