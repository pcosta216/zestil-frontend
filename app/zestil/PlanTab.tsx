"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/browser";

interface MealCard {
  day: string;
  name: string;
  time: string;
}

type AgentMessage = {
  id: string;
  type: "agent";
  content: string;
  reasoning?: string;
  mealCards?: MealCard[];
  extraContent?: string;
  isStreaming?: boolean;
};

type HistoryEntry = { role: "user" | "agent"; content: string };

type UserMessage = {
  id: string;
  type: "user";
  content: string;
};

type Message = AgentMessage | UserMessage;

const INITIAL_MESSAGES: Message[] = [
  {
    id: "1",
    type: "agent",
    content:
      "Good morning! Ready to plan your week? I've noticed you tend to prefer lighter meals mid-week. Want me to build around that?",
  },
  {
    id: "2",
    type: "user",
    content: "Yes, and I need to use up the salmon in my fridge by Wednesday.",
  },
  {
    id: "3",
    type: "agent",
    content:
      "Perfect — I've drafted Mon–Wed with salmon as the anchor. Here's what I'm thinking:",
    reasoning:
      "The user has salmon that expires Wednesday — I should anchor Mon, Tue, Wed dinners around it to avoid waste. They prefer lighter mid-week meals so I'll lean toward salads and bowls rather than heavy bakes. I'll vary the preparation method across the three days so it doesn't feel repetitive: glazed bowl Monday, salad Tuesday, fishcakes Wednesday. Thu–Sun can be suggested separately once they confirm.",
    mealCards: [
      { day: "Monday", name: "Miso-glazed salmon bowl", time: "30 min" },
      { day: "Tuesday", name: "Salmon & lentil salad", time: "20 min" },
      { day: "Wednesday", name: "Salmon fishcakes", time: "35 min" },
    ],
    extraContent:
      "I can plan Thu–Sun too, or adjust any of these. What do you think?",
  },
  {
    id: "4",
    type: "user",
    content: "Love the bowl. Can you make Thursday vegetarian?",
  },
  {
    id: "5",
    type: "agent",
    content:
      "Thursday sorted! I'll suggest a hearty mushroom & lentil stew — warm and filling without the meat. Should I plan Friday and the weekend too?",
  },
];

const QUICK_REPLIES = [
  "Plan Thu–Sun",
  "Generate grocery list",
  "Swap Tuesday",
  "Keep it under 500 kcal",
  "Vegetarian options",
];

