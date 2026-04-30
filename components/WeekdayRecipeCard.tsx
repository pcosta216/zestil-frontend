interface Props {
  title: string;
  time: string;
  difficulty: string;
  onClick?: () => void;
}

export function WeekdayRecipeCard({ title, time, difficulty, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="w-60 h-9 px-3 bg-warm border border-[rgba(0,0,0,0.07)] rounded-lg inline-flex justify-between items-center hover:border-green-border transition-colors"
    >
      <span className="font-display text-[10px] text-text-main truncate">{title}</span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {time && (
          <span className="px-2.5 py-[5px] bg-green-light rounded-full text-[10px] text-green-primary">
            {time}
          </span>
        )}
        {difficulty && (
          <span className="px-1.5 py-0.5 rounded-lg border border-[rgba(0,0,0,0.1)] text-[10px] text-text-muted">
            {difficulty}
          </span>
        )}
      </div>
    </button>
  );
}
