"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { isAllowedAction, parseUiBody, substituteValue, type UiAction, type UiBody } from "@/lib/ui-body";

function Spinner() {
  return <span className="w-3 h-3 rounded-full border-[1.5px] border-current border-t-transparent animate-spin inline-block" />;
}

// Renders the agent's `ui_body` blocks. The caller supplies the chat bubble around them (PlanTab's
// UiBodyBubble), so text inherits the bubble's typography. A successful call replaces the blocks
// via onReplace (contract §4.3).
export function UiBodyBlocks({ uiBody, onReplace }: { uiBody: UiBody; onReplace: (next: UiBody) => void }) {
  // Id of the control that was pressed. Any value disables every control in this ui_body.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const pending = pendingId !== null;

  async function run(controlId: string, action: UiAction, value?: string) {
    if (pending || !isAllowedAction(action)) return;
    setPendingId(controlId);
    setError(null);
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
      const next = parseUiBody(data.ui_body)
        ?? (typeof data.message === "string" && data.message
          ? { version: 1, blocks: [{ type: "text" as const, caption: data.message }] }
          : undefined);
      if (!next) throw new Error("empty reply");
      onReplace(next);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      {uiBody.blocks.map((block, i) => {
        if (block.type === "text") {
          return <div key={i}>{block.caption}</div>;
        }
        if (block.type === "button") {
          const primary = block.style === "primary";
          return (
            <button
              key={block.id}
              disabled={pending || !isAllowedAction(block.action)}
              onClick={() => run(block.id, block.action)}
              className={`self-start inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11.5px] font-medium border transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                primary
                  ? "bg-green-primary border-green-primary text-white hover:bg-green-dark"
                  : "bg-green-light border-green-border text-green-primary hover:bg-green-border"
              }`}
            >
              {pendingId === block.id && <Spinner />}
              {block.caption}
            </button>
          );
        }
        const value = selected[block.id];
        return (
          <div key={block.id} className="flex flex-col gap-1.5">
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
                    } ${pending ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                  >
                    <input
                      type="radio"
                      name={block.id}
                      checked={isSelected}
                      disabled={pending}
                      onChange={() => setSelected((prev) => ({ ...prev, [block.id]: opt.value }))}
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
              disabled={pending || value === undefined || !isAllowedAction(block.submit.action)}
              onClick={() => run(block.id, block.submit.action, value)}
              className="self-end inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11.5px] font-medium border bg-green-primary border-green-primary text-white hover:bg-green-dark transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pendingId === block.id && <Spinner />}
              {block.submit.caption}
            </button>
          </div>
        );
      })}
      {error && <div className="text-[11px] text-red-500">{error}</div>}
    </>
  );
}
