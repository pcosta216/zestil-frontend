import type { ReactNode } from "react";
import type { ProfileSection } from "@/lib/profile";

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

/** A read-only card: tags for a list, text for a single value, the muted `empty` for nothing. */
export function ProfileSectionCard({ section }: { section: ProfileSection }) {
  return (
    <ProfileCard title={section.title}>
      <div className="mt-1">
        {section.rows.map((row) => (
          <div key={row.label} className={PROFILE_DIVIDER}>
            <div className={PROFILE_ROW}>
              <span className="text-sm text-text-muted flex-shrink-0">{row.label}</span>
              {row.items?.length ? (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {row.items.map((item, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-lg text-[12px] bg-warm text-text-main text-right">
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <span className={`text-sm text-right ${row.text ? "text-text-main" : "text-text-muted"}`}>{row.text ?? row.empty}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </ProfileCard>
  );
}
