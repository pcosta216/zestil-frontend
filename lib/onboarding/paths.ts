// Dotted-path get/set helpers over the UserMemory object (and the
// flow_position history entries' pre_write_snapshot). Shared by expr.ts
// (skip_if "X is empty" checks), options-filter.ts (exclude_source reads),
// and engine.ts (writes_to / repeat_for / other_capture appends / back
// revert). Paths are plain "a.b.c" strings — no array-index segments are
// used anywhere in this flow (every writes_to target is either a scalar
// field or a whole array field, never an indexed element), so this stays
// intentionally simple rather than a general JSONPath implementation.

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (cursor[key] == null || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

/** Appends a value into an array field at `path`, deduping by strict equality (arrays of primitives only, which is every appends_to/writes_to target in this flow). */
export function appendUnique(obj: Record<string, unknown>, path: string, value: unknown): void {
  const current = getPath(obj, path);
  const arr = Array.isArray(current) ? [...current] : [];
  if (!arr.includes(value)) arr.push(value);
  setPath(obj, path, arr);
}

export function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.length === 0;
  return false;
}
