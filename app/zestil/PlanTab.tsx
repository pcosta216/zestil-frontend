"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { Heart } from "@/lib/icons";
import { WeekdayRecipeCard } from "@/components/WeekdayRecipeCard";
import { WeekdayGrid, type MacroData } from "@/components/WeekdayGrid";

// ── Types ──────────────────────────────────────────────────────────────────────

type ResponseType =
  | "week_plan"
  | "day_update"
  | "recipe_list"
  | "recipe"
  | "macro_summary"
  | "suggestion_pending"
  | "ingredients_list"
  | "info";

interface MealCard {
  entry_id:           string;
  entry_type?:        string;
  day:                string;
  date:               string;
  meal_slot:          string;
  name:               string;
  serving_multiplier?: number;
  quantity_g?:        number;
  macros:             { kcal: number; protein: number; carbs: number; fat: number; sugar: number; sodium: number };
  agent_suggestion?:  any;
  confirmed:          boolean;
  notes?:             string | null;
  metadata:           Record<string, any>;
  meal_summary?:      { weekday?: string; kcal?: number; protein?: number; carbs?: number; fat?: number; sugar?: number; sodium?: number; [key: string]: unknown };
  recipe_uuid?:       string;
}

type IngredientCard = string;

type AgentMessage = {
  id: string;
  type: "agent";
  content: string;
  responseType: ResponseType;
  mealCards?: MealCard[];
  ingredientCards?: IngredientCard[];
  changedDates?: string[];
  quickReplies?: string[];
  metadata?: Record<string, any>;
  recipeUuid?: string;
};

type UserMessage = {
  id: string;
  type: "user";
  content: string;
};

type Message = AgentMessage | UserMessage;
type HistoryEntry = { role: "user" | "agent"; content: string };

// ── Sub-components ─────────────────────────────────────────────────────────────

