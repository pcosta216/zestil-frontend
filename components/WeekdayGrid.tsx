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
  weekday:   string;
  date?:     string;
  macros?:   MacroData;
  goals?:    MacroData;
  children?: React.ReactNode;
}

const MACRO_LABELS: { key: keyof MacroData; label: string; fill: string; track: string }[] = [
  { key: "kcal",    label: "kcal",    fill: "#23BCFD", track: "#C8EDFE" },
  { key: "protein", label: "protein", fill: "#3B6D11", track: "#E8F0DC" },
  { key: "carbs",   label: "carbs",   fill: "#3B6D11", track: "#E8F0DC" },
  { key: "fat",     label: "fat",     fill: "#3B6D11", track: "#E8F0DC" },
  { key: "sugar",   label: "sugar",   fill: "#3B6D11", track: "#E8F0DC" },
  { key: "sodium",  label: "sodium",  fill: "#3B6D11", track: "#E8F0DC" },
];

function MacroRing({ value, goal, label, fill, track }: { value: number; goal: number; label: string; fill: string; track: string }) {
  const r    = 16;
  const circ = 2 * Math.PI * r;
  const pct  = goal > 0 ? Math.min(value / goal, 1) : 0;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke={track} strokeWidth="4" />
        <circle
          cx="20" cy="20" r={r}
          fill="none"
          stroke={fill}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`}
          transform="rotate(-90 20 20)"
        />
        <text x="20" y="24" textAnchor="middle" fontSize="8" fontWeight="600" fill="#2c2c2a">
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <span className="text-[9px] text-text-muted">{label}</span>
    </div>
  );
}

export function WeekdayGrid({ weekday, date, macros, goals, children }: Props) {
  const rings = (macros && goals)
    ? MACRO_LABELS.filter(({ key }) => (goals[key] ?? 0) > 0)
    : [];

  return (
    <div className="w-full p-3 bg-warm border border-[rgba(0,0,0,0.07)] rounded-lg flex flex-col gap-1">
      <div className="text-text-muted text-[10px] uppercase tracking-wide font-display">
        {weekday}{date && ` · ${date}`}
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
