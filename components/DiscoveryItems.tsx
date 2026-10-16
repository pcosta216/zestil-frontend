import { Check, LoaderCircle, X } from "@/lib/icons";

// The request list shared by every recipe-search progress screen: onboarding's last screen
// (memory_json.onboarding.recipe_discovery) and the diet search (memory_json.diet_search.items)
// write the same item shape, so one renderer serves both. See docs/app/onboarding/discovery_progress.md
// for what each mark means and why a completed request carries none of its own.

/** One recipe the job kept for a request. */
export interface DiscoveryRecipe {
  uuid?: string;
  title?: string;
  saved?: boolean;
}

/** One request the job searched for. Every field but `name` can be absent mid-run. */
export interface DiscoveryItem {
  name?: string;
  type?: string; // "fill" marks the top-up bucket ("More recipes for you")
  status?: string;
  error?: string; // only on a failure, e.g. "Explore failed: The operation was aborted due to timeout"
  found?: number;
  saved?: number;
  accepted?: number;
  rejected?: number;
  recipes?: DiscoveryRecipe[];
}

/**
 * Normalised per-request state.
 *
 * Case and separators are normalised before matching rather than the exact strings being
 * trusted: onboarding writes "in progress", the diet search writes "in_process". An unrecognised
 * value reads as waiting — the neutral state, never a false green tick.
 */
export type RequestState = "complete" | "failed" | "running" | "waiting";
export function requestState(status: string | undefined): RequestState {
  const s = String(status ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (s === "complete" || s === "completed") return "complete";
  if (s === "failed" || s === "fail" || s === "error") return "failed";
  if (s === "inprogress" || s === "inprocess" || s === "running" || s === "started") return "running";
  return "waiting";
}

/**
 * The leading marker on a REQUEST row.
 *
 * A completed request gets no mark of its own: what it produced is the recipes listed beneath
 * it, and each of those carries its own tick. The slot is still rendered so every row's name
 * starts at the same x.
 */
export function RequestIcon({ state }: { state: RequestState }) {
  if (state === "failed") {
    return (
      <span className="shrink-0 w-5 h-5 rounded-full bg-red-600 flex items-center justify-center" aria-label="failed">
        <X size={13} strokeWidth={3} className="text-white" />
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="shrink-0 w-5 h-5 flex items-center justify-center" aria-label="in progress">
        <LoaderCircle size={18} className="text-green-primary animate-spin" />
      </span>
    );
  }
  if (state === "waiting") {
    return (
      <span className="shrink-0 w-5 h-5 flex items-center justify-center" aria-label="waiting">
        <span className="w-2.5 h-2.5 rounded-full border-2 border-[rgba(0,0,0,0.18)]" />
      </span>
    );
  }
  return <span className="shrink-0 w-5 h-5" aria-hidden="true" />;
}

/** "17 found · 2 saved" — only the parts the job has actually reported. */
function countLine(item: DiscoveryItem): string | null {
  const parts: string[] = [];
  if (typeof item.found === "number") parts.push(`${item.found} found`);
  const saved = item.saved ?? item.accepted;
  if (typeof saved === "number") parts.push(`${saved} saved`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function DiscoveryItems({ items }: { items: DiscoveryItem[] }) {
  return (
    <ul className="flex flex-col gap-2 mb-6">
      {items.map((item, i) => {
        const state = requestState(item.status);
        const counts = countLine(item);
        const recipes = (item.recipes ?? []).filter((r) => typeof r.title === "string" && r.title.length > 0);
        return (
          <li
            key={`${item.name ?? "request"}:${i}`}
            className="rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-4 py-3"
          >
            {/* The request the job was given — a header for the recipes it produced. */}
            <div className="flex items-center gap-3">
              <RequestIcon state={state} />
              <span className="text-sm text-text-main flex-1 min-w-0 truncate">{item.name ?? "Recipes"}</span>
              {counts && <span className="text-[11px] text-text-muted shrink-0">{counts}</span>}
            </div>

            {/* What matched it. The tick is trailing and belongs to the RECIPE: it marks this
                dish as found and saved, which is the thing that actually happened. */}
            {recipes.length > 0 && (
              <ul className="mt-2 pl-8 flex flex-col gap-1.5">
                {recipes.map((recipe, r) => (
                  <li key={recipe.uuid ?? `${recipe.title}:${r}`} className="flex items-start gap-2">
                    <span className="text-xs text-text-muted leading-snug flex-1 min-w-0">{recipe.title}</span>
                    {recipe.saved === true && (
                      <span
                        className="shrink-0 w-4 h-4 mt-px rounded-full bg-green-primary flex items-center justify-center"
                        aria-label="saved"
                      >
                        <Check size={10} strokeWidth={3} className="text-white" />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* The job's own words when it failed — far more use than copy we invent. */}
            {state === "failed" && (
              <p className="mt-1.5 pl-8 text-xs text-text-muted leading-snug">
                {item.error ?? "Nothing usable came back for this one."}
              </p>
            )}

            {/* Completed, but nothing matched. Without this the row is a bare name and reads as
                still-pending. */}
            {state === "complete" && recipes.length === 0 && (
              <p className="mt-1.5 pl-8 text-xs text-text-muted">No matches saved for this one.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