function AgentIcon() {
  return (
    <div className="w-7 h-7 rounded-full bg-green-light border border-green-border flex items-center justify-center flex-shrink-0 mt-0.5">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3B6D11" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5 items-start">
      <AgentIcon />
      <div className="flex gap-1 px-4 py-3 bg-white border border-[rgba(0,0,0,0.08)]" style={{ borderRadius: "4px 16px 16px 16px" }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-green-border block" style={{ animation: `chat-bounce 1.2s infinite ${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  );
}

// ── Plan text bubble — used for week_plan and day_update ──────────────────────

function PlanBubble({ content, changedDates }: { content: string; changedDates?: string[] }) {
  const lines = content.split("\n");

  return (
    <div className="bg-white border border-[rgba(0,0,0,0.08)] px-4 py-3 text-[13px] leading-relaxed text-text-main overflow-x-auto" style={{ borderRadius: "4px 16px 16px 16px" }}>
      {lines.map((line, i) => {
        // Day header line detection — e.g. "Thursday, Apr 30" or "Thursday, Apr 30 (Today)"
        const isDay = /^[A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d+/.test(line.trim());
        // Total line
        const isTotal = line.trim().toLowerCase().startsWith("total:");
        // Meal slot lines
        const isMealSlot = /^(Breakfast|Lunch|Dinner|Snack):/i.test(line.trim());

        // Highlight changed day headers
        const dateMatch = line.match(/\d{4}-\d{2}-\d{2}/);
        const isChanged = changedDates?.length && dateMatch && changedDates.includes(dateMatch[0]);

        if (isDay) {
          return (
            <div key={i} className={`font-semibold text-[13.5px] mt-3 mb-1 first:mt-0 flex items-center gap-2 ${isChanged ? "text-green-primary" : "text-text-main"}`}>
              {line.trim()}
              {isChanged && <span className="text-[10px] font-medium bg-green-light text-green-primary border border-green-border px-2 py-0.5 rounded-full">updated</span>}
            </div>
          );
        }
        if (isTotal) {
          return <div key={i} className="text-[11.5px] text-text-muted mb-1.5">{line.trim()}</div>;
        }
        if (isMealSlot) {
          return <div key={i} className="text-[13px] text-text-main ml-2 leading-snug">{line.trim()}</div>;
        }
        if (!line.trim()) return <div key={i} className="h-2" />;
        return <div key={i} className="chat-markdown"><Markdown remarkPlugins={[remarkBreaks]}>{line}</Markdown></div>;
      })}
    </div>
  );
}

// ── Recipe list ───────────────────────────────────────────────────────────────

function RecipeListBubble({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <div className="bg-white border border-[rgba(0,0,0,0.08)] px-4 py-3 text-[13.5px] leading-relaxed text-text-main" style={{ borderRadius: "4px 16px 16px 16px" }}>
      <div className="chat-markdown"><Markdown remarkPlugins={[remarkBreaks]}>{content}</Markdown></div>
    </div>
  );
}

// ── Macro summary ring ────────────────────────────────────────────────────────

function MacroSummaryBubble({ content }: { content: string }) {
  // Parse kcal consumed / goal from the response text if present
  const kcalMatch = content.match(/(\d+)\s*(?:kcal|cal).*?\/?\s*(\d+)/i);
  const consumed  = kcalMatch ? parseInt(kcalMatch[1]) : null;
  const goal      = kcalMatch ? parseInt(kcalMatch[2]) : null;
  const pct       = consumed && goal ? Math.min(consumed / goal, 1) : null;

  const r   = 28;
  const circ = 2 * Math.PI * r;

  return (
    <div className="flex flex-col gap-2">
      {pct !== null && (
        <div className="bg-white border border-[rgba(0,0,0,0.08)] rounded-2xl px-4 py-3 flex items-center gap-4">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r={r} fill="none" stroke="#C8EDFE" strokeWidth="7" />
            <circle
              cx="36" cy="36" r={r} fill="none"
              stroke="#23BCFD" strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${circ * pct} ${circ}`}
              transform="rotate(-90 36 36)"
            />
            <text x="36" y="40" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1A1A18">
              {Math.round(pct * 100)}%
            </text>
          </svg>
          <div className="text-[12px] text-text-muted">
            <div className="text-[15px] font-semibold text-text-main">{consumed} kcal</div>
            of {goal} kcal goal
          </div>
        </div>
      )}
      <div className="bg-white border border-[rgba(0,0,0,0.08)] px-4 py-3 text-[13.5px] leading-relaxed text-text-main" style={{ borderRadius: pct !== null ? "16px" : "4px 16px 16px 16px" }}>
        <div className="chat-markdown"><Markdown remarkPlugins={[remarkBreaks]}>{content}</Markdown></div>
      </div>
    </div>
  );
}

// ── Suggestion pending ────────────────────────────────────────────────────────

function SuggestionBubble({ content, onConfirm, onReject }: { content: string; onConfirm: () => void; onReject: () => void }) {
  const [acted, setActed] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-white border border-[rgba(0,0,0,0.08)] px-4 py-3 text-[13.5px] leading-relaxed text-text-main" style={{ borderRadius: "4px 16px 16px 16px" }}>
        <div className="chat-markdown"><Markdown remarkPlugins={[remarkBreaks]}>{content}</Markdown></div>
      </div>
      {!acted && (
        <div className="flex gap-2">
          <button
            onClick={() => { setActed(true); onConfirm(); }}
            className="flex-1 text-[12.5px] font-medium text-white bg-green-primary rounded-full py-2 hover:bg-green-dark transition-colors"
          >
            Confirm change
          </button>
          <button
            onClick={() => { setActed(true); onReject(); }}
            className="flex-1 text-[12.5px] font-medium text-text-muted bg-white border border-[rgba(0,0,0,0.1)] rounded-full py-2 hover:border-text-muted transition-colors"
          >
            Keep original
          </button>
        </div>
      )}
    </div>
  );
}

// ── Message renderer ──────────────────────────────────────────────────────────

function AgentBubble({ msg, onSend }: { msg: AgentMessage; onSend: (text: string) => void }) {
  const rt = msg.responseType;

  let body: React.ReactNode;

  if (rt === "week_plan" || rt === "day_update") {
    body = <PlanBubble content={msg.content} changedDates={rt === "day_update" ? msg.changedDates : undefined} />;
  } else if (rt === "recipe_list") {
    body = <RecipeListBubble content={msg.content} />;
  } else if (rt === "macro_summary") {
    body = <MacroSummaryBubble content={msg.content} />;
  } else if (rt === "suggestion_pending") {
    body = (
      <SuggestionBubble
        content={msg.content}
        onConfirm={() => onSend("Yes, confirm the change")}
        onReject={() => onSend("No, keep the original")}
      />
    );
  } else {
    const imageUrl = rt === "recipe" ? (msg.metadata?.media?.image_url as string | undefined) : undefined;
    body = (
      <div className="bg-white border border-[rgba(0,0,0,0.08)] overflow-hidden text-[13.5px] leading-relaxed text-text-main" style={{ borderRadius: "4px 16px 16px 16px" }}>
        {imageUrl && (
          <img src={imageUrl} alt="" className="w-full h-36 object-cover" />
        )}
        <div className="px-4 py-3 chat-markdown"><Markdown remarkPlugins={[remarkBreaks]}>{msg.content}</Markdown></div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 items-start max-w-[95%]">
      <AgentIcon />
      <div className="flex flex-col gap-1.5 min-w-0 w-full">
        {body}
      </div>
    </div>
  );
}

function ordinalDate(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  const d = new Date(dateStr + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day   = d.getDate();
  const suffix = [11, 12, 13].includes(day) ? "th"
    : day % 10 === 1 ? "st"
    : day % 10 === 2 ? "nd"
    : day % 10 === 3 ? "rd" : "th";
  return `${month} ${day}${suffix}`;
}

function groupByDay(cards: MealCard[]) {
  const groups = new Map<string, MealCard[]>();
  for (const card of cards) {
    const weekday = card.meal_summary?.weekday ?? card.day ?? "Unknown";
    if (!groups.has(weekday)) groups.set(weekday, []);
    groups.get(weekday)!.push(card);
  }
  return groups;
}

function DayGrids({ cards, goals, mealSlots, onSend }: { cards: MealCard[]; goals: MacroData | null; mealSlots: string[]; onSend: (text: string) => void }) {
  const groups = groupByDay(cards);
  return (
    <div className="flex flex-col gap-2 -mx-2">
      {Array.from(groups.entries()).map(([weekday, dayCards]) => {
        const isEmpty = dayCards.every((c) => c.entry_type === "empty");
        const realCards = isEmpty ? [] : dayCards.filter((c) => c.entry_type !== "empty");
        const sorted = !isEmpty && mealSlots.length
          ? [...realCards].sort((a, b) => {
              const ai = mealSlots.findIndex((s) => s.toLowerCase() === a.meal_slot?.toLowerCase());
              const bi = mealSlots.findIndex((s) => s.toLowerCase() === b.meal_slot?.toLowerCase());
              return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            })
          : realCards;
        return (
          <WeekdayGrid
            key={weekday}
            weekday={weekday}
            date={ordinalDate(dayCards[0]?.date)}
            macros={realCards.reduce<MacroData>((acc, c) => ({
              kcal:    (acc.kcal    ?? 0) + (c.macros?.kcal    ?? 0),
              protein: (acc.protein ?? 0) + (c.macros?.protein ?? 0),
              carbs:   (acc.carbs   ?? 0) + (c.macros?.carbs   ?? 0),
              fat:     (acc.fat     ?? 0) + (c.macros?.fat     ?? 0),
              sugar:   (acc.sugar   ?? 0) + (c.macros?.sugar   ?? 0),
              sodium:  (acc.sodium  ?? 0) + (c.macros?.sodium  ?? 0),
            }), {})}
            goals={goals ?? undefined}
          >
            {isEmpty ? (
              <div className="px-3 py-2.5 text-[12px] text-text-muted italic">
                Not planned yet — ask me to add something
              </div>
            ) : (
              sorted.map((card, i) => (
                <WeekdayRecipeCard
                  key={card.entry_id ?? `${card.name}-${i}`}
                  title={card.name}
                  subtitle={card.meal_slot}
                  kcal={card.macros?.kcal}
                  servings_value={card.metadata?.metadata?.servings_value}
                  protein={card.macros?.protein}
                  hasSuggestion={card.agent_suggestion?.status === "pending"}
                  hasNotes={!!card.notes}
                  onMore={() => onSend(`Tell me more about "${card.name}"`)}
                  onDelete={() => onSend(`Remove "${card.name}" from my ${weekday} plan`)}
                />
              ))
            )}
          </WeekdayGrid>
        );
      })}
    </div>
  );
}

function IngredientList({ cards, onSend }: { cards: IngredientCard[]; onSend: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-1 -mx-2">
      {cards.map((name, i) => (
        <WeekdayRecipeCard
          key={`${name}-${i}`}
          title={name}
          cardVariant="ingredient"
          onAdd={() => onSend(`Add "${name}" to my plan`)}
        />
      ))}
    </div>
  );
}

// ── PlanTab ───────────────────────────────────────────────────────────────────

const INITIAL_MESSAGES: Message[] = [];

const WELCOME_MESSAGE: AgentMessage = {
  id:           "welcome",
  type:         "agent",
  responseType: "info",
  content:      "Hi! I'm your meal planner. Ask me to show your week, add a recipe, or adjust a day's macros.",
};

const DEFAULT_QUICK_REPLIES = ["Show my week", "What's for dinner today?", "How are my macros?", "Add a recipe"];

export function PlanTab({ collections: rawCollections = [], onRecipeSaved }: { collections?: { id: number; name: string }[]; onRecipeSaved?: () => void }) {
  const collections = rawCollections.filter((c) => c.name.toLowerCase() !== "main");
  const [messages, setMessages]         = useState<Message[]>(INITIAL_MESSAGES);
  const [isTyping, setIsTyping]         = useState(false);
  const [input, setInput]               = useState("");
  const [quickReplies, setQuickReplies] = useState(DEFAULT_QUICK_REPLIES);
  const [macroGoals, setMacroGoals]     = useState<MacroData | null>(null);
  const [mealSlots, setMealSlots]       = useState<string[]>([]);
  const [pickerMsgId,    setPickerMsgId]    = useState<string | null>(null);
  const [checked,        setChecked]        = useState<Set<number>>(new Set());
  const [hearted,        setHearted]        = useState<Set<string>>(new Set());
  const [saving,         setSaving]         = useState<Set<string>>(new Set());
  const [saved,          setSaved]          = useState<Set<string>>(new Set());
  const [selectedSlots,  setSelectedSlots]  = useState<Map<string, string>>(new Map());
  const [banner,         setBanner]         = useState<{ type: "success" | "info" | "error"; message: string } | null>(null);
  const chatRef                         = useRef<HTMLDivElement>(null);
  const textareaRef                     = useRef<HTMLTextAreaElement>(null);
  const apiHistory                      = useRef<HistoryEntry[]>([]);
  const sessionId                       = useRef(crypto.randomUUID());
  const activeDate                      = useRef<string | null>(null);
  const weekStartDay                    = useRef<number>(0);
  const bannerTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showBanner(b: { type: "success" | "info" | "error"; message: string }) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(b);
    bannerTimer.current = setTimeout(() => setBanner(null), 5000);
  }

  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  useEffect(() => {
    fetch("/api/goals")
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) {
          if (data.macro_goals) setMacroGoals(data.macro_goals);
          if (Array.isArray(data.preferences?.meal_slots)) setMealSlots(data.preferences.meal_slots);
          const pref = data.preferences?.week_start_day;
          weekStartDay.current = (pref === "monday" || pref === 1) ? 1 : 0;
        }
      })
      .catch((e) => console.error("[goals] error:", e));
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, isTyping]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return;

    const userMsg: Message = { id: Date.now().toString(), type: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsTyping(true);

    const historySnapshot = [...apiHistory.current];
    apiHistory.current.push({ role: "user", content: text });

    console.log(`[plan] sending message: "${text.slice(0, 80)}" active_date=${activeDate.current}`)
    console.log(`[plan] history (${historySnapshot.length} turns):`, historySnapshot.map((h, i) => ({
      i,
      role:    h.role,
      preview: h.content.slice(0, 120),
    })))

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:        text,
          session_id:     sessionId.current,
          history:        historySnapshot,
          active_date:    activeDate.current,
          week_start_day: weekStartDay.current,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      console.log("[plan] raw response:", data);
      const { response, response_type, meal_cards, ingredient_cards, quick_replies, changed_dates } = data;

      // Update active date from the most recent day the agent touched
      const datesInResponse: string[] = [
        ...(changed_dates ?? []),
        ...(meal_cards ?? []).map((c: MealCard) => c.date).filter(Boolean),
      ]
      if (datesInResponse.length === 1 || new Set(datesInResponse).size === 1) {
        activeDate.current = datesInResponse[0]
      } else if (datesInResponse.length > 1) {
        // multiple days shown (week view) — clear the single-day context
        activeDate.current = null
      }

      const agentMsg: AgentMessage = {
        id:              `agent-${Date.now()}`,
        type:            "agent",
        content:         response?.trim() || "Sorry, I couldn't generate a response.",
        responseType:    (response_type as ResponseType) ?? "info",
        mealCards:       meal_cards?.length ? meal_cards : undefined,
        ingredientCards: ingredient_cards?.length ? ingredient_cards : undefined,
        changedDates:    changed_dates?.length ? changed_dates : undefined,
        metadata:        data.metadata ?? undefined,
        recipeUuid:      data.recipe_uuid,
      };

      setMessages((prev) => [...prev, agentMsg]);
      apiHistory.current.push({ role: "agent", content: agentMsg.content });
      if (quick_replies?.length) setQuickReplies(quick_replies);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, type: "agent", responseType: "info", content: `Error: ${msg}` }]);
    } finally {
      setIsTyping(false);
    }
  }, [isTyping]);

  useEffect(() => {
    const text = "Show my plan for today";
    setIsTyping(true);
    apiHistory.current.push({ role: "user", content: text });
    fetch("/api/plan", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: text, session_id: sessionId.current, history: [], active_date: activeDate.current, week_start_day: weekStartDay.current }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data) => {
        const { response, response_type, meal_cards, ingredient_cards, quick_replies, changed_dates } = data;
        const agentMsg: AgentMessage = {
          id:             `agent-${Date.now()}`,
          type:           "agent",
          content:        response?.trim() || "",
          responseType:   (response_type as ResponseType) ?? "info",
          mealCards:      meal_cards?.length      ? meal_cards      : undefined,
          ingredientCards: ingredient_cards?.length ? ingredient_cards : undefined,
          changedDates:   changed_dates?.length   ? changed_dates   : undefined,
          metadata:       data.metadata ?? undefined,
        };
        apiHistory.current.push({ role: "agent", content: agentMsg.content });
        setMessages([agentMsg, WELCOME_MESSAGE]);
        if (quick_replies?.length) setQuickReplies(quick_replies);
      })
      .catch(() => setMessages([WELCOME_MESSAGE]))
      .finally(() => setIsTyping(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={chatRef} className="flex-1 overflow-y-auto no-scrollbar px-5 py-5 flex flex-col gap-3.5">
        <div className="text-[11px] font-medium text-text-muted uppercase tracking-wide text-center my-1">
          Today
        </div>

        {messages.map((msg) =>
          msg.type === "user" ? (
            <div
              key={msg.id}
              className="bg-green-primary text-white text-[13.5px] leading-relaxed self-end max-w-[82%] px-4 py-3"
              style={{ borderRadius: "16px 4px 16px 16px" }}
            >
              {msg.content}
            </div>
          ) : (
            <React.Fragment key={msg.id}>
              {!(msg.mealCards?.length) && <AgentBubble msg={msg} onSend={sendMessage} />}
              {msg.responseType === "recipe" && (
                <>
                  {pickerMsgId === msg.id && (
                    <div className="fixed inset-0 z-[9]" onClick={() => {
                      setHearted((prev) => { const next = new Set(prev); next.delete(msg.id); return next; });
                      setPickerMsgId(null);
                    }} />
                  )}
                  <div className="ml-[38px] flex items-center justify-between gap-2">
                    <div className="relative">
                      <button
                        disabled={saving.has(msg.id) || saved.has(msg.id)}
                        onClick={() => {
                          if (saved.has(msg.id)) return;
                          setHearted((prev) => { const next = new Set(prev); next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id); return next; });
                          setPickerMsgId((prev) => prev === msg.id ? null : msg.id);
                          setChecked(new Set());
                        }}
                        className="transition-colors outline-none disabled:cursor-default"
                      >
                        <Heart
                          size={18}
                          strokeWidth={1.5}
                          className={
                            saved.has(msg.id)     ? "text-green-primary fill-green-primary"
                            : saving.has(msg.id)  ? "text-amber-400 fill-amber-400 animate-pulse"
                            : hearted.has(msg.id) ? "text-amber-400 fill-amber-400"
                            : "text-green-primary"
                          }
                        />
                      </button>
                      {pickerMsgId === msg.id && (
                        <div className="absolute bottom-full mb-1.5 left-0 bg-white/50 backdrop-blur-sm border border-[rgba(0,0,0,0.07)] rounded-2xl shadow-xl w-48 z-10 flex flex-col max-h-[60vh]">
                          <div className="px-3 py-2 border-b border-[rgba(0,0,0,0.06)] flex-shrink-0">
                            <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide">Collections</span>
                          </div>
                          <div className="flex-1 overflow-y-auto py-1">
                            {collections.length === 0 ? (
                              <p className="text-[12px] text-text-muted px-3 py-2">No collections yet</p>
                            ) : (
                              collections.map((col) => (
                                <label key={col.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-warm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked.has(col.id)}
                                    onChange={() => setChecked((prev) => { const next = new Set(prev); next.has(col.id) ? next.delete(col.id) : next.add(col.id); return next; })}
                                    className="accent-green-primary w-3.5 h-3.5"
                                  />
                                  <span className="text-[12px] text-text-main">{col.name}</span>
                                </label>
                              ))
                            )}
                          </div>
                          <div className="px-3 py-2 border-t border-[rgba(0,0,0,0.06)] flex-shrink-0">
                            <button
                              disabled={saving.has(msg.id)}
                              onClick={async () => {
                                setPickerMsgId(null);
                                setSaving((prev) => new Set(prev).add(msg.id));
                                showBanner({ type: "info", message: "We're cooking the data — we'll let you know when it's ready" });
                                try {
                                  const recipeUuid = msg.recipeUuid ?? (msg.responseType === "recipe" ? msg.mealCards?.[0]?.recipe_uuid : null);
                                  let savedUuid: string | null = recipeUuid ?? null;
                                  if (recipeUuid) {
                                    const res = await fetch("/api/recipe/link", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ recipe_uuid: recipeUuid }),
                                    });
                                    if (!res.ok) throw new Error("link failed");
                                  } else {
                                    const res = await fetch("/api/recipe/submit", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ text: msg.content }),
                                    });
                                    if (!res.ok) throw new Error("submit failed");
                                    const data = await res.json();
                                    savedUuid = data.recipe_uuid ?? null;
                                  }
                                  if (checked.size > 0 && savedUuid) {
                                    await fetch("/api/recipe/collections", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ recipe_uuid: savedUuid, collection_ids: Array.from(checked) }),
                                    });
                                  }
                                  setSaved((prev) => new Set(prev).add(msg.id));
                                  setHearted((prev) => { const next = new Set(prev); next.delete(msg.id); return next; });
                                  showBanner({ type: "success", message: recipeUuid ?  "We're cooking the data — we'll let you know when it's ready" : "Recipe added to your collection!"});
                                  onRecipeSaved?.();
                                } catch {
                                  setHearted((prev) => { const next = new Set(prev); next.delete(msg.id); return next; });
                                  showBanner({ type: "error", message: "Couldn't save the recipe. Please try again." });
                                } finally {
                                  setSaving((prev) => { const next = new Set(prev); next.delete(msg.id); return next; });
                                }
                              }}
                              className="w-full text-[11px] font-medium text-white bg-green-primary hover:bg-green-dark rounded-full py-1.5 transition-colors outline-none disabled:opacity-60"
                            >
                              {saving.has(msg.id) ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto">
                      {["+ Dinner", "+ Lunch", "+ Snack"].map((label) => {
                        const isSelected = selectedSlots.get(msg.id) === label;
                        return (
                          <button
                            key={label}
                            onClick={() => setSelectedSlots((prev) => {
                              const next = new Map(prev);
                              next.set(msg.id, isSelected ? "" : label);
                              return next;
                            })}
                            className={`text-[11px] font-medium rounded-full px-2.5 py-1 transition-colors outline-none whitespace-nowrap border ${
                              isSelected
                                ? "text-green-primary bg-green-light border-green-border"
                                : "text-text-muted bg-white border-[rgba(0,0,0,0.08)] hover:text-green-primary hover:border-green-border"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
              {(msg.mealCards?.length ?? 0) > 0 && (
                <DayGrids cards={msg.mealCards!} goals={macroGoals} mealSlots={mealSlots} onSend={sendMessage} />
              )}
              {msg.responseType === "ingredients_list" && (msg.ingredientCards?.length ?? 0) > 0 && (
                <IngredientList cards={msg.ingredientCards!} onSend={sendMessage} />
              )}
            </React.Fragment>
          )
        )}

        {isTyping && <TypingIndicator />}
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar px-5 py-2 flex-shrink-0">
        {quickReplies.map((qr) => (
          <button
            key={qr}
            onClick={() => sendMessage(qr)}
            className="flex-shrink-0 text-[12px] text-green-primary bg-green-light border border-green-border px-3.5 py-1.5 rounded-full cursor-pointer whitespace-nowrap hover:bg-green-border transition-colors"
          >
            {qr}
          </button>
        ))}
      </div>

      <div className={`fixed bottom-4 left-4 right-4 z-50 transition-all duration-300 ease-out ${banner ? "translate-y-0 opacity-100" : "translate-y-[120%] opacity-0 pointer-events-none"}`}>
        <div className={`rounded-2xl px-4 py-3 text-[13px] font-medium text-white shadow-lg ${banner?.type === "error" ? "bg-red-500" : banner?.type === "success" ? "bg-green-primary" : "bg-blue-500"}`}>
          {banner?.message}
        </div>
      </div>

      <div className="flex items-center gap-2.5 px-3.5 py-2.5 pb-3 bg-white border-t border-[rgba(0,0,0,0.07)] flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-mid flex-shrink-0" />
        <div className="flex-1 flex items-center">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 90) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Ask your planner…"
            rows={1}
            className="flex-1 bg-warm border border-[rgba(0,0,0,0.1)] rounded-[22px] pl-4 pr-11 py-2 text-[13.5px] text-text-main placeholder:text-[#B4B2A9] outline-none resize-none leading-relaxed overflow-y-auto focus:border-green-mid transition-colors"
            style={{ maxHeight: "90px" }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isTyping}
            className="-ml-9 z-10 flex-shrink-0 w-[30px] h-[30px] rounded-full bg-green-primary border-none flex items-center justify-center cursor-pointer disabled:opacity-40 hover:bg-green-dark transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
