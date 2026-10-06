export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function formatTime(value: string): string {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? `${trimmed} min` : trimmed;
}

export function formatDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime()))
      return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  return value;
}
