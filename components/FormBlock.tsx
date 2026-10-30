"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ICONS, PILL, PILL_PRIMARY, PILL_SECONDARY, Spinner, TONES } from "@/components/ui-style";
import type { UiFormBlock, UiFormButton, UiFormField } from "@/lib/ui-body";
import { checkForm, formMessage, formRequest, initialFormState, type FormState } from "@/lib/ui-form";

// Sends the user's next chat turn (§4.8). Resolves true once the reply has arrived, false when nothing
// was sent or it failed, so the form can be tried again.
export type SendMessage = (text: string, form?: Record<string, unknown>) => Promise<boolean>;

// A `form` (contract §3.1.8): a caption, an optional detail line, the fields in order, then Save and a
// second button side by side. Both send a chat turn with a `message` action (§4.8): Save its text and the
// answers (`formMessage`, `formRequest`), the second button its text alone. Once sent, every control is
// disabled and the answers stay as they were, so it can't be sent twice; if sending fails it opens again.
// `busy`: another chat turn is in flight, so neither button can send until its reply is in. The answers
// live here, not in the parent, as a choice's pick does.
export function FormBlock({ block, onMessage, busy = false }: {
  block: UiFormBlock;
  onMessage?: SendMessage;
  busy?: boolean;
}) {
  const uid = useId();
  const [state, setState] = useState<FormState>(() => initialFormState(block));
  const [phase, setPhase] = useState<"idle" | "sending" | "sent">("idle");
  const [pressed, setPressed] = useState<"submit" | "cancel" | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const check = checkForm(block.fields, state);
  const locked = phase !== "idle";
  const usable = (b?: UiFormButton) => b?.action?.kind === "message" && !!onMessage;
  const canSave = !locked && !busy && check.ok && usable(block.submit);
  const canCancel = !locked && !busy && usable(block.cancel);

  async function send(which: "submit" | "cancel") {
    const action = which === "submit" ? block.submit.action : block.cancel?.action;
    if (action?.kind !== "message" || !onMessage || locked || busy) return;
    if (which === "submit" && !check.ok) return;
    setPhase("sending");
    setPressed(which);
    setFailed(false);
    const ok = which === "submit"
      ? await onMessage(formMessage(action.text, block.fields, check.values), formRequest(action.payload, check.values))
      : await onMessage(action.text);
    if (!alive.current) return;
    if (ok) {
      setPhase("sent");
    } else {
      setPhase("idle");
      setPressed(null);
      setFailed(true);
    }
  }

  const set = (id: string, v: string | string[]) => setState((s) => ({ ...s, [id]: v }));
  const SubmitIcon = block.submit.icon ? ICONS[block.submit.icon] : undefined;
  const CancelIcon = block.cancel?.icon ? ICONS[block.cancel.icon] : undefined;

  return (
    <form
      noValidate
      aria-label={block.caption}
      onSubmit={(e) => { e.preventDefault(); if (canSave) send("submit"); }}
      className="flex flex-col gap-2.5"
    >
      <div className="flex flex-col gap-0.5">
        <div className="text-[12px] font-medium leading-snug">{block.caption}</div>
        {block.detail && <div className="text-[11px] text-text-muted leading-snug">{block.detail}</div>}
      </div>

      {/* A disabled fieldset disables every input in it: what was sent stays readable, not editable. */}
      <fieldset disabled={locked} className="flex flex-col gap-2.5 min-w-0 border-0 p-0 m-0">
        {block.fields.map((f) => (
          <Field key={f.id} field={f} uid={uid} value={state[f.id]} error={check.errors[f.id]} onChange={(v) => set(f.id, v)} />
        ))}
      </fieldset>

      {phase === "idle" && check.missing.length > 0 && (
        <div className="text-[11px] text-text-muted leading-snug" aria-live="polite">
          Still needed: {summarize(check.missing)}
        </div>
      )}
      {failed && <div className="text-[11px] text-red-500" role="alert">Couldn&apos;t send that. Please try again.</div>}

      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className={`${PILL} whitespace-nowrap ${(block.submit.icon && TONES[block.submit.icon]) || PILL_PRIMARY}`}
        >
          {pressed === "submit" && phase === "sending" ? <Spinner /> : SubmitIcon && <SubmitIcon size={13} />}
          {block.submit.caption}
        </button>
        {block.cancel && (
          <button
            type="button"
            disabled={!canCancel}
            onClick={() => send("cancel")}
            className={`${PILL} whitespace-nowrap ${(block.cancel.icon && TONES[block.cancel.icon]) || PILL_SECONDARY}`}
          >
            {pressed === "cancel" && phase === "sending" ? <Spinner /> : CancelIcon && <CancelIcon size={13} />}
            {block.cancel.caption}
          </button>
        )}
      </div>
    </form>
  );
}

