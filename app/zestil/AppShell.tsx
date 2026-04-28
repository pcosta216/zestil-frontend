"use client";

import { useState } from "react";
import { ExploreTab } from "./ExploreTab";
import { SavedTab } from "./SavedTab";
import SignOutButton from "./SignOutButton";
import type { RecipeCollection } from "@/lib/supabase/queries";

type Tab = "plan" | "explore" | "groceries" | "saved" | "profile";

interface Props {
  user: { id: string; email: string; initials: string };
  initialRecipes: RecipeCollection[];
}

export function AppShell({ user, initialRecipes }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("explore");

  return (
    <div className="flex flex-col h-dvh max-w-2xl mx-auto bg-warm">
      <header className="flex items-center justify-between px-5 py-4 border-b border-[rgba(0,0,0,0.07)] flex-shrink-0">
        <span className="font-display text-[22px] tracking-tight text-text-main">
          Zestil<span className="text-green-primary">.</span>
        </span>
        <div className="flex items-center gap-2.5">
          {activeTab === "explore" && (
            <span className="text-[12px] font-medium text-green-primary bg-green-light px-3 py-1 rounded-full border border-green-border">
              Week of {currentWeekLabel()}
            </span>
          )}
          {activeTab === "saved" && <SignOutButton />}
          <div className="w-8 h-8 rounded-full bg-green-mid flex items-center justify-center text-[12px] font-medium text-green-dark">
            {user.initials}
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className={activeTab === "explore" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
          <ExploreTab />
        </div>
        <div className={activeTab === "saved" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
          <SavedTab recipes={initialRecipes} />
        </div>
        <div className={["plan", "groceries", "profile"].includes(activeTab) ? "flex-1 flex flex-col items-center justify-center gap-2 text-text-muted" : "hidden"}>
          <span className="text-3xl">🌱</span>
          <p className="text-sm">Coming soon</p>
        </div>
      </div>

      <nav className="flex bg-white border-t border-[rgba(0,0,0,0.07)] flex-shrink-0">
        {NAV_ITEMS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as Tab)}
            className={`flex-1 flex flex-col items-center gap-0.5 pt-2.5 pb-3 bg-transparent border-none cursor-pointer transition-colors ${
              activeTab === id ? "text-green-primary" : "text-[#B4B2A9]"
            }`}
          >
            {icon}
            <span className="text-[10px] font-medium">{label}</span>
            {activeTab === id && (
              <div className="w-1 h-1 rounded-full bg-green-mid" />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

function currentWeekLabel() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const NAV_ITEMS = [
  {
    id: "plan",
    label: "Plan",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    ),
  },
  {
    id: "explore",
    label: "Explore",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    id: "groceries",
    label: "Groceries",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
    ),
  },
  {
    id: "saved",
    label: "Saved",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
      </svg>
    ),
  },
  {
    id: "profile",
    label: "Profile",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];
