// Types and helpers for the agent `ui_body` response field. Contract: docs/UI_BODY_CONTRACT.md

export type UiCallAction = { kind: "call"; endpoint: string; body: Record<string, unknown> };
export type UiToggleAction = { kind: "toggle"; target: string };
// Swaps the action's scope for `blocks`, on the device only (§4.6). `[]` removes the scope.
export type UiReplaceAction = { kind: "replace"; blocks: UiBlock[] };
// Puts back what the scope held before the last local `replace`, on the device only (§4.7). Disabled
// when nothing was kept.
export type UiRevertAction = { kind: "revert" };
// `message` is reserved in v1 and an unknown kind lands here too: both render disabled.
export type UiOtherAction = { kind: "other" };
export type UiAction = UiCallAction | UiToggleAction | UiReplaceAction | UiRevertAction | UiOtherAction;

export type UiButton = {
  id: string;
  caption: string;
  style?: "primary" | "secondary";
  icon?: string | null;
  // Groups only: when present the button is a switch showing this state (§3.1.4).
  state?: boolean;
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
      // The option whose `value` is already the current one, as a string. Absent, or matching no option,
      // means nothing starts selected. Save is only worth pressing for a different option.
      selected?: string;
      submit: { caption: string; icon?: string | null; action?: UiAction };
      // A second button on the submit's line (a call or a `replace`, never `{value}`), same scope as the submit.
      cancel?: { caption: string; icon?: string | null; action?: UiAction };
    }
  | { type: "button_group"; id: string; caption: string; detail?: string; collapsed?: boolean; buttons: UiButton[] }
  | { type: "nutrition"; id?: string; caption: string; hidden?: boolean; macros: UiMacros }
  // A collapsible header that contains its blocks. One level only: a section never holds a section (§3.1.6).
  | { type: "section"; id: string; caption: string; detail?: string; collapsed?: boolean; blocks: UiBlock[] }
  | UiNotice
  | UiSlotBlock;

// A note or warning behind its icon (§3.1.7): collapsed, the icon is all there is. It has no `id`.
export const NOTICE_TONES = ["info", "warning", "forbidden", "critical"] as const;
export type UiTone = (typeof NOTICE_TONES)[number];
export type UiNotice = {
  type: "notice";
  tone: UiTone;
  // Required by the contract; "" here means it was missing, and the tone's fallback icon is used.
  icon: string;
  title?: string;
  caption: string;
  format: "plain" | "markdown";
  collapsed: boolean;
};

// Frontend-only, never sent by an agent: the blocks that replaced a `button_group` after one of its
// calls. A call from any control inside it replaces the slot again (§4.3), so it is the scope.
//
// `previous` is what the last local `replace` swapped out of it, for `revert` (§4.7): one level, only
// the latest swap. It is written by the same state update that does the swap, and a call's reply
// replaces the slot without it, so a stale row can never come back.
export type UiSlotBlock = { type: "slot"; id: string; blocks: UiBlock[]; previous?: UiBlock[] };

// `previous` is the same thing for a scope that is the whole body (a `replace` on a body-level button).
export type UiBody = { version: number; blocks: UiBlock[]; previous?: UiBlock[] };

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
  // A replace without a block list is malformed, not "remove everything": it renders disabled.
  if (raw.kind === "replace" && Array.isArray(raw.blocks)) return { kind: "replace", blocks: parseBlocks(raw.blocks) };
  if (raw.kind === "revert") return { kind: "revert" };
  return { kind: "other" };
}

function parseButton(raw: unknown): UiButton | undefined {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.caption)) return undefined;
  return {
    id: raw.id,
    caption: raw.caption,
    style: raw.style === "primary" ? "primary" : "secondary",
    icon: isStr(raw.icon) ? raw.icon : null,
    state: typeof raw.state === "boolean" ? raw.state : undefined,
    action: parseAction(raw.action),
  };
}

function parseBlocks(raw: unknown[]): UiBlock[] {
  return raw.map(parseBlock).filter((b): b is UiBlock => !!b);
}

