// The `form` block's answers (contract §3.1.8, docs/FRONTEND_LABEL_FORM.md): reading what the user typed,
// checking it, and turning it into the chat turn a `message` submit sends (§4.8). Kept apart from the
// component so it can be checked without a browser.
import type { UiFormBlock, UiFormField } from "@/lib/ui-body";

// What the inputs hold: a number field's text as typed, a choice's option value ("" for none), the
// ticked options' values for checks.
export type FormState = Record<string, string | string[]>;

// The answers that count, keyed by field id: a number field's number, a choice's option value, the ticked
// options' values in the options' order. An empty field is left out (§3.1.8).
export type FormValues = Record<string, number | string | string[]>;

export type FormCheck = {
  values: FormValues;
  // A field whose text isn't an acceptable number, with why. Shown under that field.
  errors: Record<string, string>;
  // What is still needed before Save: required fields left empty, and an empty "one of" pair.
  missing: string[];
  ok: boolean;
};

// Fields of which at least one must be filled though each is optional. The label form's salt and sodium:
// a label gives one or the other (docs/FRONTEND_LABEL_FORM.md, "What to build" 2). Applied only when the
// form has both fields; the agent asks again if it gets neither, so this only saves the round trip.
const ONE_OF: [string, string][] = [["sodium_mg", "salt_g"]];

export function initialFormState(block: UiFormBlock): FormState {
  return Object.fromEntries(block.fields.map((f): [string, string | string[]] => {
    if (f.kind === "number") return [f.id, f.value === undefined ? "" : String(f.value)];
    if (f.kind === "choice") return [f.id, f.value ?? ""];
    return [f.id, f.value ?? []];
  }));
}

// A number as typed: undefined when empty, null when it isn't a number. Spaces are ignored. A European
// label writes a decimal comma ("0,02 g"), so one comma reads as a point; a number with both a comma and a
// point is ambiguous and refused rather than guessed.
export function readNumber(text: string): number | null | undefined {
  const t = text.trim().replace(/\s+/g, "");
  if (!t) return undefined;
  if (t.includes(",") && t.includes(".")) return null;
  const dotted = t.replace(",", ".");
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(dotted)) return null;
  const n = Number(dotted);
  return Number.isFinite(n) ? n : null;
}

// 16.7, 0.02, 568: what the user typed, as a number, without a float's tail.
export function formatNumber(n: number): string {
  return String(Number(n.toPrecision(12)));
}

const withUnit = (n: number, unit?: string) => `${formatNumber(n)}${unit ? ` ${unit}` : ""}`;

export function checkForm(fields: UiFormField[], state: FormState): FormCheck {
  const values: FormValues = {};
  const errors: Record<string, string> = {};
  const missing: string[] = [];
  for (const f of fields) {
    const raw = state[f.id];
    if (f.kind === "number") {
      const n = readNumber(typeof raw === "string" ? raw : "");
      if (n === undefined) {
        if (f.required) missing.push(f.caption);
      } else if (n === null) {
        errors[f.id] = "Enter a number";
      } else if (f.min !== undefined && n < f.min) {
        errors[f.id] = f.max !== undefined ? `Between ${withUnit(f.min, f.unit)} and ${withUnit(f.max, f.unit)}` : `At least ${withUnit(f.min, f.unit)}`;
      } else if (f.max !== undefined && n > f.max) {
        errors[f.id] = f.min !== undefined ? `Between ${withUnit(f.min, f.unit)} and ${withUnit(f.max, f.unit)}` : `At most ${withUnit(f.max, f.unit)}`;
      } else {
        values[f.id] = n;
      }
    } else if (f.kind === "choice") {
      const v = typeof raw === "string" ? raw : "";
      if (v && f.options.some((o) => o.value === v)) values[f.id] = v;
      else if (f.required) missing.push(f.caption);
    } else {
      const ticked = Array.isArray(raw) ? raw : [];
      const picked = f.options.filter((o) => ticked.includes(o.value)).map((o) => o.value);
      if (picked.length) values[f.id] = picked;
      else if (f.required) missing.push(f.caption);
    }
  }
  for (const [a, b] of ONE_OF) {
    const fa = fields.find((f) => f.id === a);
    const fb = fields.find((f) => f.id === b);
    if (!fa || !fb) continue;
    if (!(a in values) && !(b in values) && !(a in errors) && !(b in errors)) missing.push(`${fa.caption} or ${fb.caption}`);
  }
  return { values, errors, missing, ok: !missing.length && !Object.keys(errors).length };
}

// The chat turn a submit sends (§4.8): the action's text, then ": ", then every filled field as
// "caption: value unit", joined by "; ". A choice shows its option's caption and checks their captions,
// joined by ", ". It is what the transcript shows; the agent reads the numbers from the request's `form`.
export function formMessage(text: string, fields: UiFormField[], values: FormValues): string {
  const parts = fields.flatMap((f): string[] => {
    const v = values[f.id];
    if (v === undefined) return [];
    if (f.kind === "number") return typeof v === "number" ? [`${f.caption}: ${withUnit(v, f.unit)}`] : [];
    if (f.kind === "choice") {
      const option = f.options.find((o) => o.value === v);
      return option ? [`${f.caption}: ${option.caption}`] : [];
    }
    const captions = f.options.filter((o) => Array.isArray(v) && v.includes(o.value)).map((o) => o.caption);
    return captions.length ? [`${f.caption}: ${captions.join(", ")}`] : [];
  });
  return parts.length ? `${text}: ${parts.join("; ")}` : text;
}

// The request's `form`: the submit action's payload with the answers added as `values`.
export function formRequest(payload: Record<string, unknown> | undefined, values: FormValues): Record<string, unknown> {
  return { ...(payload ?? {}), values };
}
