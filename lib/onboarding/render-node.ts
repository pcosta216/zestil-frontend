import { getNodeStructure } from "./flow-structure";
import { getNodeContent, sortByOrder } from "./content";
import type { RenderedField, RenderedNode, RenderedOtherCapture } from "./types";

export type { RenderedField };

/**
 * Merges a node's structural definition (flow-structure.yaml — behavior)
 * with its DB content row (tbl_onboarding_content, "node:<id>" — copy) into
 * one renderable object. This is the BASE render only:
 *  - nodes with `options_source` still need resolvers.ts to fill `options`
 *    dynamically (curated lookup / tool tiers / always_merge)
 *  - nodes with `options_filter` still need options-filter.ts to narrow
 *    `options` further and set `disclosure_text`
 * engine.ts composes both on top of this.
 */
export async function renderNodeBase(nodeId: string): Promise<RenderedNode> {
  const structure = getNodeStructure(nodeId);
  const content = await getNodeContent(nodeId);

  const fields: RenderedField[] | undefined = structure.fields?.map((f) => ({
    ...f,
    label: content.fields?.[f.name]?.label,
    options: content.fields?.[f.name]?.options ? sortByOrder(content.fields[f.name].options!) : undefined,
  }));

  const other_capture: RenderedOtherCapture | undefined = structure.other_capture
    ? { ...structure.other_capture, ...content.other_capture }
    : undefined;

  return {
    ...structure,
    ...content,
    options: content.options ? sortByOrder(content.options) : undefined,
    fields,
    other_capture,
  };
}
