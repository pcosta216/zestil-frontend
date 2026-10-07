"use client";

import { useEffect, useState } from "react";

interface Props {
  onCreated: (c: { id: number; name: string }) => void;
  className?: string;
  onDirtyChange?: (dirty: boolean) => void;
}

// "+ Create new collection" row for the end of a collections checklist. Swaps itself for an
// inline name input; the parent adds the returned collection to its list (and usually checks it).
export function CreateCollectionButton({ onCreated, className = "px-3 py-2", onDirtyChange }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = creating && name.trim().length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  function cancel() {
    setCreating(false);
    setName("");
    setError(null);
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/recipe/collections/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't create the collection.");
        return;
      }
      onCreated(data);
      cancel();
    } catch {
      setError("Couldn't create the collection.");
    } finally {
      setSaving(false);
    }
  }

  if (!creating) {
    return (
      <button
        type="button"
        onClick={() => setCreating(true)}
        className={`w-full text-left text-[12px] text-green-primary font-medium hover:bg-warm transition-colors ${className}`}
      >
        + Create new collection
      </button>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") create();
          if (e.key === "Escape") cancel();
        }}
        placeholder="Collection name"
        disabled={saving}
        className="w-full bg-warm border border-[rgba(0,0,0,0.1)] rounded-xl px-3 py-2 text-[13px] text-text-main placeholder:text-[#B4B2A9] outline-none focus:border-green-mid transition-colors disabled:opacity-60"
      />
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      {dirty && !saving && !error && (
        <p className="text-[11px] text-text-muted">Press Create (or Enter) to add this collection</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="flex-1 px-3 py-1.5 rounded-lg border border-[rgba(0,0,0,0.1)] text-[12px] text-text-main hover:bg-warm transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={create}
          disabled={!name.trim() || saving}
          className="flex-1 px-3 py-1.5 rounded-lg bg-green-primary hover:bg-green-primary/90 text-white text-[12px] font-medium transition-colors disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}
