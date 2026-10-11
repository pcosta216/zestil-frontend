import type { UiCallAction } from "@/lib/ui-body";

// "Stop suggesting this item": the catalog call a plan card offers for a side or a snack entry. The reply
// is the endpoint's own ui_body (a sentence and an Undo), shown inside the card.
export interface StopSuggesting {
  caption: string;
  action:  UiCallAction;
}

// What "stop suggesting" means depends on the catalog: a snack stays on the user's list but the optimizer
// stops picking it (Auto off), while a side is removed from the user's sides. Recipes and ingredients have
// no catalog item, so no button, and neither does an entry that does not say which item it is.
export function stopSuggestingFor(card: { entry_type?: string; catalog_uuid?: string | null }): StopSuggesting | undefined {
  if (!card.catalog_uuid) return undefined;
  if (card.entry_type === "snack") {
    return { caption: "Stop suggesting", action: { kind: "call", endpoint: "snacks-catalog", body: { action: "set_auto", snack_uuid: card.catalog_uuid, auto: false } } };
  }
  if (card.entry_type === "side") {
    return { caption: "Remove from my sides", action: { kind: "call", endpoint: "sides-catalog", body: { action: "remove", side_uuid: card.catalog_uuid } } };
  }
  return undefined;
}
