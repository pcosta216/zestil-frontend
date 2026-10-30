// The `form` block's answers (contract §3.1.8, docs/FRONTEND_LABEL_FORM.md): reading what the user typed,
// checking it, and turning it into the chat turn a `message` submit sends (§4.8). Kept apart from the
// component so it can be checked without a browser.
import type { UiFormBlock, UiFormField } from "@/lib/ui-body";

// What the inputs hold: a number or text field's text as typed, a choice's option value ("" for none), the
// ticked options' values for checks.
export type FormState = Record<string, string | string[]>;

// The answers that count, keyed by field id: a number field's number, a text field's trimmed string, a
// choice's option value, the ticked options' values in the options' order. An empty field is left out (§4.8).
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
  return Object.fromEntries(block.fields.flatMap((f): [string, string | string[]][] => {
    if (f.kind === "number") return [[f.id, f.value === undefined ? "" : String(f.value)]];
    if (f.kind === "text") return [[f.id, f.value ?? ""]];
    if (f.kind === "choice") return [[f.id, f.value ?? ""]];
    if (f.kind === "checks") return [[f.id, f.value ?? []]];
    return [];
  }));
}

// "1,330" or "1.000": digits grouped in threes after the separator, one kind of separator throughout. A US
// label groups thousands with a comma (Sodium 1,330 mg) and a European one with a point (1.000 g), and either
// could also be a decimal, so it is refused rather than guessed. "0,020" (a leading zero) and "16,7" (not three
// digits) are plain decimals. A number the agent prefilled is taken as sent, never refused (checkForm).
const GROUPED = /^[+-]?[1-9]\d{0,2}(?:(?:,\d{3})+|(?:\.\d{3})+)$/;

// A number as typed: undefined when empty, null when it isn't a number. Spaces are ignored. A European
// label writes a decimal comma ("0,02 g"), so one comma reads as a point; a number with both a comma and a
// point is ambiguous and refused rather than guessed.
export function readNumber(text: string): number | null | undefined {
  const t = text.trim().replace(/\s+/g, "");
  if (!t) return undefined;
  if (GROUPED.test(t)) return null;
  if (t.includes(",") && t.includes(".")) return null;
  const dotted = t.replace(",", ".");
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(dotted)) return null;
  const n = Number(dotted);
  return Number.isFinite(n) ? n : null;
}

// Why a number as typed isn't one, and how to write it so it is. Every spelling it suggests is one the form
// accepts: "1.125" is itself three grouped digits, so its decimal reading is offered as "1.1250".
function numberError(text: string): string {
  const t = text.trim().replace(/\s+/g, "");
  // "1,330.5" / "1.330,5": grouped thousands, then the other separator as the decimal point.
  const mixed = t.match(/^(.+)([,.])(\d+)$/);
  if (mixed && GROUPED.test(mixed[1]) && !mixed[1].includes(mixed[2])) {
    return `Write ${formatNumber(Number(`${mixed[1].replace(/[,.]/g, "")}.${mixed[3]}`))}`;
  }
  if (!GROUPED.test(t)) return "Enter a number";
  const whole = t.replace(/[,.]/g, "");
  if (t.split(/[,.]/).length > 2) return `Write ${whole}, without separators`;
  const decimal = formatNumber(Number(t.replace(",", ".")));
  return GROUPED.test(decimal) ? `Write ${whole}, or ${decimal}0 for ${decimal}` : `Write ${whole} or ${decimal}`;
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
      const text = typeof raw === "string" ? raw : "";
      // The agent's prefilled number is a JSON number, never ambiguous: while the box still shows it as sent it
      // counts as sent (a correction's 1.125 is 1.125). min and max still apply.
      const n = f.value !== undefined && text.trim() === String(f.value) ? f.value : readNumber(text);
      if (n === undefined) {
        if (f.required) missing.push(f.caption);
      } else if (n === null) {
        errors[f.id] = numberError(text);
      } else if (f.min !== undefined && n < f.min) {
        errors[f.id] = f.max !== undefined ? `Between ${withUnit(f.min, f.unit)} and ${withUnit(f.max, f.unit)}` : `At least ${withUnit(f.min, f.unit)}`;
      } else if (f.max !== undefined && n > f.max) {
        errors[f.id] = f.min !== undefined ? `Between ${withUnit(f.min, f.unit)} and ${withUnit(f.max, f.unit)}` : `At most ${withUnit(f.max, f.unit)}`;
      } else {
        values[f.id] = n;
      }
    } else if (f.kind === "text") {
      // Sent trimmed; only blanks is empty. Longer than max_length (a prefill can be) needs shortening first.
      const t = (typeof raw === "string" ? raw : "").trim();
      if (!t) {
        if (f.required) missing.push(f.caption);
      } else if (f.maxLength !== undefined && t.length > f.maxLength) {
        errors[f.id] = `At most ${f.maxLength} characters`;
      } else {
        values[f.id] = t;
      }
    } else if (f.kind === "choice") {
      const v = typeof raw === "string" ? raw : "";
      if (v && f.options.some((o) => o.value === v)) values[f.id] = v;
      else if (f.required) missing.push(f.caption);
    } else if (f.kind === "checks") {
      const ticked = Array.isArray(raw) ? raw : [];
      const picked = f.options.filter((o) => ticked.includes(o.value)).map((o) => o.value);
      if (picked.length) values[f.id] = picked; // never required: nothing ticked is just left out
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
// "caption: value unit", joined by "; ". A text field shows its string, a choice its option's caption and
// checks their captions, joined by ", ". It is what the transcript shows; the agent reads the values from
// the request's `form`.
export function formMessage(text: string, fields: UiFormField[], values: FormValues): string {
  const parts = fields.flatMap((f): string[] => {
    const v = values[f.id];
    if (v === undefined) return [];
    if (f.kind === "number") return typeof v === "number" ? [`${f.caption}: ${withUnit(v, f.unit)}`] : [];
    if (f.kind === "text") return typeof v === "string" ? [`${f.caption}: ${v}`] : [];
    if (f.kind === "choice") {
      const option = f.options.find((o) => o.value === v);
      return option ? [`${f.caption}: ${option.caption}`] : [];
    }
    if (f.kind !== "checks") return [];
    const captions = f.options.filter((o) => Array.isArray(v) && v.includes(o.value)).map((o) => o.caption);
    return captions.length ? [`${f.caption}: ${captions.join(", ")}`] : [];
  });
  return parts.length ? `${text}: ${parts.join("; ")}` : text;
}

// The request's `form`: the submit action's payload with the answers added as `values`.
export function formRequest(payload: Record<string, unknown> | undefined, values: FormValues): Record<string, unknown> {
  return { ...(payload ?? {}), values };
}
