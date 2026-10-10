// The macro rings shown in WeekdayRecipeCard's macro panel: a fixed three-quarter arc (decorative —
// it is not a share of any goal), the rounded value and unit inside, the label under it. Same
// geometry and colours as the card, which still carries its own two copies of this markup.
// Unlike the card, a ring may shrink below 40px (min-w-0 + max-w-full on a square viewBox) so all of
// them stay on one line when the row is narrower than they are, e.g. inside a phone-width chat bubble.
const MACRO_RINGS = [
  { key: "kcal"    as const, label: "kcal",    unit: "",   fill: "#23BCFD", track: "#C8EDFE" },
  { key: "protein" as const, label: "protein", unit: "g",  fill: "#3B6D11", track: "#E8F0DC" },
  { key: "carbs"   as const, label: "carbs",   unit: "g",  fill: "#3B6D11", track: "#E8F0DC" },
  { key: "fat"     as const, label: "fat",     unit: "g",  fill: "#3B6D11", track: "#E8F0DC" },
  { key: "sugar"   as const, label: "sugar",   unit: "g",  fill: "#3B6D11", track: "#E8F0DC" },
  { key: "sodium"  as const, label: "sodium",  unit: "mg", fill: "#3B6D11", track: "#E8F0DC" },
];

export type MacroKey = (typeof MACRO_RINGS)[number]["key"];

// A key that is missing from `macros` gets no ring; a 0 that is present does.
export function MacroRings({ macros, className = "flex items-center justify-between" }: { macros: Partial<Record<MacroKey, number>>; className?: string }) {
  return (
    <div className={className}>
      {MACRO_RINGS.filter(({ key }) => macros[key] !== undefined).map(({ key, label, unit, fill, track }) => {
        const value = Math.round(macros[key]!);
        const r = 16, circ = 2 * Math.PI * r;
        return (
          <div key={key} className="flex flex-col items-center gap-0.5 min-w-0">
            <svg width="40" height="40" viewBox="0 0 40 40" className="max-w-full h-auto">
              <circle cx="20" cy="20" r={r} fill="none" stroke={track} strokeWidth="4" />
              <circle cx="20" cy="20" r={r} fill="none" stroke={fill} strokeWidth="4"
                strokeLinecap="round" strokeDasharray={`${circ * 0.75} ${circ}`}
                transform="rotate(-90 20 20)" />
              <text x="20" y="24" textAnchor="middle" fontSize="8" fontWeight="600" fill="#2c2c2a">
                {value}{unit}
              </text>
            </svg>
            <span className="text-[9px] text-text-muted">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
