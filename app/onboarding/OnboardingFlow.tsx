"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Answer, NodeType, RenderedNode } from "@/lib/onboarding/types";
import { ErrorBanner } from "./_components/shared";
import { SystemScreen } from "./_components/SystemScreen";
import { Consent } from "./_components/Consent";
import { SingleSelect } from "./_components/SingleSelect";
import { MultiSelect } from "./_components/MultiSelect";
import { PairingCards } from "./_components/PairingCards";
import { FreeText } from "./_components/FreeText";
import { FreeTextSearch } from "./_components/FreeTextSearch";
import { BiometricsForm } from "./_components/BiometricsForm";
import { DayOrderPicker } from "./_components/DayOrderPicker";
import { DayMealPicker } from "./_components/DayMealPicker";
import { ConfirmEdit } from "./_components/ConfirmEdit";
import { SummaryScreen } from "./_components/SummaryScreen";
import { DiscoveryProgress } from "./_components/DiscoveryProgress";

/** Never rejects — both StrictMode subscribers read the same settled result. */
async function commitProfile(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/onboarding/commit", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save your profile" };
  }
}

interface NodeResponse {
  node?: RenderedNode;
  item?: string;
  done?: boolean;
  canGoBack?: boolean;
  previousAnswer?: Answer; // set when landing on an already-answered node (Back / confirm_edit rewind)
  error?: string;
}

const COMPONENT_BY_TYPE: Record<NodeType, typeof SystemScreen> = {
  system: SystemScreen,
  consent: Consent,
  single_select: SingleSelect,
  multi_select: MultiSelect,
  pairing_cards: PairingCards,
  free_text: FreeText,
  free_text_search: FreeTextSearch,
  biometrics_form: BiometricsForm,
  day_order_picker: DayOrderPicker,
  day_meal_picker: DayMealPicker,
  confirm_edit: ConfirmEdit,
  summary: SummaryScreen,
};

