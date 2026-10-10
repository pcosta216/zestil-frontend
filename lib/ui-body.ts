// Types and helpers for the agent `ui_body` response field. Contract: docs/UI_BODY_CONTRACT.md

export type UiCallAction = { kind: "call"; endpoint: string; body: Record<string, unknown> };
export type UiToggleAction = { kind: "toggle"; target: string };
// `message` is reserved in v1 and an unknown kind lands here too: both render disabled.
export type UiOtherAction = { kind: "other" };
export type UiAction = UiCallAction | UiToggleAction | UiOtherAction;

export type UiButton = {
  id: string;
  caption: string;
  style?: "primary" | "secondary";
  icon?: string | null;
  // Optional: a button without one is a placeholder and renders disabled (§3.1.4).
  action?: UiAction;
};

export type UiChoiceOption = { caption: string; detail?: string; value: string };

export const MACRO_KEYS = ["kcal", "protein", "carbs", "fat", "sugar", "sodium"] as const;
export type UiMacros = Partial<Record<(typeof MACRO_KEYS)[number], number>>;

export type UiBlock =
  | { type: "text"; style?: string; caption: string }
  | ({ type: "button" } & UiButton)
  | {
      type: "choice";
      id: string;
      caption: string;
      select: "single";
      options: UiChoiceOption[];
      submit: { caption: string; icon?: string | null; action?: UiAction };
    }
  | { type: "button_group"; id: string; caption: string; detail?: string; collapsed?: boolean; buttons: UiButton[] }
  | { type: "nutrition"; id?: string; caption: string; hidden?: boolean; macros: UiMacros }
  | UiSlotBlock;

// Frontend-only, never sent by an agent: the blocks that replaced a `button_group` after one of its
// calls. A call from any control inside it replaces the slot again (§4.3), so it is the scope.
export type UiSlotBlock = { type: "slot"; id: string; blocks: UiBlock[] };

export type UiBody = { version: number; blocks: UiBlock[] };

// A response can never point the UI at an arbitrary URL — only these edge functions may be called.
export const UI_ACTION_ENDPOINTS = ["sides-catalog", "snacks-catalog"];

export const ROOT_SCOPE = "root";

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function parseAction(raw: unknown): UiAction | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.kind === "call" && isStr(raw.endpoint)) {
    return { kind: "call", endpoint: raw.endpoint, body: isObj(raw.body) ? raw.body : {} };
  }
  if (raw.kind === "toggle" && isStr(raw.target)) return { kind: "toggle", target: raw.target };
  return { kind: "other" };
}

function parseButton(raw: unknown): UiButton | undefined {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.caption)) return undefined;
  return {
    id: raw.id,
    caption: raw.caption,
    style: raw.style === "primary" ? "primary" : "secondary",
    icon: isStr(raw.icon) ? raw.icon : null,
    action: parseAction(raw.action),
  };
}

