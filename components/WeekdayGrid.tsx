interface MacroData {
  kcal?:    number;
  protein?: number;
  carbs?:   number;
  fat?:     number;
  sugar?:   number;
  sodium?:  number;
}

export type { MacroData };

interface Props {
  weekday:      string;
  date?:        string;
  macros?:      MacroData;
  goals?:       MacroData;
  onOptimise?:  () => void;
  optimising?:  boolean;
  children?:    React.ReactNode;
}

const MACRO_LABELS: { key: keyof MacroData; label: string; fill: string; track: string }[] = [
  { key: "kcal",    label: "kcal",    fill: "#23BCFD", track: "#C8EDFE" },
  { key: "protein", label: "protein", fill: "#3B6D11", track: "#E8F0DC" },
  { key: "carbs",   label: "carbs",   fill: "#3B6D11", track: "#E8F0DC" },
  { key: "fat",     label: "fat",     fill: "#3B6D11", track: "#E8F0DC" },
  { key: "sugar",   label: "sugar",   fill: "#3B6D11", track: "#E8F0DC" },
  { key: "sodium",  label: "sodium",  fill: "#3B6D11", track: "#E8F0DC" },
];

function resolveColor(pct: number, defaultFill: string, defaultTrack: string) {
  if (pct >= 1.30) return { fill: "#EF4444", track: "#FEE2E2" };
  if (pct >= 1.15) return { fill: "#f9cb16", track: "#fdf3c0" };
  return { fill: defaultFill, track: defaultTrack };
}

function MacroRing({ value, goal, label, fill, track }: { value: number; goal: number; label: string; fill: string; track: string }) {
  const r    = 16;
  const circ = 2 * Math.PI * r;
  const pct  = goal > 0 ? value / goal : 0;
  const { fill: activeFill, track: activeTrack } = resolveColor(pct, fill, track);
  const capped = Math.min(pct, 1);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke={activeTrack} strokeWidth="4" />
        <circle
          cx="20" cy="20" r={r}
          fill="none"
          stroke={activeFill}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${circ * capped} ${circ}`}
          transform="rotate(-90 20 20)"
        />
        <text x="20" y="24" textAnchor="middle" fontSize="9" fontWeight="600" fill="#2c2c2a">
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <span className="text-[9px] text-text-muted">{label}</span>
    </div>
  );
}

export function WeekdayGrid({ weekday, date, macros, goals, onOptimise, optimising, children }: Props) {
  const rings = (macros && goals)
    ? MACRO_LABELS.filter(({ key }) => (goals[key] ?? 0) > 0)
    : [];

  return (
    <div className="w-full p-3 bg-[#faf9f6] border border-[rgba(0,0,0,0.07)] rounded-lg flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="text-text-muted text-[10px] uppercase tracking-wide font-display">
          {weekday}{date && `, ${date}`}
        </div>
        {onOptimise && date && (
          <button
            onClick={() => onOptimise()}
            disabled={optimising}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-green-light border-green-border text-green-primary hover:bg-green-border"
          >
            {optimising ? (
              <span className="w-2.5 h-2.5 rounded-full border border-green-primary border-t-transparent animate-spin inline-block" />
            ) : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            )}
            {optimising ? 'Optimising…' : 'Optimise'}
          </button>
        )}
      </div>
      {rings.length > 0 && (
        <div className="flex items-center justify-around py-1">
          {rings.map(({ key, label, fill, track }) => (
            <MacroRing
              key={key}
              value={macros![key] ?? 0}
              goal={goals![key]!}
              label={label}
              fill={fill}
              track={track}
            />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
