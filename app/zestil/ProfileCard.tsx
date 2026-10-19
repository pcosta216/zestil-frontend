import type { ReactNode } from "react";
import type { ProfileGroup, ProfileSection } from "@/lib/profile";

// The Profile tab's cards: "About you" (BiometricsCard) and the read-only sections share this
// frame and row shape, so they read as one list.

/** Label left, value right, tall enough for BiometricsCard's inline controls. */
export const PROFILE_ROW = "w-full min-h-[44px] flex items-center justify-between gap-4 py-1.5 text-left";
export const PROFILE_DIVIDER = "border-t border-[rgba(0,0,0,0.06)] first:border-t-0";

export function ProfileCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-3">
      <div className="flex items-center justify-between min-h-6">
        <h2 className="font-display text-base text-text-main">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const TAG = "px-2 py-0.5 rounded-lg text-[12px] bg-warm text-text-main text-right";

function Tags({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {items.map((item, i) => (
        <span key={i} className={TAG}>
          {item}
        </span>
      ))}
    </div>
  );
}

/** Fixed meals: each day as a header, its meals under it as sub-headers with their titles as tags. */
function Groups({ groups }: { groups: ProfileGroup[] }) {
  return (
    <div className="mt-2 flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-sm font-medium text-text-main">{group.label}</p>
          <div className="mt-1 pl-3 flex flex-col gap-1.5">
            {group.entries.map((entry) => (
              <div key={entry.label} className="flex items-baseline justify-between gap-3">
                <span className="flex-shrink-0 text-sm text-text-muted">{entry.label}</span>
                <Tags items={entry.items} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A read-only card: tags for a list, a table for groups, text for a single value, the muted `empty` for nothing. */
export function ProfileSectionCard({ section }: { section: ProfileSection }) {
  return (
    <ProfileCard title={section.title}>
      <div className="mt-1">
        {section.rows.map((row) => (
          <div key={row.label} className={PROFILE_DIVIDER}>
            {row.groups?.length ? (
              // Too wide to share a line with the label, so the table sits under it.
              <div className="py-2.5">
                <span className="text-sm text-text-muted">{row.label}</span>
                <Groups groups={row.groups} />
              </div>
            ) : (
              <div className={PROFILE_ROW}>
                <span className="text-sm text-text-muted flex-shrink-0">{row.label}</span>
                {row.items?.length ? (
                  <Tags items={row.items} />
                ) : (
                  <span className={`text-sm text-right ${row.text ? "text-text-main" : "text-text-muted"}`}>{row.text ?? row.empty}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </ProfileCard>
  );
}
