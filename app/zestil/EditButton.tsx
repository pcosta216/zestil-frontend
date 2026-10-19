// The pencil that opens an edit in place: the Profile tab's name (ProfileTab) and its "About you"
// card (BiometricsCard) draw it from here, so the two can't drift apart.
export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="p-1 rounded-full text-text-muted hover:text-green-primary transition-colors"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    </button>
  );
}