function parseMarkdown(text: string): string {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function AgentIcon() {
  return (
    <div className="w-7 h-7 rounded-full bg-green-light border border-green-border flex items-center justify-center flex-shrink-0 mt-0.5">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#3B6D11"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2" />
        <path d="M12 8v4l3 3" />
      </svg>
    </div>
  );
}

function ReasoningPill({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted bg-green-light border border-green-border rounded-full px-3 py-1 w-fit cursor-pointer transition-colors hover:bg-green-border"
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-green-mid"
          style={{ animation: open ? "none" : "pulse 1.4s infinite" }}
        />
        {open ? "Hide reasoning ↴" : "View reasoning ↾"}
      </button>
      {open && (
        <div className="text-[11.5px] text-[#5F5E5A] bg-white border border-[rgba(0,0,0,0.08)] rounded-xl px-3 py-2.5 leading-relaxed max-h-36 overflow-y-auto">
          {reasoning}
        </div>
      )}
    </div>
  );
}

function MealCardGrid({ cards }: { cards: MealCard[] }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {cards.map((card) => (
        <div
          key={card.day}
          className="bg-warm border border-[rgba(0,0,0,0.09)] rounded-xl px-3 py-2.5 min-w-[120px] cursor-pointer hover:border-green-mid transition-colors"
        >
          <div className="text-[10px] font-medium text-text-muted uppercase tracking-wide mb-1">
            {card.day}
          </div>
          <div className="font-display text-[13px] text-text-main leading-snug mb-1.5">
            {card.name}
          </div>
          <span className="text-[10px] text-green-primary bg-green-light px-2 py-0.5 rounded-full inline-block">
            {card.time}
          </span>
        </div>
      ))}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5 items-start">
      <AgentIcon />
      <div
        className="flex gap-1 px-4 py-3 bg-white border border-[rgba(0,0,0,0.08)]"
        style={{ borderRadius: "4px 16px 16px 16px" }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-green-border block"
            style={{ animation: `chat-bounce 1.2s infinite ${i * 0.2}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export function PlanTab() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [isTyping, setIsTyping] = useState(false);
  const [input, setInput] = useState("");
  const [quickReplies, setQuickReplies] = useState(QUICK_REPLIES);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const apiHistory = useRef<HistoryEntry[]>([]);
  const sessionId = useRef(crypto.randomUUID());

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
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

    const agentId = `agent-${Date.now()}`;
    const emptyAgent: AgentMessage = { id: agentId, type: "agent", content: "", isStreaming: true };

    // Get Supabase session token
    let token = "";
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token ?? "";
    } catch { /* proceed without token */ }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          session_id: sessionId.current,
          history: historySnapshot,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      setIsTyping(false);
      setMessages((prev) => [...prev, emptyAgent]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
          const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
          if (!eventLine || !dataLine) continue;

          try {
            const payload = JSON.parse(dataLine);

            if (eventLine === "reasoning") {
              setMessages((prev) => prev.map((m) =>
                m.id === agentId
                  ? { ...m, reasoning: ((m as AgentMessage).reasoning ?? "") + payload.text }
                  : m
              ));
            } else if (eventLine === "content") {
              finalContent += payload.text;
              setMessages((prev) => prev.map((m) =>
                m.id === agentId ? { ...m, content: (m as AgentMessage).content + payload.text } : m
              ));
            } else if (eventLine === "meal_cards") {
              setMessages((prev) => prev.map((m) =>
                m.id === agentId ? { ...m, mealCards: payload } : m
              ));
            } else if (eventLine === "quick_replies") {
              setQuickReplies(payload);
            } else if (eventLine === "done") {
              setMessages((prev) => prev.map((m) =>
                m.id === agentId ? { ...m, isStreaming: false } : m
              ));
              apiHistory.current.push({ role: "agent", content: finalContent });
            } else if (eventLine === "error") {
              throw new Error(payload.message ?? "Agent error");
            }
          } catch { /* skip malformed event */ }
        }
      }
    } catch (err) {
      console.error("Chat error:", err);
      setIsTyping(false);
      setMessages((prev) => {
        const hasAgent = prev.some((m) => m.id === agentId);
        const errMsg: AgentMessage = {
          id: agentId,
          type: "agent",
          content: "Something went wrong. Please try again.",
          isStreaming: false,
        };
        return hasAgent
          ? prev.map((m) => m.id === agentId ? errMsg : m)
          : [...prev, errMsg];
      });
    }
  }, [isTyping]);

  return (
    <>
      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto no-scrollbar px-5 py-5 flex flex-col gap-3.5"
      >
        <div className="text-[11px] font-medium text-text-muted uppercase tracking-wide text-center my-1">
          Today
        </div>

        {messages.map((msg) => {
          if (msg.type === "user") {
            return (
              <div
                key={msg.id}
                className="bg-green-primary text-white text-[13.5px] leading-relaxed self-end max-w-[82%] px-4 py-3"
                style={{ borderRadius: "16px 4px 16px 16px" }}
              >
                {msg.content}
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex gap-2.5 items-start max-w-[86%]">
              <AgentIcon />
              <div className="flex flex-col gap-1.5 min-w-0">
                {msg.reasoning && <ReasoningPill reasoning={msg.reasoning} />}
                <div
                  className="bg-white border border-[rgba(0,0,0,0.08)] px-4 py-3 text-[13.5px] leading-relaxed text-text-main"
                  style={{ borderRadius: "4px 16px 16px 16px" }}
                >
                  <span dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.content) }} />
                  {msg.isStreaming && (
                    <span className="inline-block w-0.5 h-3.5 bg-green-primary ml-0.5 align-middle animate-pulse" />
                  )}
                </div>
                {msg.mealCards && <MealCardGrid cards={msg.mealCards} />}
                {msg.extraContent && (
                  <div
                    className="bg-white border border-[rgba(0,0,0,0.08)] px-4 py-3 text-[13.5px] leading-relaxed text-text-main"
                    style={{ borderRadius: "4px 16px 16px 16px" }}
                  >
                    {msg.extraContent}
                  </div>
                )}
              </div>
            </div>
          );
        })}

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

      <div className="flex items-center gap-2.5 px-3.5 py-2.5 pb-3 bg-white border-t border-[rgba(0,0,0,0.07)] flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-mid flex-shrink-0" />
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height =
              Math.min(e.target.scrollHeight, 90) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(input);
            }
          }}
          placeholder="Ask anything about your meals…"
          rows={1}
          className="flex-1 bg-warm border border-[rgba(0,0,0,0.1)] rounded-[22px] px-4 py-2 text-[13.5px] text-text-main placeholder:text-[#B4B2A9] outline-none resize-none leading-relaxed overflow-y-auto focus:border-green-mid transition-colors"
          style={{ maxHeight: "90px" }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isTyping}
          className="w-[34px] h-[34px] rounded-full bg-green-primary border-none flex items-center justify-center cursor-pointer flex-shrink-0 disabled:opacity-40 hover:bg-green-dark transition-colors"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </>
  );
}