export function OnboardingFlow() {
  const router = useRouter();
  const [node, setNode] = useState<RenderedNode | null>(null);
  const [item, setItem] = useState<string | undefined>(undefined);
  const [canBack, setCanBack] = useState(false);
  const [previousAnswer, setPreviousAnswer] = useState<Answer | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Synchronous guards against duplicate in-flight requests — `submitting` state alone has a
  // window where a fast double-click/double-tap (or React StrictMode's dev-mode double effect
  // invocation) can fire two requests before a re-render disables the button. A ref is set
  // BEFORE any async work starts, so the second attempt bails out immediately, not just once
  // React catches up. Confirmed via testing: without this, two concurrent /answer calls for
  // the same node can race — one gets rejected as stale, and depending on timing the surviving
  // write can leave history/memory in a genuinely inconsistent state.
  const stateInFlight = useRef(false);
  const answerInFlight = useRef(false);
  const backInFlight = useRef(false);

  // Guards a DIFFERENT race than the *InFlight refs above: those stop a duplicate request for
  // the SAME node's already-in-flight answer, but a genuine rapid double-click/double-tap can
  // have its second event arrive AFTER the first click's full round trip already completed and
  // swapped in a new node — landing on whatever's now rendered at the same screen position
  // (e.g. a freshly-mounted node's Continue button, or a SingleSelect option that auto-submits
  // on tap). Confirmed via repro: double-clicking Continue on n_favorite_recipes silently
  // auto-submitted n_protein_exclusion_cards' default (select_all_by_default) answer the instant
  // it mounted, with zero real interaction — invisible to the user, since transitions are
  // deliberately instant/gap-free. A short ignore-window right after a node mounts filters out
  // that phantom second event without being perceptible as lag for a deliberate next click.
  const nodeMountedAt = useRef(0);
  const PHANTOM_CLICK_WINDOW_MS = 300;

  const applyResponse = useCallback((data: NodeResponse) => {
    if (data.done) {
      setDone(true);
      return;
    }
    nodeMountedAt.current = Date.now();
    setNode(data.node ?? null);
    setItem(data.item);
    setCanBack(Boolean(data.canGoBack));
    // Always assigned, never merged: a forward move sends no previousAnswer, and leaving the
    // last one in place would prefill the NEXT screen with the previous screen's answer.
    setPreviousAnswer(data.previousAnswer);
  }, []);

  const loadState = useCallback(async () => {
    if (stateInFlight.current) return;
    stateInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/state");
      const data: NodeResponse = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      applyResponse(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load onboarding");
    } finally {
      setLoading(false);
      stateInFlight.current = false;
    }
  }, [applyResponse]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleAnswer = useCallback(
    async (answer: Answer) => {
      if (!node || answerInFlight.current) return;
      if (Date.now() - nodeMountedAt.current < PHANTOM_CLICK_WINDOW_MS) return; // see nodeMountedAt's comment above
      answerInFlight.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/onboarding/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ node_id: node.id, item, answer }),
        });
        const data: NodeResponse = await res.json();
        if (res.status === 409) {
          // Stale client state (e.g. a slow retry after the flow already advanced) — resync.
          applyResponse(data);
          setError("Let's pick up from here.");
          return;
        }
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        applyResponse(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your answer");
      } finally {
        setSubmitting(false);
        answerInFlight.current = false;
      }
    },
    [node, item, applyResponse]
  );

  const handleBack = useCallback(async () => {
    if (backInFlight.current) return;
    if (Date.now() - nodeMountedAt.current < PHANTOM_CLICK_WINDOW_MS) return; // see nodeMountedAt's comment above
    backInFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/back", { method: "POST" });
      const data: NodeResponse = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      applyResponse(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't go back");
    } finally {
      setSubmitting(false);
      backInFlight.current = false;
    }
  }, [applyResponse]);

  // n_compile isn't user-facing (design doc: "not a user-facing node") — the moment it's
  // reached, commit immediately rather than rendering a screen for it.
  //
  // The POST is cached as a PROMISE rather than gated by an in-flight ref. Under React
  // StrictMode's dev-mode double-invoke a ref guard strands the user: the first invocation
  // fires the request and is then cancelled by its own cleanup, the second bails on the ref,
  // and the 200 that comes back is discarded by both — onboarding commits server-side but
  // never advances past this screen. Caching the promise gives both invocations the same
  // result to subscribe to, so there is still exactly one POST and whichever subscriber is
  // live applies it. (Same shape as SummaryScreen's fetch, same reason.)
  const commitCall = useRef<Promise<{ ok: true } | { ok: false; error: string }> | null>(null);
  useEffect(() => {
    if (node?.id !== "n_compile") return;
    let cancelled = false;
    commitCall.current ??= commitProfile();
    answerInFlight.current = true;
    setSubmitting(true);
    commitCall.current.then((result) => {
      if (cancelled) return;
      if (result.ok) setDone(true);
      else setError(result.error);
      setSubmitting(false);
      answerInFlight.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [node]);

  // Replaces the old "You're all set" panel. That screen's "Go to my plan" was a trap: recipe
  // discovery starts around here and runs for minutes, so the button handed the user an empty
  // plan. DiscoveryProgress holds the same position — after n_compile has committed — and gates
  // the same navigation on the job actually finishing.
  if (done) {
    return <DiscoveryProgress onContinue={() => router.replace("/zestil")} />;
  }

  // n_compile is committed by the effect above, never interacted with. Rendering it through
  // COMPONENT_BY_TYPE would flash its content row — which is an authoring note, not user copy —
  // and put a live "Get started" button on screen mid-commit.
  if (loading || !node || node.id === "n_compile") {
    return (
      <div className="min-h-screen bg-warm flex items-center justify-center px-4 py-10">
        <p className="text-sm text-text-muted">{error ?? (node?.id === "n_compile" ? "Saving your profile…" : "Loading…")}</p>
      </div>
    );
  }

  const Component = COMPONENT_BY_TYPE[node.type];

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {Component ? (
          // key forces a full remount on every (node id, item) change — without it, React
          // reuses the same component instance across consecutive nodes of the SAME type
          // (e.g. n_protein_exclusion_cards -> n_carb_exclusion_cards are both multi_select,
          // or successive n_pairing_cards dish screens are all pairing_cards), and its
          // internal state (selections, checked sides) leaks from one node's answer into the
          // next one's submission.
          <Component
            key={`${node.id}:${item ?? ""}`}
            node={node}
            item={item}
            showBack={canBack}
            submitting={submitting}
            previousAnswer={previousAnswer}
            onAnswer={handleAnswer}
            onBack={handleBack}
          />
        ) : (
          <ErrorBanner>This step ({node.type}) isn&apos;t built yet.</ErrorBanner>
        )}
      </div>
    </div>
  );
}
