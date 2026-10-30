"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ICONS, PILL, PILL_PRIMARY, PILL_SECONDARY, Spinner, TONES } from "@/components/ui-style";
import { Check } from "@/lib/icons";
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
//
// Enter never sends the form. Save is a plain button, so a keyboard's Enter (Android's Go on the last box)
// can't send the numbers before the allergens below them are ticked. In a text or number box Enter moves to
// the next one and on the last closes the keyboard; on a chip it ticks the chip. Once per press.
export function FormBlock({ block, onMessage, busy = false }: {
  block: UiFormBlock;
  onMessage?: SendMessage;
  busy?: boolean;
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
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
  // The last box Enter can move from: there it closes the keyboard instead.
  const lastBoxId = [...block.fields].reverse().find((f) => f.kind === "number" || f.kind === "text")?.id;

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

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // Safari sends the Enter that commits an IME composition with isComposing false, but keyCode 229.
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return; // Enter on a button presses it, as usual
    e.preventDefault();
    if (e.repeat) return; // a held Enter acts once, as Space does on a checkbox
    if (target.type === "checkbox" || target.type === "radio") {
      target.click();
      return;
    }
    const boxes = Array.from(formRef.current?.querySelectorAll<HTMLInputElement>("input[data-form-box]") ?? []);
    const next = boxes[boxes.indexOf(target) + 1];
    if (next) next.focus();
    else target.blur();
  }

  const set = (id: string, v: string | string[]) => setState((s) => ({ ...s, [id]: v }));
  const SubmitIcon = block.submit.icon ? ICONS[block.submit.icon] : undefined;
  const CancelIcon = block.cancel?.icon ? ICONS[block.cancel.icon] : undefined;

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={block.caption}
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2.5"
    >
      <div className="flex flex-col gap-0.5">
        <div className="text-[12px] font-medium leading-snug">{block.caption}</div>
        {block.detail && <div className="text-[11px] text-text-muted leading-snug">{block.detail}</div>}
      </div>

      {/* A disabled fieldset disables every input in it: what was sent stays readable, not editable. */}
      <fieldset disabled={locked} className="flex flex-col gap-2.5 min-w-0 border-0 p-0 m-0">
        {block.fields.map((f) => (
          <Field
            key={f.id}
            field={f}
            uid={uid}
            value={state[f.id]}
            error={check.errors[f.id]}
            last={f.id === lastBoxId}
            onChange={(v) => set(f.id, v)}
          />
        ))}
      </fieldset>

      {phase === "idle" && check.missing.length > 0 && (
        <div className="text-[11px] text-text-muted leading-snug">Still needed: {summarize(check.missing)}</div>
      )}
      {failed && <div className="text-[11px] text-red-600" role="alert">Couldn&apos;t send that. Please try again.</div>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => send("submit")}
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

// The unit as a screen reader should say it: "mg" and "g" must not sound alike.
const SPOKEN_UNITS: Record<string, string> = {
  g: "grams", mg: "milligrams", kg: "kilograms", kcal: "kilocalories", kj: "kilojoules",
  ml: "millilitres", l: "litres", oz: "ounces", "%": "percent",
};
const spokenUnit = (unit: string) => SPOKEN_UNITS[unit.toLowerCase()] ?? unit;

const TEXT_INPUT = "w-full min-w-0 bg-white border border-[rgba(0,0,0,0.12)] rounded-lg px-2.5 py-1 text-[12.5px] text-text-main outline-none transition-colors focus:border-green-mid disabled:bg-[#faf9f6] disabled:text-text-muted aria-[invalid=true]:border-red-400";
const INPUT = "w-[72px] bg-white border border-[rgba(0,0,0,0.12)] rounded-lg px-2 py-1 text-[12.5px] text-right text-text-main outline-none transition-colors focus:border-green-mid disabled:bg-[#faf9f6] disabled:text-text-muted aria-[invalid=true]:border-red-400";
// A choice's options and a checks field's boxes, as chips. The native radio or checkbox is laid over the
// whole chip, invisible, so the keyboard, a screen reader's touch exploration and a tap all reach the real
// control and hear its state. Focus is a dark ring outside the chip, apart from the checked border. A ticked
// chip also shows a check mark, so its state isn't told by colour alone; in forced-colors mode (Windows High
// Contrast), which drops the colours and the ring, the mark stays and focus becomes an outline.
const CHIP = "relative inline-flex items-center px-2.5 py-1 rounded-full border text-[11.5px] leading-tight select-none transition-colors bg-white border-[rgba(0,0,0,0.12)] text-text-main has-[:checked]:bg-green-light has-[:checked]:border-green-mid has-[:checked]:text-green-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-green-primary has-[:focus-visible]:ring-offset-1 forced-colors:has-[:focus-visible]:outline-2 forced-colors:has-[:focus-visible]:outline-offset-2 has-[:disabled]:opacity-60";
const CHIP_INPUT = "absolute inset-0 w-full h-full m-0 opacity-0 cursor-pointer disabled:cursor-not-allowed";

function Field({ field: f, uid, value, error, last, onChange }: {
  field: UiFormField;
  uid: string;
  value: string | string[] | undefined;
  error?: string;
  last: boolean;
  onChange: (v: string | string[]) => void;
}) {
  const id = `${uid}-${f.id}`;
  const hintId = f.hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const hint = f.hint && <div id={hintId} className="text-[10px] text-text-muted leading-snug">{f.hint}</div>;

  // A field this renderer can't fill: its caption, shown disabled (§3.1.8), so the user sees it was asked.
  if (f.kind === "unsupported") {
    return (
      <div aria-disabled="true" className="flex flex-col gap-0.5 opacity-60">
        <div className="text-[12px] leading-tight text-text-muted">{f.caption}</div>
        {hint}
      </div>
    );
  }

  // One line, as wide as the bubble (a name is longer than a number). The browser stops typing at max_length;
  // a longer prefill shows its error until it is shortened.
  if (f.kind === "text") {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-[12px] leading-tight">{f.caption}</label>
        <input
          id={id}
          data-form-box=""
          type="text"
          enterKeyHint={last ? "done" : "next"}
          autoComplete="off"
          maxLength={f.maxLength}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-required={f.required}
          aria-describedby={describedBy}
          className={TEXT_INPUT}
        />
        {hint}
        {error && <div id={errorId} className="text-[11px] text-red-600 leading-snug">{error}</div>}
      </div>
    );
  }

  if (f.kind === "number") {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="flex-1 min-w-0 text-[12px] leading-tight hyphens-auto break-words">
            {f.caption}
            {f.unit && <span className="sr-only"> ({spokenUnit(f.unit)})</span>}
          </label>
          <input
            id={id}
            data-form-box=""
            type="text"
            inputMode="decimal"
            enterKeyHint={last ? "done" : "next"}
            autoComplete="off"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
            aria-required={f.required}
            aria-describedby={describedBy}
            className={INPUT}
          />
          <span aria-hidden="true" className="w-7 flex-shrink-0 text-[11px] text-text-muted">{f.unit ?? ""}</span>
        </div>
        {hint}
        {error && <div id={errorId} className="text-[11px] text-red-600 leading-snug">{error}</div>}
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
                className={CHIP_INPUT}
              />
              {checked && <Check size={11} aria-hidden="true" className="-ml-0.5 mr-1 flex-shrink-0" />}
              {o.caption}
            </label>
          );
        })}
      </div>
      {hint}
    </div>
  );
}
