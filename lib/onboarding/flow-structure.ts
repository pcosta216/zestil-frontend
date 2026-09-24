import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { FlowStructure, FlowNodeStructure } from "./types";

// Server-only — reads content/onboarding/flow-structure.yaml off disk once
// per process and caches it. This file is deploy-time content (structural/
// logic fields only — see its own header), not runtime-editable, so a plain
// module-level cache with no TTL/invalidation is correct here, unlike
// content.ts's DB-backed loader.

let cached: FlowStructure | null = null;

function load(): FlowStructure {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "content", "onboarding", "flow-structure.yaml");
  const raw = readFileSync(filePath, "utf8");
  const parsed = parse(raw) as FlowStructure;
  cached = parsed;
  return parsed;
}

export function getFlowStructure(): FlowStructure {
  return load();
}

export function getNodeStructure(nodeId: string): FlowNodeStructure {
  const node = load().nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`Unknown onboarding node id: "${nodeId}"`);
  return node;
}

export function getEntryNodeId(): string {
  return load().meta.entry_node;
}
