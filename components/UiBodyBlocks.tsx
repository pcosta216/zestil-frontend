"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/browser";
import { MacroRings } from "@/components/MacroRings";
import { MiniMarkdown } from "@/components/MiniMarkdown";
import { ArrowLeftRight, Ban, Check, ChevronDown, Info, Pencil, Plus, ToggleRight, Trash2, TriangleAlert, Undo2, X } from "@/lib/icons";
import {
  ROOT_SCOPE, applyBlocks, findNutrition, groupScope, isAllowedCall, parseUiBody, substituteValue,
  type UiBlock, type UiBody, type UiButton, type UiCallAction, type UiTone,
} from "@/lib/ui-body";

// The closed icon set (contract §3.2). An unknown name renders no icon.
const ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  trash: Trash2, edit: Pencil, toggle: ToggleRight, undo: Undo2, info: Info,
  check: Check, cross: X, alert: TriangleAlert, plus: Plus, swap: ArrowLeftRight, block: Ban,
};

const PILL = "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11.5px] font-medium border transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed";
// A group's buttons share one row as equal-width cells, icon over label: four labelled pills need
// ~350px, so in a phone-width bubble they wrapped into rows of different lengths.
const CELL = "flex flex-col items-center justify-center gap-0.5 min-w-0 px-1 py-1.5 rounded-lg text-[10px] font-medium leading-tight text-center whitespace-nowrap border transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed";
const GROUP_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" };
const PILL_SECONDARY = "bg-green-light border-green-border text-green-primary enabled:hover:bg-green-border";
const PILL_PRIMARY = "bg-green-primary border-green-primary text-white enabled:hover:bg-green-dark";
// The recipe card's action colours (WeekdayRecipeCard): delete red, info blue, "more" grey. The yellow
// is the one WeekdayGrid's rings turn at 115% of a goal.
const RED = "bg-red-500 border-red-500 text-white enabled:hover:bg-red-600 enabled:hover:border-red-600";
const BLUE = "bg-[#23BCFD] border-[#23BCFD] text-white enabled:hover:bg-[#0ea5d6] enabled:hover:border-[#0ea5d6]";
const GREY = "bg-gray-400 border-gray-400 text-white enabled:hover:bg-gray-500 enabled:hover:border-gray-500";
const YELLOW = "bg-[#f9cb16] border-[#f9cb16] text-text-main enabled:hover:bg-[#e6b800] enabled:hover:border-[#e6b800]";
// The colour follows the icon's meaning, never the payload (contract §3.2): trash red, edit grey,
// info blue, alert yellow. The rest (toggle, undo, check, cross, plus, swap, block) are "open" there
// and keep the green style. It replaces the style's green, so a `trash` button is red whether primary
// or not.
const TONES: Record<string, string> = { trash: RED, edit: GREY, info: BLUE, alert: YELLOW };
const CARD = "bg-[#faf9f6] border border-[rgba(0,0,0,0.07)] rounded-lg";

// A notice is drawn in its tone's colour, icon included, whatever the icon is (§3.1.7): the icon is
// the tone's colour, and the open panel is tinted with it. `info` and `forbidden` are "open" there (no
// colour decided), so they use the neutral default until the contract picks one. The amber and red are
// the ones the app already uses for a warning pill and a delete.
const NEUTRAL = { icon: "text-text-muted", panel: "bg-[#faf9f6] border-[rgba(0,0,0,0.07)]" };
const NOTICE_TONES: Record<UiTone, { icon: string; panel: string; fallback: string }> = {
  info:      { ...NEUTRAL, fallback: "info" },
  warning:   { icon: "text-amber-600", panel: "bg-amber-50 border-amber-200", fallback: "alert" },
  forbidden: { ...NEUTRAL, fallback: "block" },
  critical:  { icon: "text-red-500", panel: "bg-red-50 border-red-200", fallback: "alert" },
};

type NutritionBlock = Extract<UiBlock, { type: "nutrition" }>;

const key = (scope: string, id: string) => `${scope}|${id}`;

function without<T>(rec: Record<string, T>, k: string): Record<string, T> {
  const next = { ...rec };
  delete next[k];
  return next;
}

function Spinner({ size = 12 }: { size?: number }) {
  return <span className="rounded-full border-[1.5px] border-current border-t-transparent animate-spin inline-block" style={{ width: size, height: size }} />;
}

