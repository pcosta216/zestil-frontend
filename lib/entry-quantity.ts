// entry-quantity.ts
// Frontend mirror of supabase/functions/_shared/entry-quantity.ts in the agent repo.
// Kept as a copy because the two repos share no build. If you change the convention,
// change it in BOTH places.
//
// The convention for ingredient-shaped plan entries:
//   quantity_g column                 → the CURRENT amount on the plate
//   adjusted_snapshot.original_qty_g  → what it was before the FIRST adjustment
//
// Both readers tolerate legacy rows written before 2026-09-03, when the optimizer left
// quantity_g at the original and put the current amount in adjusted_snapshot.adjusted_qty_g
// (a key nothing ever read). See OPTIMIZER_AGENT.md §11.1.

const DEFAULT_QTY_G = 100;

function positive(v: unknown): number | null {
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) && n > 0 ? n : null;
}

/** The amount currently on the plate — what a card should display. */
export function currentQtyG(entry: any): number {
  // LEGACY: remove once 20260903_entry_quantity_convention.sql has been applied.
  const legacy = positive(entry?.adjusted_snapshot?.adjusted_qty_g);
  if (legacy !== null) return legacy;

  return positive(entry?.quantity_g) ?? DEFAULT_QTY_G;
}

/** The amount originally planned — the baseline behind the "original" toggle. */
export function originalQtyG(entry: any): number {
  const stamped = positive(entry?.adjusted_snapshot?.original_qty_g);
  if (stamped !== null) return stamped;

  // No stamp means either never-adjusted or legacy — in both cases the column is original.
  return positive(entry?.quantity_g) ?? DEFAULT_QTY_G;
}
