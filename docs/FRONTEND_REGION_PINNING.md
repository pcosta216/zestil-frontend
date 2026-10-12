# Pin the edge-function calls to the database's region

**For:** whoever maintains `zestil-frontend`. **From:** the agents repo, 2026-10-12. **Effort:** a few lines.

## Why

Supabase runs an edge function in the region nearest to whoever calls it. Called from the owner's location, the functions run in **ap-south-1 (Mumbai)**. The database is in **us-west-1 (California)**, so every query a function makes crosses the world: **about 237 ms each, against 2 ms** when the function runs next to the database. The planner makes many queries per message.

Measured on 2026-10-12, same messages and same account:

| Request | Today | Pinned to us-west-1 |
|---|---|---|
| "add a banana to tomorrow breakfast" | 10–19 s | 3.4–3.7 s |
| "how many calories do I have left today?" | 9–11 s | 3.6–4.2 s |
| "what snacks do I have?" (list cards) | 3–6 s | 0.8–1.6 s |

## What to change

Every call the app makes to a Zestil edge function asks Supabase to run it in **`us-west-1`**:

| Function | Called from |
|---|---|
| `router-agent` | the Plan tab chat (`app/api/plan/route.ts` or wherever the chat posts) |
| `explore-agent` | the Explore tab |
| `sides-catalog`, `snacks-catalog` | the list cards' buttons (`ui_body` call actions) and the My sides / My snacks screens |
| any other function | the same rule |

**Calls through supabase-js** (`supabase.functions.invoke`): pass the region option.

```ts
import { FunctionRegion } from '@supabase/supabase-js'

await supabase.functions.invoke('router-agent', {
  body,
  region: FunctionRegion.UsWest1,
})
```

**Calls with `fetch`:** add the header.

```ts
await fetch(`${SUPABASE_URL}/functions/v1/router-agent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-region': 'us-west-1' },
  body: JSON.stringify(body),
})
```

**Where the call is made from a server route** (e.g. a Next.js API route), the same applies there: the header is what decides the region, not where the server runs.

**Keep the region in one constant**, e.g. `EDGE_REGION = 'us-west-1'`, so moving the database later means one change. The agents side does the same (`supabase/functions/_shared/region.ts`).

## Already done on the agents side

The router passes the header on to the planner and Explore, and the planner on to Explore. So once the app's first call is pinned, the whole chain runs next to the database.

## How to check it worked

The chat reply carries timings. After the change, ask "what snacks do I have?": `_router.route_ms` should be about **150 ms**; before it was 1,300–2,900 ms. For a planner message, `timing.tools_ms` should be tens of milliseconds, not hundreds or thousands.
