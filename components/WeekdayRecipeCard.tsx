interface Props {
  title:          string;
  subtitle?:      string;
  kcal?:          number;
  protein?:       number;
  hasSuggestion?: boolean;
  hasNotes?:      boolean;
  onClick?:       () => void;
}

export function WeekdayRecipeCard({ title, subtitle, kcal, protein, hasSuggestion, hasNotes, onClick }: Props) {
  return (
    <button
      onClick={onClick}
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
  );
}