// "Calories, Protein and 4 more": the list stays one line when most of the form is still empty.
function summarize(missing: string[]): string {
  if (missing.length <= 3) return missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `${missing.slice(0, 2).join(", ")} and ${missing.length - 2} more`;
}

const INPUT = "w-[76px] bg-white border border-[rgba(0,0,0,0.12)] rounded-lg px-2 py-1 text-[12.5px] text-right text-text-main outline-none transition-colors focus:border-green-mid disabled:bg-[#faf9f6] disabled:text-text-muted aria-[invalid=true]:border-red-400";
// A choice's options and a checks field's boxes, as chips: a native radio or checkbox inside, so the
// keyboard and screen readers get the real control.
const CHIP = "relative inline-flex items-center px-2.5 py-1 rounded-full border text-[11.5px] leading-tight select-none transition-colors cursor-pointer bg-white border-[rgba(0,0,0,0.12)] text-text-main has-[:checked]:bg-green-light has-[:checked]:border-green-border has-[:checked]:text-green-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-green-border has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

function Field({ field: f, uid, value, error, onChange }: {
  field: UiFormField;
  uid: string;
  value: string | string[] | undefined;
  error?: string;
  onChange: (v: string | string[]) => void;
}) {
  const id = `${uid}-${f.id}`;
  const hintId = f.hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const hint = f.hint && <div id={hintId} className="text-[10px] text-text-muted leading-snug">{f.hint}</div>;

  if (f.kind === "number") {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="flex-1 min-w-0 text-[12px] leading-tight">{f.caption}</label>
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
            aria-required={f.required}
            aria-describedby={describedBy}
            className={INPUT}
          />
          <span className="w-7 flex-shrink-0 text-[11px] text-text-muted">{f.unit ?? ""}</span>
        </div>
        {hint}
        {error && <div id={errorId} className="text-[10px] text-red-500 leading-snug">{error}</div>}
      </div>
    );
  }

  const isChoice = f.kind === "choice";
  const picked = isChoice ? (typeof value === "string" ? value : "") : (Array.isArray(value) ? value : []);
  return (
    <div className="flex flex-col gap-1">
      <div id={`${id}-label`} className="text-[12px] leading-tight">{f.caption}</div>
      <div
        role={isChoice ? "radiogroup" : "group"}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        aria-required={isChoice ? f.required : undefined}
        className="flex flex-wrap gap-1.5"
      >
        {f.options.map((o) => {
          const checked = isChoice ? picked === o.value : (picked as string[]).includes(o.value);
          return (
            <label key={o.value} className={CHIP}>
              <input
                type={isChoice ? "radio" : "checkbox"}
                name={id}
                value={o.value}
                checked={checked}
                onChange={() => {
                  if (isChoice) onChange(o.value);
                  else onChange(checked ? (picked as string[]).filter((v) => v !== o.value) : [...(picked as string[]), o.value]);
                }}
                className="absolute opacity-0 w-0 h-0"
              />
              {o.caption}
            </label>
          );
        })}
      </div>
      {hint}
    </div>
  );
}
