// Types and helpers for the agent `ui_body` response field. Contract: docs/UI_BODY_CONTRACT.md

export type UiAction = { kind: "call"; endpoint: string; body: Record<string, unknown> };

export type UiChoiceOption = { caption: string; detail?: string; value: string };

export type UiBlock =
  | { type: "text"; caption: string }
  | { type: "button"; id: string; caption: string; style?: "primary" | "secondary"; action: UiAction }
  | {
      type: "choice";
      id: string;
      caption: string;
      select: "single";
      options: UiChoiceOption[];
      submit: { caption: string; action: UiAction };
    };

export type UiBody = { version: number; blocks: UiBlock[] };

// A response can never point the UI at an arbitrary URL — only these edge functions may be called.
export const UI_ACTION_ENDPOINTS = ["sides-catalog"];

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

// Unknown block types are skipped, not errors (contract §3). Returns undefined when nothing renderable is left.
export function parseUiBody(raw: unknown): UiBody | undefined {
  if (!isObj(raw) || !Array.isArray(raw.blocks)) return undefined;
  const blocks = raw.blocks.filter((b): b is UiBlock => {
    if (!isObj(b) || typeof b.caption !== "string") return false;
    if (b.type === "text") return true;
    if (b.type === "button") return typeof b.id === "string" && isObj(b.action);
    if (b.type === "choice")
      return typeof b.id === "string" && Array.isArray(b.options) && isObj(b.submit) && isObj(b.submit.action);
    return false;
  });
  return blocks.length ? { version: Number(raw.version) || 1, blocks } : undefined;
}

export function isAllowedAction(action: UiAction): boolean {
  return action?.kind === "call" && UI_ACTION_ENDPOINTS.includes(action.endpoint);
}

// Only a string that is exactly "{value}" is replaced (contract §4.2).
export function substituteValue(body: Record<string, unknown>, value: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "{value}" ? value : v]));
}