function parseBlock(raw: unknown): UiBlock | undefined {
  if (!isObj(raw) || !isStr(raw.caption)) return undefined;
  switch (raw.type) {
    case "text":
      return { type: "text", style: isStr(raw.style) ? raw.style : undefined, caption: raw.caption };
    case "button": {
      const button = parseButton(raw);
      return button && { type: "button", ...button };
    }
    case "choice": {
      if (!isStr(raw.id) || !Array.isArray(raw.options) || !isObj(raw.submit) || !isStr(raw.submit.caption)) return undefined;
      const options = raw.options
        .filter((o: unknown) => isObj(o) && isStr(o.caption) && isStr(o.value))
        .map((o: any) => ({ caption: o.caption, detail: isStr(o.detail) ? o.detail : undefined, value: o.value }));
      if (!options.length) return undefined;
      return {
        type: "choice",
        id: raw.id,
        caption: raw.caption,
        select: "single",
        options,
        submit: { caption: raw.submit.caption, icon: isStr(raw.submit.icon) ? raw.submit.icon : null, action: parseAction(raw.submit.action) },
      };
    }
    case "button_group": {
      if (!isStr(raw.id) || !Array.isArray(raw.buttons)) return undefined;
      const buttons = raw.buttons.map(parseButton).filter((b: UiButton | undefined): b is UiButton => !!b);
      if (!buttons.length) return undefined;
      return {
        type: "button_group",
        id: raw.id,
        caption: raw.caption,
        detail: isStr(raw.detail) ? raw.detail : undefined,
        collapsed: raw.collapsed === true,
        buttons,
      };
    }
    case "nutrition": {
      if (!isObj(raw.macros)) return undefined;
      // A missing key is not shown; a 0 that is sent is (§3.1.5). Unknown keys are ignored.
      const macros: UiMacros = {};
      for (const key of MACRO_KEYS) {
        const v = raw.macros[key];
        if (typeof v === "number" && Number.isFinite(v)) macros[key] = v;
      }
      return { type: "nutrition", id: isStr(raw.id) ? raw.id : undefined, caption: raw.caption, hidden: raw.hidden === true, macros };
    }
    default:
      return undefined; // unknown block types are skipped, not errors (§3)
  }
}

// Returns undefined when nothing renderable is left.
export function parseUiBody(raw: unknown): UiBody | undefined {
  if (!isObj(raw) || !Array.isArray(raw.blocks)) return undefined;
  const blocks = raw.blocks.map(parseBlock).filter((b: UiBlock | undefined): b is UiBlock => !!b);
  return blocks.length ? { version: Number(raw.version) || 1, blocks } : undefined;
}

// Text that is the confirmation itself, as opposed to a header over a list. The model's own sentence
// is shown only when there is none (§5.2: the text block is the authoritative confirmation).
export function hasBodyText(blocks: UiBlock[]): boolean {
  return blocks.some((b) => b.type === "text" && b.style !== "header" && b.style !== "sub_header");
}

export function isAllowedCall(action: UiAction | undefined): action is UiCallAction {
  return action?.kind === "call" && UI_ACTION_ENDPOINTS.includes(action.endpoint);
}

export function findNutrition(blocks: UiBlock[], id: string) {
  return blocks.find((b): b is Extract<UiBlock, { type: "nutrition" }> => b.type === "nutrition" && b.id === id);
}

function toggleTargetsOf(group: Extract<UiBlock, { type: "button_group" }>): string[] {
  return group.buttons.flatMap((b) => (b.action?.kind === "toggle" ? [b.action.target] : []));
}

// Only a string that is exactly "{value}" is replaced (contract §4.2).
export function substituteValue(body: Record<string, unknown>, value: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "{value}" ? value : v]));
}

export function groupScope(groupId: string): string {
  return `g:${groupId}`;
}

// What a call's reply replaces is its scope (§4.3): the whole ui_body, or one `button_group`. The
// replacement becomes that group's slot, and a call from inside the slot replaces the slot again.
// Panels the group's toggle buttons showed go with it.
export function applyReply(prev: UiBody, scope: string, reply: UiBody): UiBody {
  if (scope === ROOT_SCOPE) return reply;
  const idx = prev.blocks.findIndex((b) => (b.type === "button_group" || b.type === "slot") && groupScope(b.id) === scope);
  if (idx === -1) return prev;
  const target = prev.blocks[idx];
  if (target.type === "slot") {
    const blocks = [...prev.blocks];
    blocks[idx] = { ...target, blocks: reply.blocks };
    return { ...prev, blocks };
  }
  if (target.type !== "button_group") return prev;
  const gone = new Set(toggleTargetsOf(target));
  const blocks = prev.blocks.flatMap((b, i): UiBlock[] => {
    if (i === idx) return [{ type: "slot", id: target.id, blocks: reply.blocks }];
    if (b.type === "nutrition" && b.id && gone.has(b.id)) return [];
    return [b];
  });
  return { ...prev, blocks };
}
