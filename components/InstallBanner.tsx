"use client";

import { useEffect, useState } from "react";

type Mode = "android" | "ios" | null;

export function InstallBanner() {
  const [mode, setMode] = useState<Mode>(null);
  const [prompt, setPrompt] = useState<Event & { prompt?: () => Promise<void> } | null>(null);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("install-banner-dismissed")) return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone);

    if (isStandalone) return;

    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua) && !/crios/i.test(ua);

    if (isIos) {
      setMode("ios");
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Event & { prompt?: () => Promise<void> });
      setMode("android");
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    localStorage.setItem("install-banner-dismissed", "1");
    setMode(null);
  }

  async function install() {
    if (!prompt?.prompt) return;
    await prompt.prompt();
    dismiss();
  }

  if (!mode) return null;

  return (
    <div className="flex-shrink-0 bg-green-light border-b border-green-border px-4 py-2.5">
      {mode === "android" && !showIosSteps && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-green-dark leading-snug">
            Install Zestil for the best experience — no browser bar.
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={install}
              className="text-[11px] font-medium text-white bg-green-primary rounded-full px-3 py-1 hover:bg-green-dark transition-colors outline-none"
            >
              Install
            </button>
            <button onClick={dismiss} className="text-text-muted hover:text-text-main transition-colors outline-none" aria-label="Dismiss">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {mode === "ios" && !showIosSteps && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-green-dark leading-snug">
            Install Zestil for the best experience — no browser bar.
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowIosSteps(true)}
              className="text-[11px] font-medium text-white bg-green-primary rounded-full px-3 py-1 hover:bg-green-dark transition-colors outline-none"
            >
              How?
            </button>
            <button onClick={dismiss} className="text-text-muted hover:text-text-main transition-colors outline-none" aria-label="Dismiss">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {mode === "ios" && showIosSteps && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-green-dark leading-snug">
            Tap the <strong>Share</strong> button in Safari, then <strong>Add to Home Screen</strong>.
          </p>
          <button onClick={dismiss} className="text-text-muted hover:text-text-main transition-colors outline-none flex-shrink-0" aria-label="Dismiss">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
