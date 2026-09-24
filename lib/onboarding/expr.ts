import { getPath, isEmptyValue } from "./paths";

// NOT a general expression language. A grep of the whole flow (v4.7/v5.0)
// shows exactly these forms used in skip_if/branches.when:
//   item == 'other'
//   answer == 'edit'
//   answer == 'manage_a_health_condition'
//   taste_profile.favorite_dishes is empty
// plus one engine-computed structural check, "fewer than N options remain
// after options_filter" (protein/carb/fat only), which is NOT handled here
// — it depends on options-filter.ts's live filtered-options count, so
// engine.ts special-cases that literal pattern directly rather than routing
// it through this evaluator. Everything else is a plain pattern match, not
// an interpreter — safer, and matches what's actually authored.

export interface ExprContext {
  item?: string; // current repeat_for iteration value, if any
  answer?: unknown; // the answer just submitted (for branches.when)
  memory: Record<string, unknown>; // current user_memory, for "<path> is empty" checks
}

const EQUALS_LITERAL = /^(item|answer) == '([^']*)'$/;
const IS_EMPTY = /^([\w.]+) is empty$/;

export function evaluateCondition(expr: string, ctx: ExprContext): boolean {
  const trimmed = expr.trim();

  const eq = trimmed.match(EQUALS_LITERAL);
  if (eq) {
    const [, subject, literal] = eq;
    const value = subject === "item" ? ctx.item : ctx.answer;
    return value === literal;
  }

  const empty = trimmed.match(IS_EMPTY);
  if (empty) {
    const [, path] = empty;
    return isEmptyValue(getPath(ctx.memory, path));
  }

  throw new Error(`expr.ts: unrecognized condition "${expr}" — this flow's grammar is a fixed set of literal forms, not a general evaluator. See this file's header.`);
}