// A renderer skips an unknown block type, but a warning that vanishes does real harm (§3.1.7), so a
// notice is kept whenever it has anything to say: a missing icon falls back to the tone's, an unknown
// tone is "info". Only one with neither a title nor a caption is dropped.
function parseNotice(raw: Record<string, any>): UiNotice | undefined {
  const title = isStr(raw.title) && raw.title ? raw.title : undefined;
  const caption = isStr(raw.caption) ? raw.caption : "";
  if (!title && !caption) return undefined;
  return {
    type: "notice",
    tone: (NOTICE_TONES as readonly string[]).includes(raw.tone) ? raw.tone : "info",
    icon: isStr(raw.icon) ? raw.icon : "",
    title,
    caption,
    format: raw.format === "markdown" ? "markdown" : "plain",
    collapsed: raw.collapsed !== false, // unlike every other block, collapsed is the default
  };
}

function parseBlock(raw: unknown): UiBlock | undefined {
  if (isObj(raw) && raw.type === "notice") return parseNotice(raw);
  if (!isObj(raw) || !isStr(raw.caption)) return undefined;
  switch (raw.type) {
    case "text":
      return { type: "text", style: isStr(raw.style) ? raw.style : undefined, caption: raw.caption };
    case "button": {
      const button = parseButton(raw);
      // `state` makes a switch, and switches exist in groups only (§3.1.4).
      return button && { type: "button", ...button, state: undefined };
    }
    case "choice": {
      if (!isStr(raw.id) || !Array.isArray(raw.options) || !isObj(raw.submit) || !isStr(raw.submit.caption)) return undefined;
      const options = raw.options
        .filter((o: unknown) => isObj(o) && isStr(o.caption) && isStr(o.value))
        .map((o: any) => ({ caption: o.caption, detail: isStr(o.detail) ? o.detail : undefined, value: o.value }));
      if (!options.length) return undefined;
      const cancel = isObj(raw.cancel) && isStr(raw.cancel.caption)
        ? { caption: raw.cancel.caption, icon: isStr(raw.cancel.icon) ? raw.cancel.icon : null, action: parseAction(raw.cancel.action) }
        : undefined;
      return {
        type: "choice",
        id: raw.id,
        caption: raw.caption,
        select: "single",
        options,
        // Values are compared as strings (never by index or caption), so a number the agent sent is its string.
        selected: raw.selected === undefined || raw.selected === null ? undefined : String(raw.selected),
        submit: { caption: raw.submit.caption, icon: isStr(raw.submit.icon) ? raw.submit.icon : null, action: parseAction(raw.submit.action) },
        cancel,
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
    case "section": {
      if (!isStr(raw.id) || !Array.isArray(raw.blocks)) return undefined;
      return {
        type: "section",
        id: raw.id,
        caption: raw.caption,
        detail: isStr(raw.detail) ? raw.detail : undefined,
        collapsed: raw.collapsed === true,
        // One level only (§3.1.6): a section inside a section is skipped like any unknown block.
        blocks: parseBlocks(raw.blocks).filter((b) => b.type !== "section"),
      };
    }
    default:
      return undefined; // unknown block types are skipped, not errors (§3)
  }
}

// Returns undefined when nothing renderable is left.
export function parseUiBody(raw: unknown): UiBody | undefined {
  if (!isObj(raw) || !Array.isArray(raw.blocks)) return undefined;
  const blocks = parseBlocks(raw.blocks);
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

// Only a string that is exactly "{value}" is replaced (§4.2): by the chosen option for a choice, and by
// the new state, as a JSON boolean, for a switch.
export function substituteValue(body: Record<string, unknown>, value: string | boolean): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "{value}" ? value : v]));
}

export function groupScope(groupId: string): string {
  return `g:${groupId}`;
}

