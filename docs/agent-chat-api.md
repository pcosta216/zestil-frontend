# Zestil Chat Agent — API Contract

## Context

Zestil is a meal planning app. The main screen (`PlanTab`) is a chat interface where a user converses with an AI agent to plan their weekly meals. The frontend is Next.js 16 (App Router). The agent is a separate backend service.

The frontend already has the full chat UI built. The only thing missing is replacing the stub `setTimeout` response in `PlanTab.tsx` with a real call to the agent via a Next.js route handler.

---

## Endpoint

```
POST /api/chat
```

Implemented as a Next.js route handler at `app/api/chat/route.ts`. It receives the user's message, proxies to the agent backend, and returns a structured response.

---

## Request shape

```typescript
interface ChatRequest {
  message: string;
  session_id: string;
  history: Array<{
    role: "user" | "agent";
    content: string;
  }>;
}
```

- `message` — the user's current input
- `session_id` — stable identifier for the session (used for any agent-side persistence: user preferences, pantry state, past plans)
- `history` — the conversation so far, oldest first, **excluding** the current message. The frontend maintains this and sends it with every request so the agent is stateless by default.

---

## Response shape

```typescript
interface AgentResponse {
  content: string;
  reasoning?: string;
  meal_cards?: Array<{
    day: string;
    name: string;
    time: string;
  }>;
  extra_content?: string;
  quick_replies?: string[];
}
```

### Field guide

| Field | Required | Description |
|---|---|---|
| `content` | Yes | Main text of the agent's reply. Rendered as the primary chat bubble. |
| `reasoning` | No | The agent's internal chain-of-thought. Rendered as a collapsible pill the user can expand. Omit if not relevant. |
| `meal_cards` | No | Array of meal suggestions rendered as tappable cards below `content`. Each card shows day, meal name, and time. |
| `extra_content` | No | A second text bubble rendered after the meal cards. Use for follow-up questions or next steps. |
| `quick_replies` | No | Context-aware suggested replies shown as chips above the input bar. If omitted, the previous quick replies remain. |

### Example response with all fields

```json
{
  "content": "Perfect — I've drafted Mon–Wed with salmon as the anchor. Here's what I'm thinking:",
  "reasoning": "The user has salmon expiring Wednesday. I'll anchor Mon–Wed around it and vary the preparation method so it doesn't feel repetitive.",
  "meal_cards": [
    { "day": "Monday", "name": "Miso-glazed salmon bowl", "time": "30 min" },
    { "day": "Tuesday", "name": "Salmon & lentil salad", "time": "20 min" },
    { "day": "Wednesday", "name": "Salmon fishcakes", "time": "35 min" }
  ],
  "extra_content": "I can plan Thu–Sun too, or adjust any of these. What do you think?",
  "quick_replies": ["Plan Thu–Sun", "Swap Tuesday", "Generate grocery list"]
}
```

### Example minimal response

```json
{
  "content": "Thursday sorted! I'll suggest a hearty mushroom & lentil stew — warm and filling without the meat. Should I plan Friday and the weekend too?"
}
```

---

## How the frontend consumes this

The frontend maps `AgentResponse` to its internal `AgentMessage` type by adding a generated `id` and `type: "agent"`. The fields map 1-to-1:

```
content       → AgentMessage.content
reasoning     → AgentMessage.reasoning
meal_cards    → AgentMessage.mealCards
extra_content → AgentMessage.extraContent
quick_replies → replaces the current quick reply chips
```

The frontend adds `id` and `type` itself — the agent does not need to send them.

---

## Streaming

Start with the single JSON blob described above. The frontend handles it with a standard `fetch` + `res.json()`.

If streaming is added later, use Server-Sent Events with typed events:

```
event: content
data: {"text": "Thursday sorted!"}

event: meal_cards  
data: [{"day": "Thursday", ...}]

event: done
data: {"quick_replies": ["Plan Friday", "Grocery list"]}
```

The structured fields (`meal_cards`, `quick_replies`) always come at the end, after the text stream closes. This keeps parsing simple on the frontend side.

---

## What the coding agent needs to build

1. The agent backend service that accepts `ChatRequest` and returns `AgentResponse`
2. The Next.js route handler at `app/api/chat/route.ts` that proxies between the frontend and the agent

The frontend (`app/zestil/PlanTab.tsx`) is already built. The only change needed there is replacing the `setTimeout` stub in the `sendMessage` function with a `fetch` call to `/api/chat`.
