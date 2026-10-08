"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { isAllowedAction, parseUiBody, substituteValue, type UiAction, type UiBody } from "@/lib/ui-body";

// Renders the agent's `ui_body` blocks. A successful call replaces the blocks via onReplace (contract §4.3).
export function UiBodyBlocks({ uiBody, onReplace }: { uiBody: UiBody; onReplace: (next: UiBody) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});

  async function run(action: UiAction, value?: string) {
    if (pending || !isAllowedAction(action)) return;
    setPending(true);
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
      setPending(false);
    }
  }

  return (
    <div className="ml-[38px] flex flex-col gap-2">
      {uiBody.blocks.map((block, i) => {
        if (block.type === "text") {
          return <div key={i} className="text-[13px] leading-relaxed text-text-main">{block.caption}</div>;
        }
        if (block.type === "button") {
          const primary = block.style === "primary";
          return (
            <button
              key={block.id}
              disabled={pending || !isAllowedAction(block.action)}
              onClick={() => run(block.action)}
              className={`self-start text-[12.5px] font-medium rounded-full px-4 py-2 transition-colors outline-none disabled:opacity-60 ${
                primary
                  ? "text-white bg-green-primary hover:bg-green-dark"
                  : "text-text-muted bg-white border border-[rgba(0,0,0,0.1)] hover:border-text-muted"
              }`}
            >
              {pending ? "…" : block.caption}
            </button>
          );
        }
        const value = selected[block.id];
        return (
          <div key={block.id} className="bg-white border border-[rgba(0,0,0,0.08)] rounded-2xl px-4 py-3 flex flex-col gap-2">
            <div className="text-[13px] font-medium text-text-main">{block.caption}</div>
            {block.options.slice(0, 5).map((opt) => (
              <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name={block.id}
                  checked={value === opt.value}
                  disabled={pending}
                  onChange={() => setSelected((prev) => ({ ...prev, [block.id]: opt.value }))}
                  className="accent-green-primary mt-0.5"
                />
                <span className="flex flex-col">
                  <span className="text-[13px] text-text-main">{opt.caption}</span>
                  {opt.detail && <span className="text-[11.5px] text-text-muted">{opt.detail}</span>}
                </span>
              </label>
            ))}
            <button
              disabled={pending || value === undefined || !isAllowedAction(block.submit.action)}
              onClick={() => run(block.submit.action, value)}
              className="self-start text-[12.5px] font-medium text-white bg-green-primary hover:bg-green-dark rounded-full px-4 py-2 transition-colors outline-none disabled:opacity-60"
            >
              {pending ? "…" : block.submit.caption}
            </button>
          </div>
        );
      })}
      {error && <div className="text-[12px] text-red-500">{error}</div>}
    </div>
  );
}