// Finds the group or slot whose scope this is, in the list or in a section of it (one level), and
// swaps it for `blocks`. A group becomes a slot, and the panels its toggle buttons showed go with it.
// No blocks removes the scope outright (§4.6). Returns undefined when the scope isn't in the list.
//
// `keep` is given for a local `replace` and not for a call's reply: it turns what is being swapped out
// into the copy stored on the slot for `revert`. For a group, what is swapped out is the group and
// its panels; for a slot, the slot's blocks.
function replaceInList(list: UiBlock[], scope: string, blocks: UiBlock[], keep?: (old: UiBlock[]) => UiBlock[]): UiBlock[] | undefined {
  const idx = list.findIndex((b) => (b.type === "button_group" || b.type === "slot") && groupScope(b.id) === scope);
  if (idx !== -1) {
    const target = list[idx];
    if (target.type === "slot") {
      const next = [...list];
      if (!blocks.length) next.splice(idx, 1);
      else next[idx] = { type: "slot", id: target.id, blocks, ...(keep ? { previous: keep(target.blocks) } : {}) };
      return next;
    }
    if (target.type !== "button_group") return undefined;
    const gone = new Set(toggleTargetsOf(target));
    const panels = list.filter((b) => b.type === "nutrition" && !!b.id && gone.has(b.id));
    return list.flatMap((b, i): UiBlock[] => {
      if (i === idx) return blocks.length ? [{ type: "slot", id: target.id, blocks, ...(keep ? { previous: keep([target, ...panels]) } : {}) }] : [];
      if (b.type === "nutrition" && b.id && gone.has(b.id)) return [];
      return [b];
    });
  }
  for (let i = 0; i < list.length; i++) {
    const section = list[i];
    if (section.type !== "section") continue;
    const inner = replaceInList(section.blocks, scope, blocks, keep);
    if (inner) {
      const next = [...list];
      next[i] = { ...section, blocks: inner };
      return next;
    }
  }
  return undefined;
}

function swap(prev: UiBody, scope: string, blocks: UiBlock[], version: number, keep?: (old: UiBlock[]) => UiBlock[]): UiBody {
  if (scope === ROOT_SCOPE) return { version, blocks, ...(keep ? { previous: keep(prev.blocks) } : {}) };
  const next = replaceInList(prev.blocks, scope, blocks, keep);
  return next ? { ...prev, blocks: next } : prev;
}

// What a call's reply does to its scope (§4.3): the whole ui_body, or one `button_group`. The
// replacement becomes that group's slot, and a call from inside the slot replaces the slot again
// (Remove → Undo → "Restored" in the same place). It keeps nothing for `revert`: a reply means what
// was there is stale.
export function applyBlocks(prev: UiBody, scope: string, blocks: UiBlock[], version = prev.version): UiBody {
  return swap(prev, scope, blocks, version);
}

export function applyReply(prev: UiBody, scope: string, reply: UiBody): UiBody {
  return applyBlocks(prev, scope, reply.blocks, reply.version);
}

// A local `replace` (§4.6): the same swap, but what it swaps out is kept, for `revert` (§4.7). Only the
// latest swap is kept. `bake` lets the caller fold in what the user could see (an expanded row, a
// shown panel) that the blocks themselves don't say.
export function applyReplace(prev: UiBody, scope: string, blocks: UiBlock[], bake: (old: UiBlock[]) => UiBlock[] = (b) => b): UiBody {
  return swap(prev, scope, blocks, prev.version, bake);
}

// What a scope has kept for `revert`, if anything.
export function previousOf(body: UiBody, scope: string): UiBlock[] | undefined {
  if (scope === ROOT_SCOPE) return body.previous;
  const find = (list: UiBlock[]): UiBlock[] | undefined => {
    for (const b of list) {
      if (b.type === "slot" && groupScope(b.id) === scope) return b.previous;
      if (b.type === "section") { const inner = find(b.blocks); if (inner) return inner; }
    }
    return undefined;
  };
  return find(body.blocks);
}

// `revert` (§4.7): put back what the last local `replace` swapped out, and forget it. A scope that kept
// nothing is left as it is.
export function applyRevert(prev: UiBody, scope: string): UiBody {
  const kept = previousOf(prev, scope);
  return kept ? applyBlocks(prev, scope, kept) : prev;
}
