interface Props {
  weekday: string;
  date?: string;
  children?: React.ReactNode;
}

export function WeekdayGrid({ weekday, date, children }: Props) {
  return (
    <div className="w-full p-3 bg-warm border border-[rgba(0,0,0,0.07)] rounded-lg flex flex-col gap-2.5">
      <div className="text-text-muted text-[10px] uppercase tracking-wide font-display">
        {weekday}{date && ` · ${date}`}
      </div>
      {children}
    </div>
  );
}
