"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/browser";
import { MacroRings } from "@/components/MacroRings";
import { ArrowLeftRight, Check, ChevronDown, Info, Pencil, Plus, ToggleRight, Trash2, TriangleAlert, Undo2, X } from "@/lib/icons";
import {
  ROOT_SCOPE, applyReply, findNutrition, groupScope, isAllowedCall, parseUiBody, substituteValue,
  type UiBlock, type UiBody, type UiButton, type UiCallAction,
} from "@/lib/ui-body";

// The closed icon set (contract §3.2). An unknown name renders no icon.
const ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  trash: Trash2, edit: Pencil, toggle: ToggleRight, undo: Undo2, info: Info,
  check: Check, cross: X, alert: TriangleAlert, plus: Plus, swap: ArrowLeftRight,
};

const PILL = "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11.5px] font-medium border transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed";
const PILL_SECONDARY = "bg-green-light border-green-border text-green-primary enabled:hover:bg-green-border";
const PILL_PRIMARY = "bg-green-primary border-green-primary text-white enabled:hover:bg-green-dark";
const CARD = "bg-[#faf9f6] border border-[rgba(0,0,0,0.07)] rounded-lg";

const key = (scope: string, id: string) => `${scope}|${id}`;

function without<T>(rec: Record<string, T>, k: string): Record<string, T> {
  const next = { ...rec };
  delete next[k];
  return next;
}

function Spinner() {
  return <span className="w-3 h-3 rounded-full border-[1.5px] border-current border-t-transparent animate-spin inline-block" />;
}

// Renders the agent's `ui_body` blocks. The caller supplies the chat bubble around them (PlanTab's
// UiBodyBubble), so text inherits the bubble's typography. A call's reply replaces its scope (the
// whole body, or one button_group — contract §4.3) through onChange.
//
// State is keyed by scope + id, never by the bare id: an endpoint's reply uses fixed ids (`undo`), so
// two removed snacks each hold their own `undo` (§4.3).
export function UiBodyBlocks({ uiBody, onChange }: { uiBody: UiBody; onChange: (update: (prev: UiBody) => UiBody) => void }) {
  const [pending,  setPending]  = useState<Record<string, string>>({});  // scope → the control that was pressed
  const [errors,   setErrors]   = useState<Record<string, string>>({});  // scope → inline error
  const [selected, setSelected] = useState<Record<string, string>>({});  // choice → chosen option value
  const [open,     setOpen]     = useState<Record<string, boolean>>({}); // collapsed group → expanded
  const [shown,    setShown]    = useState<Record<string, boolean>>({}); // nutrition block → shown

  const anyPending = Object.keys(pending).length > 0;
  // Every control in a scope is disabled while that scope has a call in flight (§4.1). A group's
  // scope is its own, so the rest of the body stays usable; the whole-body scope waits for them all,
  // since its reply would replace the groups.
  const busy = (scope: string) => (scope === ROOT_SCOPE ? anyPending : !!pending[scope] || !!pending[ROOT_SCOPE]);

  async function runCall(scope: string, control: string, action: UiCallAction, value?: string) {
    if (busy(scope) || !isAllowedCall(action)) return;
    setPending((p) => ({ ...p, [scope]: control }));
    setErrors((e) => without(e, scope));
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
      const reply: UiBody | undefined = parseUiBody(data.ui_body)
        ?? (typeof data.message === "string" && data.message
          ? { version: 1, blocks: [{ type: "text", caption: data.message }] }
          : undefined);
      if (!reply) throw new Error("empty reply");
      onChange((prev) => applyReply(prev, scope, reply));
    } catch {
      setErrors((e) => ({ ...e, [scope]: "Something went wrong. Please try again." }));
    } finally {
      setPending((p) => without(p, scope));
    }
  }

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
  function renderButton(btn: UiButton, scope: string, actionScope: string, blocks: UiBlock[], extraClass = "") {
    const action = btn.action;
    const control = key(scope, btn.id);
    let onClick: (() => void) | undefined;
    if (isAllowedCall(action)) onClick = () => runCall(actionScope, control, action);
    else if (action?.kind === "toggle" && findNutrition(blocks, action.target)) onClick = () => toggleShown(scope, blocks, action.target);
    const Icon = btn.icon ? ICONS[btn.icon] : undefined;
    return (
      <button
        key={btn.id}
        disabled={!onClick || busy(actionScope)}
        onClick={onClick}
        className={`${PILL} ${btn.style === "primary" ? PILL_PRIMARY : PILL_SECONDARY} ${extraClass}`}
      >
        {pending[actionScope] === control ? <Spinner /> : Icon && <Icon size={13} />}
        {btn.caption}
      </button>
    );
  }

  function renderBlocks(blocks: UiBlock[], scope: string): ReactNode[] {
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
              className={`${PILL} ${PILL_PRIMARY} self-end`}
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
        const title = (
          <span className="flex-1 min-w-0 flex flex-col items-start text-left">
            <span className="font-display text-[12px] truncate leading-tight w-full">{block.caption}</span>
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
              <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pt-1.5">
                {block.buttons.map((btn) => renderButton(btn, scope, gScope, blocks))}
              </div>
            )}
            {errors[gScope] && <div className="px-3 pb-2 text-[11px] text-red-500">{errors[gScope]}</div>}
          </div>
        );
      }

      if (block.type === "nutrition") {
        const visible = block.id ? (shown[key(scope, block.id)] ?? !block.hidden) : !block.hidden;
        if (!visible) return null;
        return (
          <div key={k} className={`${CARD} px-3 py-2 flex flex-col gap-1.5`}>
            <div className="text-[11px] text-text-muted">{block.caption}</div>
            {/* Six 40px rings need ~250px for one row; a phone-width bubble has less, so below that
                they wrap 3 + 3 rather than overflow the bubble. */}
            <div className="@container">
              <MacroRings
                macros={block.macros}
                className="grid grid-cols-3 justify-items-center gap-y-2 @min-[250px]:flex @min-[250px]:items-center @min-[250px]:justify-between"
              />
            </div>
          </div>
        );
      }

      // slot: what replaced a button_group. It keeps the group's footprint in the list.
      const slotScope = groupScope(block.id);
      return (
        <div key={k} className={`${CARD} px-3 py-2.5 flex flex-col gap-2`}>
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