// Renders the agent's `ui_body` blocks. The caller supplies the chat bubble around them (PlanTab's
// UiBodyBubble), so text inherits the bubble's typography. A call's reply, or a `replace` action,
// swaps its scope (the whole body, or one button_group — contract §4.3, §4.6) through onChange.
//
// State is keyed by scope + id, never by the bare id: an endpoint's reply uses fixed ids (`undo`), so
// two removed snacks each hold their own `undo` (§4.3).
export function UiBodyBlocks({ uiBody, onChange }: { uiBody: UiBody; onChange: (update: (prev: UiBody) => UiBody) => void }) {
  const [pending,  setPending]  = useState<Record<string, string>>({});  // scope → the control that was pressed
  const [errors,   setErrors]   = useState<Record<string, string>>({});  // scope → inline error
  const [selected, setSelected] = useState<Record<string, string>>({});  // choice → chosen option value
  const [open,     setOpen]     = useState<Record<string, boolean>>({}); // collapsed section / group → expanded
  const [shown,    setShown]    = useState<Record<string, boolean>>({}); // nutrition block → shown
  const [sw,       setSw]       = useState<Record<string, boolean>>({}); // switch → state flipped before its reply

  const anyPending = Object.keys(pending).length > 0;
  // Every control in a scope is disabled while that scope has a call in flight (§4.1). A group's
  // scope is its own, so the rest of the body stays usable; the whole-body scope waits for them all,
  // since its reply would replace the groups.
  const busy = (scope: string) => (scope === ROOT_SCOPE ? anyPending : !!pending[scope] || !!pending[ROOT_SCOPE]);

  // `value` is what replaces "{value}" in the body: the chosen option, or a switch's new state (§4.2).
  // `switchKey` marks a switch's call, which is stricter than the general reply rules (§3.1.4): only a
  // reply with a ui_body counts, and anything else flips the switch back with an inline error.
  async function runCall(scope: string, control: string, action: UiCallAction, value?: string | boolean, switchKey?: string) {
    if (busy(scope) || !isAllowedCall(action)) return;
    setPending((p) => ({ ...p, [scope]: control }));
    setErrors((e) => without(e, scope));
    let reason: string | undefined;
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("no session");
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${action.endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(value === undefined ? action.body : substituteValue(action.body, value)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const message = typeof data.message === "string" && data.message ? data.message : undefined;
      const fromBody = parseUiBody(data.ui_body);
      if (switchKey && (data.ok === false || !fromBody)) {
        reason = message;
        throw new Error("switch call failed");
      }
      const reply: UiBody | undefined = fromBody ?? (message ? { version: 1, blocks: [{ type: "text", caption: message }] } : undefined);
      if (!reply) throw new Error("empty reply");
      onChange((prev) => applyBlocks(prev, scope, reply.blocks, reply.version));
      if (switchKey) setSw((s) => without(s, switchKey)); // the reply's own state rules from here
    } catch {
      if (switchKey) setSw((s) => without(s, switchKey)); // flips back to the block's own state
      setErrors((e) => ({ ...e, [scope]: reason ?? "Something went wrong. Please try again." }));
    } finally {
      setPending((p) => without(p, scope));
    }
  }

  const isShown = (scope: string, panel: NutritionBlock) =>
    panel.id ? (shown[key(scope, panel.id)] ?? !panel.hidden) : !panel.hidden;

  // Local only (§4.5): no call, no pending state, nothing replaced.
  function toggleShown(scope: string, blocks: UiBlock[], target: string) {
    const block = findNutrition(blocks, target);
    if (!block) return;
    const k = key(scope, target);
    setShown((s) => ({ ...s, [k]: !(s[k] ?? !block.hidden) }));
  }

  function toggleOpen(scope: string, group: Extract<UiBlock, { type: "button_group" }>) {
    const k = key(scope, group.id);
    const next = !(open[k] ?? false);
    setOpen((o) => ({ ...o, [k]: next }));
    if (next) return;
    // Collapsing also hides what the group's toggle buttons had shown (§3.1.4).
    const targets = group.buttons.flatMap((b) => (b.action?.kind === "toggle" ? [b.action.target] : []));
    if (targets.length) setShown((s) => ({ ...s, ...Object.fromEntries(targets.map((t) => [key(scope, t), false])) }));
  }

  // `scope` is where the control's blocks live (ids and local state); `actionScope` is what its call
  // replaces — the same, except for a button inside a root-level group, whose scope is the group.
  function renderButton(btn: UiButton, scope: string, actionScope: string, blocks: UiBlock[], extraClass = "", cell = false) {
    const action = btn.action;
    const control = key(scope, btn.id);

    // A switch (§3.1.4): flips at once, then asks. Groups only; it ignores any icon.
    if (cell && typeof btn.state === "boolean") {
      const checked = sw[control] ?? btn.state;
      const call = isAllowedCall(action) ? action : undefined;
      return (
        <button
          key={btn.id}
          role="switch"
          aria-checked={checked}
          disabled={!call || busy(actionScope)}
          onClick={() => {
            if (!call) return;
            const next = !checked;
            setSw((s) => ({ ...s, [control]: next }));
            runCall(actionScope, control, call, next, control);
          }}
          className={`${CELL} ${PILL_SECONDARY}`}
        >
          <span className={`relative inline-block w-[26px] h-[14px] rounded-full transition-colors ${checked ? "bg-green-primary" : "bg-gray-300"}`}>
            <span className={`absolute top-[2px] left-[2px] w-[10px] h-[10px] rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[12px]" : ""}`} />
          </span>
          {btn.caption}
        </button>
      );
    }

    let onClick: (() => void) | undefined;
    if (isAllowedCall(action)) onClick = () => runCall(actionScope, control, action);
    else if (action?.kind === "toggle" && findNutrition(blocks, action.target)) onClick = () => toggleShown(scope, blocks, action.target);
    // Local, like a toggle (§4.6): no call, no pending state. No blocks removes the scope.
    else if (action?.kind === "replace") onClick = () => onChange((prev) => applyBlocks(prev, actionScope, action.blocks, prev.version));
    const Icon = btn.icon ? ICONS[btn.icon] : undefined;
    return (
      <button
        key={btn.id}
        disabled={!onClick || busy(actionScope)}
        onClick={onClick}
        className={`${cell ? CELL : PILL} ${(btn.icon && TONES[btn.icon]) || (btn.style === "primary" ? PILL_PRIMARY : PILL_SECONDARY)} ${extraClass}`}
      >
        {pending[actionScope] === control ? <Spinner size={cell ? 14 : 12} /> : Icon && <Icon size={cell ? 14 : 13} />}
        {btn.caption}
      </button>
    );
  }

  function renderBlocks(blocks: UiBlock[], scope: string): ReactNode[] {
    // A nutrition block that one of this list's groups toggles is that item's macros, so it is drawn
    // inside the group's card (under a divider) rather than as a card of its own. The pairing is the
    // toggle's target (§4.5); a nutrition block nothing toggles keeps its own card.
    const panelsOf = new Map<string, NutritionBlock[]>();
    const adopted = new Set<string>();
    for (const b of blocks) {
      if (b.type !== "button_group") continue;
      for (const btn of b.buttons) {
        if (btn.action?.kind !== "toggle") continue;
        const panel = findNutrition(blocks, btn.action.target);
        if (!panel?.id || adopted.has(panel.id)) continue;
        adopted.add(panel.id);
        panelsOf.set(b.id, [...(panelsOf.get(b.id) ?? []), panel]);
      }
    }

    return blocks.map((block, i) => {
      const k = `${block.type}:${"id" in block && block.id ? block.id : i}`;

      if (block.type === "text") {
        // An unknown style renders as body, so the words are never lost (§3.1.1).
        if (block.style === "header") {
          return <div key={k} className="font-display text-[14px] leading-tight text-text-main mt-1.5">{block.caption}</div>;
        }
        if (block.style === "sub_header") {
          return <div key={k} className="text-[11px] leading-tight text-text-muted -mt-1.5">{block.caption}</div>;
        }
        return <div key={k}>{block.caption}</div>;
      }

      if (block.type === "button") {
        return renderButton(block, scope, scope, blocks, "self-start");
      }

      if (block.type === "choice") {
        const choiceKey = key(scope, block.id);
        const value = selected[choiceKey];
        const submit = block.submit;
        const SubmitIcon = submit.icon ? ICONS[submit.icon] : undefined;
        const submitAction = isAllowedCall(submit.action) ? submit.action : undefined;
        return (
          <div key={k} className="flex flex-col gap-1.5">
            <div className="text-[12px] font-medium">{block.caption}</div>
            <div role="radiogroup" aria-label={block.caption} className="flex flex-col gap-1">
              {block.options.slice(0, 5).map((opt) => {
                const isSelected = value === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2.5 px-3 py-2 border rounded-lg transition-colors ${
                      isSelected
                        ? "bg-green-light border-green-border"
                        : "bg-[#faf9f6] border-[rgba(0,0,0,0.07)] hover:border-green-border"
                    } ${busy(scope) ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                  >
                    <input
                      type="radio"
                      name={choiceKey}
                      checked={isSelected}
                      disabled={busy(scope)}
                      onChange={() => setSelected((s) => ({ ...s, [choiceKey]: opt.value }))}
                      className="accent-green-primary w-3.5 h-3.5 flex-shrink-0"
                    />
                    <span className="flex flex-col items-start min-w-0">
                      <span className="font-display text-[12px] truncate leading-tight w-full">{opt.caption}</span>
                      {opt.detail && <span className="text-[9px] text-text-muted leading-tight">{opt.detail}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <button
              disabled={busy(scope) || value === undefined || !submitAction}
              onClick={() => submitAction && runCall(scope, choiceKey, submitAction, value)}
              className={`${PILL} ${(submit.icon && TONES[submit.icon]) || PILL_PRIMARY} self-end`}
            >
              {pending[scope] === choiceKey ? <Spinner /> : SubmitIcon && <SubmitIcon size={13} />}
              {submit.caption}
            </button>
          </div>
        );
      }

      if (block.type === "button_group") {
        const groupKey = key(scope, block.id);
        const isOpen = block.collapsed ? (open[groupKey] ?? false) : true;
        // A button's scope is its group — or the slot, when the group sits inside one.
        const gScope = scope === ROOT_SCOPE ? groupScope(block.id) : scope;
        // A collapsed row is a name, so one line; an open group's caption can be a whole sentence
        // ("Removed "Almonds" from your snacks."), so it wraps.
        const title = (
          <span className="flex-1 min-w-0 flex flex-col items-start text-left">
            <span className={`font-display text-[12px] leading-tight w-full ${block.collapsed ? "truncate" : "break-words"}`}>{block.caption}</span>
            {block.detail && <span className="text-[9px] text-text-muted leading-tight">{block.detail}</span>}
          </span>
        );
        return (
          <div key={k} className={`${CARD} flex flex-col`}>
            {block.collapsed ? (
              <button
                aria-expanded={isOpen}
                onClick={() => toggleOpen(scope, block)}
                className="flex items-center gap-2 px-3 py-2 w-full outline-none"
              >
                {title}
                <ChevronDown size={14} className={`text-text-muted flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
            ) : (
              <div className="flex px-3 pt-2">{title}</div>
            )}
            {isOpen && (
              <div className={`grid gap-1.5 px-3 pb-2.5 pt-1.5 ${GROUP_COLS[block.buttons.length] ?? "grid-cols-4"}`}>
                {block.buttons.map((btn) => renderButton(btn, scope, gScope, blocks, "", true))}
              </div>
            )}
            {isOpen && (panelsOf.get(block.id) ?? []).filter((p) => isShown(scope, p)).map((p) => (
              <div key={p.id} className="mx-3 mb-2.5 pt-2.5 border-t border-[rgba(0,0,0,0.07)] flex flex-col gap-1.5">
                <div className="text-[11px] text-text-muted">{p.caption}</div>
                <MacroRings macros={p.macros} />
              </div>
            ))}
            {/* In a slot the slot shows the error, under all of its blocks. */}
            {scope === ROOT_SCOPE && errors[gScope] && <div className="px-3 pb-2 text-[11px] text-red-500">{errors[gScope]}</div>}
          </div>
        );
      }

      if (block.type === "nutrition") {
        if (block.id && adopted.has(block.id)) return null; // drawn inside its group's card
        if (!isShown(scope, block)) return null;
        return (
          <div key={k} className={`${CARD} px-3 py-2 flex flex-col gap-1.5`}>
            <div className="text-[11px] text-text-muted">{block.caption}</div>
            <MacroRings macros={block.macros} />
          </div>
        );
      }

      if (block.type === "section") {
        // Every row was removed: nothing is left to show. The contract leaves this to us (§3.1.6).
        if (block.blocks.length === 0) return null;
        const sectionKey = key(scope, block.id);
        const isOpen = block.collapsed ? (open[sectionKey] ?? false) : true;
        const title = (
          <span className="flex-1 min-w-0 flex flex-col items-start text-left">
            <span className="font-display text-[14px] leading-tight text-text-main">{block.caption}</span>
            {block.detail && <span className="text-[11px] leading-tight text-text-muted">{block.detail}</span>}
          </span>
        );
        // The line under a header separates it from what follows. A closed section that ends the list
        // has nothing below it, so no trailing line. A note after it is a footer, not more list, and an
        // emptied section after it renders nothing, so neither counts. An open section keeps its line,
        // which sits under the header, not at the bottom.
        const endsList = !blocks.slice(i + 1).some((b) => (b.type === "section" ? b.blocks.length > 0 : b.type !== "notice" && b.type !== "nutrition"));
        return (
          <div key={k} className="flex flex-col gap-2">
            {block.collapsed ? (
              <button
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [sectionKey]: !isOpen }))}
                className={`flex items-center gap-2 w-full outline-none ${!isOpen && endsList ? "" : "pb-1.5 border-b border-[rgba(0,0,0,0.07)]"}`}
              >
                {title}
                <ChevronDown size={16} className={`text-text-muted flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
            ) : (
              <div className="flex pb-1.5 border-b border-[rgba(0,0,0,0.07)]">{title}</div>
            )}
            {/* Ids are unique across the whole body, so the section shares its parent's scope (§3.1.6). */}
            {isOpen && renderBlocks(block.blocks, scope)}
          </div>
        );
      }

      if (block.type === "notice") {
        const tone = NOTICE_TONES[block.tone];
        const Icon = ICONS[block.icon] ?? ICONS[tone.fallback]; // never nothing: the icon is the handle
        // No id in the contract, so the state is keyed by what the notice says, which survives the list
        // shifting around it.
        const noticeKey = key(scope, `notice:${block.tone}:${block.title ?? ""}:${block.caption}`);
        const isOpen = open[noticeKey] ?? !block.collapsed;
        const flip = () => setOpen((o) => ({ ...o, [noticeKey]: !isOpen }));
        // Collapsed, the notice is only its icon, so that icon is named by what the notice says (§3.1.7).
        const label = block.title || block.caption;
        if (!isOpen) {
          // Just the icon, not a chip: the button is the padding around the glyph, which gives a finger
          // a target, and the negative margin cancels it so the glyph lines up with the text above.
          return (
            <button key={k} type="button" onClick={flip} aria-label={label} aria-expanded={false}
              className={`self-start -m-1.5 p-1.5 rounded-full cursor-pointer outline-none transition-opacity hover:opacity-60 focus-visible:ring-2 focus-visible:ring-green-border ${tone.icon}`}>
              <Icon size={18} />
            </button>
          );
        }
        return (
          <div key={k} className={`rounded-lg border px-3 py-2.5 flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-text-main ${tone.panel}`}>
            <button type="button" onClick={flip} aria-label={label} aria-expanded className="flex items-center gap-2 text-left cursor-pointer outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-green-border rounded">
              <Icon size={18} className={`flex-shrink-0 ${tone.icon}`} />
              {block.title && <span className="font-semibold">{block.title}</span>}
            </button>
            {block.caption && (block.format === "markdown"
              ? <MiniMarkdown text={block.caption} />
              : <p className="whitespace-pre-line">{block.caption}</p>)}
          </div>
        );
      }

      // slot: what replaced a button_group. It keeps the group's footprint in the list. A reply made
      // of groups already is cards, so a card around them would be a card in a card.
      const slotScope = groupScope(block.id);
      const isCards = block.blocks.every((b) => b.type === "button_group" || b.type === "nutrition");
      return (
        <div key={k} className={isCards ? "flex flex-col gap-2" : `${CARD} px-3 py-2.5 flex flex-col gap-2`}>
          {renderBlocks(block.blocks, slotScope)}
          {errors[slotScope] && <div className="text-[11px] text-red-500">{errors[slotScope]}</div>}
        </div>
      );
    });
  }

  return (
    <>
      {renderBlocks(uiBody.blocks, ROOT_SCOPE)}
      {errors[ROOT_SCOPE] && <div className="text-[11px] text-red-500">{errors[ROOT_SCOPE]}</div>}
    </>
  );
}
