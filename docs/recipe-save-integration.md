# Recipe Save Integration

## Overview

When the agent returns a recipe response in `ExploreTab`, the user can save it to their account by clicking the heart button. This triggers a single API call that parses and persists the recipe.

## Backend endpoint

```
POST /api/v1/recipe/submit          (Railway — AGENT_API_URL)
X-API-Key:  <AGENT_API_KEY>         (server-side env var, never exposed to browser)
X-User-Id:  <supabase user uuid>    (from session)
Content-Type: application/json

Body: { "text": "<recipe text from agent message>" }
   or { "url":  "<recipe source url>" }
```

Success response `200`:
```json
{
  "status":          "success",
  "recipe_uuid":     "3f8a...",
  "line_count":      12,
  "unmatched_count": 2,
  "request_id":      "req_..."
}
```

## Step 1 — Next.js API route

Create `app/api/recipe/submit/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const AGENT_API_URL = process.env.AGENT_API_URL;   // e.g. https://your-app.railway.app
const AGENT_API_KEY = process.env.AGENT_API_KEY;   // sk_live_...

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  // body must contain { text } or { url }

  try {
    const res = await fetch(`${AGENT_API_URL}/api/v1/recipe/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key":  AGENT_API_KEY!,
        "X-User-Id":  user.id,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: "Could not reach recipe agent" }, { status: 502 });
  }
}
```

## Step 2 — ExploreTab save button

The heart button with the collection picker already exists on `responseType === "recipe"` messages. The "Save" button inside the picker (line ~338) currently only closes the picker. Wire it to call the API:

```typescript
// Add save state to ExploreTab
const [saving, setSaving] = useState<string | null>(null);  // msg.id being saved
const [saved,  setSaved]  = useState<Set<string>>(new Set());

// Replace the picker Save button onClick:
onClick={async () => {
  setSaving(msg.id);
  try {
    const res = await fetch("/api/recipe/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg.content }),
    });
    if (res.ok) {
      setSaved((prev) => new Set(prev).add(msg.id));
    }
  } finally {
    setSaving(null);
    setPickerMsgId(null);
  }
}}
```

Show feedback on the button:
```tsx
{saving === msg.id ? "Saving…" : saved.has(msg.id) ? "Saved ✓" : "Save"}
```

## Environment variables required

| Variable        | Where              | Value                              |
|-----------------|--------------------|------------------------------------|
| `AGENT_API_URL` | Next.js `.env.local` | `https://your-app.railway.app`   |
| `AGENT_API_KEY` | Next.js `.env.local` | `sk_live_...` (same key as Flask) |

These are **server-side only** — never prefix with `NEXT_PUBLIC_`.

## Notes

- `msg.content` is the agent's markdown text. The backend parser handles markdown fine (strips formatting, extracts structure).
- `unmatched_count > 0` is normal — those ingredients get queued for background research automatically.
- The recipe is added to the user's main collection automatically via a DB trigger (`trg_add_recipe_to_main_collection`).
- No polling needed — save is synchronous from the frontend's perspective. Background work (classification, ingredient research) happens server-side after the 200 response.
