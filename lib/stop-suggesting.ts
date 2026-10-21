import type { UiCallAction } from "@/lib/ui-body";

// "Stop suggesting this item": the catalog call a plan card offers for a side, snack or breakfast entry. The reply
// is the endpoint's own ui_body (a sentence and an Undo), shown inside the card.
export interface StopSuggesting {
  caption: string;
  action:  UiCallAction;
}

// Which catalog item an entry is. A card read from the plan tables has it as `catalog_uuid` (plan-card.ts). A
// card in a chat reply is built by the agent, which sends no such field, but its `metadata` is the entry's
// snapshot, and that carries the item's own uuid (`snack_uuid` / `side_uuid` / `breakfast_uuid`).
type CardLike = { entry_type?: string; catalog_uuid?: string | null; source_uuid?: string | null; metadata?: Record<string, any> | null };

function catalogUuid(card: CardLike): string | undefined {
  const own = card.catalog_uuid ?? card.source_uuid;
  if (own) return own;
  const snap = card.metadata;
  const fromSnap = card.entry_type === "snack" ? snap?.snack_uuid
    : card.entry_type === "side" ? snap?.side_uuid
    : card.entry_type === "breakfast" ? snap?.breakfast_uuid
    : undefined;
  return typeof fromSnap === "string" && fromSnap ? fromSnap : undefined;
}

// What "stop suggesting" means depends on the catalog: a snack or a breakfast item stays on the user's list
// but the planner stops picking it (Auto off), while a side is removed from the user's sides. Recipes and
// ingredients have no catalog item, so no button, and neither does an entry that does not say which item it
// is. A recipe item at breakfast is a plain recipe entry, so it gets none either.
export function stopSuggestingFor(card: CardLike): StopSuggesting | undefined {
  const uuid = catalogUuid(card);
  if (!uuid) return undefined;
  if (card.entry_type === "snack") {
    return { caption: "Stop suggesting", action: { kind: "call", endpoint: "snacks-catalog", body: { action: "set_auto", snack_uuid: uuid, auto: false } } };
  }
  if (card.entry_type === "breakfast") {
    return { caption: "Stop suggesting", action: { kind: "call", endpoint: "breakfasts-catalog", body: { action: "set_auto", breakfast_uuid: uuid, auto: false } } };
  }
  if (card.entry_type === "side") {
    return { caption: "Remove from my sides", action: { kind: "call", endpoint: "sides-catalog", body: { action: "remove", side_uuid: uuid } } };
  }
  return undefined;
}
