"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

/**
 * On-load recipe setup check (ONBOARDING_CONTRACT §4). Fires the check once per app load and
 * returns true while a run is picking recipes. Hides itself when the row turns complete/failed
 * (Realtime on tbl_recipe_setup) and calls onDone so the caller can refresh its recipes.
 */
export function useRecipeSetup(userId: string, onDone: () => void) {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const channel = supabase
      .channel(`recipe-setup-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tbl_recipe_setup", filter: `account_key=eq.${userId}` },
        (payload) => {
          const status = (payload.new as { status?: string } | null)?.status;
          if (status === "running") setRunning(true);
          else if (status === "complete" || status === "failed") {
            setRunning(false);
            if (status === "complete") onDone();
          }
        },
      )
      .subscribe();

    fetch("/api/recipe-setup", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: string } | null) => {
        if (!cancelled && d?.status === "running") setRunning(true);
      })
      .catch(() => { /* silent — the next load checks again */ });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // onDone is intentionally excluded: the check is once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return running;
}
