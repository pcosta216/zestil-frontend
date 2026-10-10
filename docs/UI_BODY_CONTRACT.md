# UI body contract — `ui_body` and `response_type: "feedback"`

**Status:** v1 built 2026-10-08 — migration `2026100801_restore_user_side.sql` **not yet applied**; `planner-agent` and `sides-catalog` **deploy pending**; frontend renderer not built. Users: the planner's `remove_from_my_sides` and (2026-10-08, migration `2026100802` not yet applied) `adjust_my_side`.
**2026-10-10:** the interactive snack list (§5.6). New: the `section` block (§3.1.6), `button_group`'s `detail` and `collapsed`, switch buttons (`state`), the local `replace` action (§4.6), and a group's call reply replacing only that group (§4.3). The Edit button is a placeholder. Built in `list_my_snacks` and `snacks-catalog`; the deploys of `planner-agent` and `snacks-catalog`, and migration `2026101001`, wait for the frontend renderer.
**Audience:** whoever builds the agent side (this repo) and whoever builds the renderer (`zestil-frontend`, Plan tab chat).

---

## 1. What this is for

`ui_body` is a structured set of UI blocks that an agent response can carry on top of its text: a confirmation, an Undo button, or a list to pick from. The agent's **code** builds it from a tool's real result; the model never writes it. The frontend renders it from a small, closed set of block types.

The first need for it is turns that finish without changing anything the UI already shows. Removing a side from "my sides" is one: the week plan doesn't change, so no cards refresh and the only sign that it worked is a sentence of text. Those turns get a new response type, **`feedback`**, which means "no cards; the `ui_body` is the content".

`ui_body` is **not** tied to `feedback`. Any response type can carry it later, to enrich what that type already renders.

Turns that change the plan don't need it for confirmation. When `add_side` or `add_recipe_to_plan` writes an entry, the plan refresh is the feedback, and removing an entry is already handled by the plan UI. Those turns keep `day_update` and, in v1, carry no `ui_body`.

## 2. Where it appears

`ui_body` is a new top-level field on the agent response, next to `response`, `response_type`, `meal_cards` and so on.

**Agent-side rule:** an agent attaches `ui_body` whenever a tool in that turn produced blocks, on whatever the turn's `response_type` is. When no tool produced blocks, the field is **absent**, never `null` or `{}`.

**Frontend-side rule:** which response types render `ui_body`, and where on screen, is the frontend's decision. This contract does not prescribe it.

**Attached on (v1).** So that blocks are never built and then silently dropped by a frontend that doesn't render them on that type, this table lists every response type the agents actually attach `ui_body` to. Adding a row is a deliberate change to this contract, made on both sides.

| Agent | `response_type` | Produced by |
|---|---|---|
| `planner-agent` | `feedback` | `remove_from_my_sides` (§5.1–5.3), `adjust_my_side` (§5.4), and (2026-10-09, deploy pending) `add_to_my_snacks`, `remove_from_my_snacks`, `adjust_my_snack`, `set_my_snack_auto` (§5.5). `add_snack` is a plan write and returns `day_update`, with no `ui_body`. |
| `planner-agent` | `feedback` | `list_my_snacks` (§5.6, built 2026-10-10, deploy pending). |

The response still carries `response` (the model's sentence), `quick_replies` and the other fields as today. `meal_cards`/`meal_summary` are normally `[]` on a `feedback` turn.

```json
{
  "response": "Removed \"Roasted carrots\" from your sides.",
  "response_type": "feedback",
  "ui_body": { "version": 1, "blocks": [ ... ] },
  "meal_cards": [],
  "meal_summary": [],
  "ingredient_cards": [],
  "quick_replies": [],
  "changed_dates": []
}
```

The path is frontend → `router-agent` → `planner-agent` → back. The router passes the planner's body through unchanged (`router-agent/index.ts`, the final proxy `json({ ...agentData, _router })`), so it needs no change.

## 3. `ui_body`

```json
{
  "version": 1,
  "blocks": [ <block>, <block>, ... ]
}
```

| Field | Type | Notes |
|---|---|---|
| `version` | integer | `1`. Raised only for a change the current renderer can't safely ignore. |
| `blocks` | array | Rendered top to bottom **in array order**. No `order` field: the array is already ordered. At least one block. |

**Unknown block types are skipped, not errors.** The agent side can add a type before the frontend renders it without breaking anything.

**Wording** (owner, 2026-10-10). Every caption the user reads calls the app **Zestil**, never "app": "Zestil · 30 g", "Zestil default", "restored Zestil's default". The planner's instructions carry the same rule for the model's own text (`2026101002`).

### 3.1 Block types (v1)

Seven types: `text`, `button`, `choice`, `button_group`, `nutrition`, `section` and `notice`.

#### 3.1.1 `text`

A line of text. `style` says what role it plays: a plain line, a header, or a sub-header under it.

```json
{ "type": "text", "caption": "Removed \"Roasted carrots\" from your sides." }
```

```json
[
  { "type": "text", "style": "header",     "caption": "Roasted carrots" },
  { "type": "text", "style": "sub_header", "caption": "120 g per serving" }
]
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"text"` | |
| `style` | `"body"` \| `"header"` \| `"sub_header"` | Optional. Default `"body"`. `sub_header` is a smaller, lighter line meant to sit under a `header`. |
| `caption` | string | Plain text, no markdown. |

Header and sub-header are styles of `text`, not separate block types. That way a renderer that doesn't know a style still shows the words: **an unknown `style` renders as `"body"`**. A renderer would skip an unknown *type* entirely (§3), and the line would be lost.

#### 3.1.2 `button`

A single action.

```json
{
  "type": "button",
  "id": "undo",
  "caption": "Undo",
  "style": "secondary",
  "icon": "undo",
  "action": { "kind": "call", "endpoint": "sides-catalog",
              "body": { "action": "restore", "side_uuid": "0b5e…" } }
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"button"` | |
| `id` | string | Unique within this `ui_body`. For the frontend's own state, such as which button is pending. |
| `caption` | string | The button label. |
| `style` | `"primary"` \| `"secondary"` | Visual weight only. Default `"secondary"`. |
| `icon` | string \| `null` | Optional. A name from §3.2, shown next to `caption`. Absent or `null` means no icon. |
| `action` | Action (§4) | What the button does. |

#### 3.1.3 `choice`

Pick one option from a list, then submit. This is the radio-button list.

```json
{
  "type": "choice",
  "id": "pick_side",
  "caption": "Which one should I remove?",
  "select": "single",
  "options": [
    { "caption": "Roasted carrots",  "detail": "vegetable · Zestil default", "value": "0b5e…" },
    { "caption": "Carrot salad",     "detail": "vegetable · your side",   "value": "7c21…" }
  ],
  "submit": {
    "caption": "Remove",
    "icon": "trash",
    "action": { "kind": "call", "endpoint": "sides-catalog",
                "body": { "action": "remove", "side_uuid": "{value}" } }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"choice"` | |
| `id` | string | Unique within this `ui_body`. |
| `caption` | string | The question above the list. |
| `select` | `"single"` | Only `"single"` in v1. `"multi"` is reserved. |
| `options` | array of `{caption, detail?, value}` | `caption` is the main label; `detail` (optional) is a second, lighter line; `value` is opaque to the UI. Up to 5 options. |
| `submit.caption` | string | The submit button's label. It stays disabled until an option is selected. |
| `submit.icon` | string \| `null` | Optional. A name from §3.2, shown next to `submit.caption`. Absent or `null` means no icon. |
| `submit.action` | Action (§4) | Run with `{value}` substituted (§4.2). |

#### 3.1.4 `button_group`

A label with a few buttons under it, each with its own action. Use it when the user has more than one thing they can do next, and a single `button` isn't enough.

```json
{
  "type": "button_group",
  "id": "apple_actions",
  "caption": "Apple",
  "buttons": [
    { "id": "delete", "caption": "Delete", "icon": "trash",
      "action": { "kind": "call", "endpoint": "snacks-catalog",
                  "body": { "action": "remove", "snack_uuid": "4a9d…" } } },
    { "id": "info", "caption": "Info", "icon": "info",
      "action": { "kind": "toggle", "target": "apple_nutrition" } }
  ]
}
```

The Info button shows or hides a `nutrition` block with `"id": "apple_nutrition"` in the same `ui_body` (§3.1.5, §4.5).

With the two optional fields, as the snack list uses them (§5.6):

```json
{
  "type": "button_group",
  "id": "snack_1fc06978",
  "caption": "Almonds",
  "detail": "Zestil · 30 g",
  "collapsed": true,
  "buttons": [ ... ]
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"button_group"` | |
| `id` | string | Unique within this `ui_body`. |
| `caption` | string | The label or title above the buttons. Plain text, no markdown. |
| `detail` | string | Optional. A second, lighter line under `caption`, as on `choice` options. Plain text. |
| `collapsed` | boolean | Optional. Default `false`. When `true`, only `caption` and `detail` are shown, as one row the user can tap; tapping it shows the buttons, and tapping again hides them. |
| `buttons` | array of `{id, caption, style?, icon?, state?, action?}` | 1–4 buttons, shown in array order. Each one has the same fields as a `button` block, without `type`. Each `id` must be unique within the whole `ui_body`, not just within the group. No more than one `"primary"`. **`action` may be absent** in a group: the button is a placeholder for an action not connected yet, and renders disabled. |
| `buttons[].state` | boolean | Optional, groups only. When present, the button renders as a **switch** labelled `caption`, showing `state`. See "Switches" below. |

**Switches** (owner, 2026-10-10). A tap flips the switch **at once** (optimistic) and runs its `call` with `"{value}"` replaced by the new state, as a boolean (§4.2). While the call is in flight, the group's other controls and the switch itself are disabled. Then:
- **Reply with `ui_body`:** it replaces the group as any group reply does (§4.3). For the snack list it is the same row again, so nothing visibly moves. It can differ in ids, because changing an app snack makes the user's own copy, and the new row points at it.
- **Reply without `ui_body`, `ok: false`, or a network error:** the switch flips back, and the short inline error shows under the group.

A switch has no Undo: flipping it back is the undo.

**Collapsed groups.** Expanding and collapsing is on-screen state only, like a `toggle` (§4.5): no call, nothing saved. Collapsing a group also hides any block its `toggle` buttons had shown, so an open nutrition panel doesn't stay behind on its own.

How the buttons are laid out (in a row, or stacked on narrow screens) is the frontend's decision. **A group is its own unit for calls** (owner, 2026-10-10):
- once a `call` button in the group is tapped, that group shows the pending state and its controls are disabled until the reply arrives. The rest of the `ui_body` stays usable;
- the reply replaces **only that group** (§4.3), so the user can tap only one `call` button per group.

A `toggle` button (§4.5) is local and can be tapped any number of times.

The first producer is `list_my_snacks` (§5.6). It builds ids that are unique on their own (from the snack's uuid). When a turn combines its blocks with another tool's, `assembleUiBody` adds the suffix to the block's `id`, to the ids of its nested buttons, and to each `toggle` action's `target`, so the target still matches the block it points at (§5.1). Adding the type doesn't raise `version`, because a renderer that doesn't know it skips it (§3).

#### 3.1.5 `nutrition`

Macros for an amount that the `caption` states. That can be what an action would add ("Adds 1 serving (approx. 200 g)") or the item itself ("Per serving (approx. 200 g)"). The block is display only and has no action of its own.

```json
{
  "type": "nutrition",
  "id": "apple_nutrition",
  "caption": "Per serving (approx. 200 g)",
  "hidden": true,
  "macros": { "kcal": 122, "protein": 0.34, "carbs": 29.6, "fat": 0.3, "sugar": 24.2, "sodium": 0 }
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"nutrition"` | |
| `id` | string | Optional. Required when a `toggle` action targets the block (§4.5). Unique within this `ui_body`. |
| `caption` | string | The amount the macros are for, in words. Plain text, no markdown. Written by the agent, like every other `caption`. |
| `hidden` | boolean | Optional. Default `false`. When `true`, the block is not shown until a `toggle` shows it. A hidden block that no `toggle` targets is never shown, so don't send one. |
| `macros` | object | Totals for the amount in `caption`. Keys and units: `kcal` (kcal), `protein`, `carbs`, `fat`, `sugar` (g), `sodium` (**mg**). These are the same keys as `meal_summary`. |

- **Raw numbers.** The agent sends the values as computed (`0.34`). The frontend rounds and formats them for display.
- **Missing key = not shown**, not shown as `0`. A `0` that is sent *is* shown. Unknown keys are ignored, so a nutrient can be added later without breaking the renderer.
- **Placement.** The block can go anywhere in the array, as any block can. When it's hidden, it appears in its own array position once it's shown.
- **Not for `choice` options.** Macros for each option of a `choice` are not part of v1.

The first producer is `list_my_snacks` (§5.6): one hidden block per snack, toggled by its Info button. Adding the type doesn't raise `version` (§3).

#### 3.1.6 `section`

A collapsible header that **contains** its blocks: one category of a list, for example.

```json
{
  "type": "section",
  "id": "cat_fruit",
  "caption": "Fruit",
  "detail": "3 snacks",
  "collapsed": true,
  "blocks": [ <block>, <block>, ... ]
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"section"` | |
| `id` | string | Unique within this `ui_body`. |
| `caption` | string | Rendered as a header. Plain text. |
| `detail` | string | Optional. Rendered as a sub-header under `caption`. |
| `collapsed` | boolean | Optional. Default `false`. When `true`, only the header shows; tapping it shows the blocks, and tapping again hides them. On-screen state only. |
| `blocks` | array | The section's content, rendered in order when it's open. Any block type **except `section`**: one level only. |

- **A container, not a flag on a header.** With a flag, a header would implicitly own every block up to the next header. Once a turn joins the list with another tool's blocks, those blocks would land inside the last category. Here the membership is explicit.
- **Ids** inside a section are unique across the whole body, like any other. A `toggle` may target a block in the same section.
- **Calls inside a section** keep their own scope (§4.3): a group's reply replaces that group inside the section, and the rest stays as it was.
- An **empty** section (`blocks: []`, for instance after every row was removed with Continue) is the frontend's call: hide it, or keep the header.

#### 3.1.7 `notice`

A note or a warning about something nearby, behind a short visible handle: its icon. Collapsed (the default), the notice is **only the icon**. Tapping it shows the `title` and `caption`, and tapping again hides them.

```json
{
  "type": "notice",
  "tone": "warning",
  "icon": "alert",
  "title": "Above the usual range",
  "caption": "3 servings is more than a side usually is. It still applies to future plans."
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"notice"` | |
| `tone` | `"info"` \| `"warning"` \| `"forbidden"` \| `"critical"` | How serious the message is. Sets the notice's color (below). Default `"info"`. An unknown `tone` renders as `"info"`. |
| `icon` | string | **Required, never `null`.** A name from §3.2. It's the user's handle on the notice, so a notice always shows one. If the frontend doesn't know the name, it uses the tone's fallback icon (below) instead of showing nothing. |
| `title` | string | Optional. A short bold line, shown only when the notice is open. Plain text. |
| `caption` | string | The message, shown only when the notice is open. Plain text, unless `format` is `"markdown"`. |
| `format` | `"plain"` \| `"markdown"` | Optional. Default `"plain"`. `"markdown"` allows a small subset in `caption` (below). `title` is always plain. |
| `collapsed` | boolean | Optional. **Default `true`.** `false` sends the notice already open. Opening and closing is on-screen state only, like a `toggle` (§4.5): no call, nothing saved. |

| `tone` | Meaning | Color | Fallback icon |
|---|---|---|---|
| `info` | Useful to know; nothing is wrong | open | `info` |
| `warning` | Worth checking, but it went through | yellow | `alert` |
| `forbidden` | Not allowed: a rule blocked it, e.g. an excluded food | open | `block` |
| `critical` | Serious: the user should act on it | red | `alert` |

- **Color comes from `tone`, not from the icon.** A notice is drawn in its tone's color, icon included, so an `info` icon on a `warning` notice is yellow. Elsewhere an icon keeps its own color (§3.2). As in §3.2, **open** means not decided yet, and the frontend uses its default color until this table gives one.
- **Accessible label.** Collapsed, the notice is only an icon, so the frontend gives it the `title` as its accessible label (or the `caption` when there's no `title`).
- **Never skipped.** A renderer skips an unknown block type (§3), and a warning lost that way does real harm. So the agent side doesn't send `notice` until the frontend renders it, the same "made on both sides" rule as icon names (§3.2).
- **Placement.** Anywhere, as any block, including inside a `section`. Put it next to whatever it's about.
- **The markdown subset** (owner, 2026-10-10), for longer notes such as a list's help: `**bold**`, `*italic*`, lines starting with `- ` as a bullet list, single line breaks, and a blank line between paragraphs. **Nothing else:** no links, images, headings, HTML, code or tables. The frontend renders it with HTML escaped first, so a stray `<` shows as a character and never as markup. Anything outside the subset renders as its literal characters. The agent side keeps to the subset: the dashboard refuses to save text that goes outside it (`tbl_ui_help`, §5.6).

The first producer is the snack list's help note (§5.6): `tone: "info"`, the `info` icon, `format: "markdown"`, built 2026-10-10. Next planned: `adjust_my_side`'s out-of-range warning (§5.4), which today is a plain second `text` block. Adding the type doesn't raise `version` (§3).

### 3.2 Icons

An icon is a **name**, never a URL or an image. The frontend maps each name to its own artwork, so the set is closed, like the block types (§3.1) and the endpoint allowlist (§4.1). An unknown name renders with no icon, not as an error.

| Name | Meaning | Color | Used by (v1) |
|---|---|---|---|
| `trash` | Remove or delete | red | `choice` submit "Remove" (§5.2); snack list Remove (§5.6) |
| `edit` | Change an amount or a setting | blue | `choice` submit "Change" (§5.4); snack list Edit (§5.6) |
| `toggle` | Switch something on or off | grey | `choice` submit "Switch on" / "Switch off" (§5.5). A switch (`state`) needs no icon. |
| `undo` | Reverse the last change | open | Snack list Undo after Remove (§5.6) |
| `info` | Show more detail, e.g. a hidden `nutrition` block | open | Snack list Info, and the list's help note (§5.6) |
| `check` | Confirm, done | open | Snack list Continue (§5.6) |
| `cross` | Cancel, dismiss, no | open | Not used yet |
| `alert` | Warning: something needs attention | yellow | Not used yet |
| `plus` | Add | open | Snack list Restore, in the "Removed" section (§5.6) |
| `swap` | Replace one item with another | open | Not used yet |
| `block` | Not allowed | open | `notice` fallback for `tone: "forbidden"` (§3.1.7) |

**Colors** (owner, 2026-10-10) belong to the icon name, like its artwork: the payload never carries a color. The frontend maps each color to a shade from its own theme, so it works in light and dark mode. **Open** means not decided yet: the frontend uses its default icon color until this table gives one.

An icon goes on any button: `button`, a button in a `button_group`, or a `choice`'s `submit`. Absent or `null` means no icon. On a `notice` (§3.1.7) the icon is required, and its color comes from the notice's `tone`.

Adding a name is a deliberate change to this contract, made on both sides. The agent side doesn't use a new name until the frontend has artwork for it.

## 4. Actions

### 4.1 `kind: "call"`: the UI calls an edge function directly

```json
{ "kind": "call", "endpoint": "sides-catalog", "body": { "action": "remove", "side_uuid": "…" } }
```

The UI sends `POST {SUPABASE_URL}/functions/v1/{endpoint}`, with `Authorization: Bearer <the signed-in user's JWT>` and `body` as the JSON body. There is **no model call and no chat turn**: the action is deterministic and finishes in about a second.

- **Endpoint allowlist.** The frontend calls only endpoints it knows: `sides-catalog` and (2026-10-09) `snacks-catalog`, nothing else. An action naming another endpoint renders disabled. A response can never point the UI at an arbitrary URL.
- **No account in the payload.** `body` never contains `user_id` or `account_key`. `sides-catalog` takes the account from the JWT and refuses a `user_id` that disagrees with it, so a tampered payload can't act on another account.
- **Single-shot.** While the call is in flight, the control shows a pending state and every control in its **scope** is disabled. A double tap must not send two calls. The scope is the whole `ui_body`, except for a button inside a `button_group`, whose scope is that group (§3.1.4, §4.3). This applies only to `call` actions. A `toggle` (§4.5) is local and never disables anything.

`kind: "message"` (send text back into the chat as the user's next turn) is **reserved** and not used in v1.

### 4.2 `{value}` substitution

In a `choice`'s `submit.action.body`, any string that is **exactly** `"{value}"` is replaced with the selected option's `value`. In a switch's `action.body` (§3.1.4), it is replaced with the switch's new state, as a JSON boolean (`true`/`false`), not a string. This is the only templating that exists. No other placeholders, and no substitution inside longer strings.

### 4.3 What a call returns, and what the UI does with it

Every `call` endpoint used here returns:

```json
{ "ok": true | false, "message": "<one user-facing sentence>", "ui_body": { ... } }
```

`ui_body` is optional in the reply.

What the reply replaces is the call's **scope** (§4.1):
- **the whole `ui_body`**, for a `button` block or a `choice` submit;
- **only the `button_group`** the button sits in (owner, 2026-10-10). The reply's blocks render in the group's place, and the rest of the body stays as it was. Blocks that the group's `toggle` buttons target (its `nutrition` panel) are removed with it.

The blocks that replace a group become that group's **slot**. A call from any of them, such as the Undo in "Removed Almonds + Undo", has the slot as its scope and replaces the slot again. So Remove → Undo → "Restored Almonds" all happen in the same place in the list.

**Ids inside a slot are scoped to the slot.** An endpoint's reply uses fixed ids, such as `undo`, so after two removals two slots both hold an `undo`. The frontend keys a slot's controls by the slot (for example, by the id of the group it replaced), not by the bare id.

- **Reply with `ui_body`:** its blocks **replace** the scope. This is how "Remove" from a `choice` turns into "Removed X" + Undo.
- **Reply without `ui_body`:** the scope is replaced by a single `text` block showing `message`.
- **Network error or non-2xx:** the scope's controls are re-enabled, and a short inline error is shown under them. Nothing is replaced.

### 4.4 Lifetime

`ui_body` lives only on the chat message that delivered it. It is not added to `history` or saved with the conversation, so after a reload the message shows only its `response` text. The UI does not expire buttons. Staleness is the endpoint's job: an Undo pressed long after, or twice, returns a clear `ok` reply (for example "already in your sides") instead of failing or acting twice.

### 4.5 `kind: "toggle"`: show or hide a block, on the device only

```json
{ "kind": "toggle", "target": "apple_nutrition" }
```

The frontend shows the block whose `id` is `target` if it's hidden, and hides it if it's shown. There is no network call, so no pending state and no reply, and nothing is replaced. The rest of the `ui_body` stays as it is.

- **Targets.** In v1, only a `nutrition` block can be a target. If the target is missing, or isn't a `nutrition` block, the button renders disabled.
- **Not saved.** Whether a block is shown is on-screen state only. Like the rest of `ui_body`, it's gone after a reload (§4.4).
- **Not in a `choice` submit.** A `choice`'s `submit.action` is always a `call`.

### 4.6 `kind: "replace"`: swap the scope for given blocks, on the device only

```json
{ "kind": "replace", "blocks": [] }
```

The frontend replaces the action's **scope** (§4.1, §4.3: the group or slot the button sits in) with `blocks`, with no network call. `blocks: []` removes the scope entirely. The snack list's **Continue** uses it after a removal: the row leaves the list.

- Like `toggle`, it's local: no pending state, no reply, nothing saved.
- The given blocks follow every rule of a call's reply blocks: they render in the scope's place and form its slot.
- Only in a `button` or a group button, never in a `choice` submit.

## 5. First user: `remove_from_my_sides`

### 5.1 When the planner returns `response_type: "feedback"`

`remove_from_my_sides` or `adjust_my_side` built blocks in this turn, **and** no plan-writing tool ran (`DAY_UPDATE_TOOLS` → `day_update` still wins). If the turn also called read-only tools (`find_sides`, `get_week_plan`), the type is still `feedback`.

Precedence in `deriveResponseType`: `day_update` > `suggestion_pending` > **`feedback`** > `recipe_list` / `ingredients_list` / `week_plan` / `info`.

If a plan-writing tool also ran, the type is `day_update`, which is not in the §2 "attached on" table for v1. The planner then **drops** the blocks and logs `[ui_body] dropped N block(s) on day_update`; the model's text still reports the removal. A rare case (one message asking for a plan change and a catalog removal together). Attaching on `day_update` instead is a deliberate future change, made by adding the row to §2.

If `remove_from_my_sides` ran more than once in the turn, the blocks from each call are concatenated in call order. Each successful removal gets its own Undo, with ids `undo_1`, `undo_2`, … .

### 5.2 Outcome → body

The handler result comes from `remove_user_side()` (`ok`, `action`, `display_name`) or from the handler's own name resolution (`ambiguous`, `candidates`).

| Tool outcome | `response_type` | `ui_body.blocks` |
|---|---|---|
| `ok`, `action: "deactivated"` (the user's own side) | `feedback` | `text` "Removed "{name}" from your sides." + `button` Undo → `restore` |
| `ok`, `action: "excluded"` (an app default, now hidden for this user) | `feedback` | `text` "Removed "{name}" from your sides." + `button` Undo → `restore` |
| `ok`, `action: "already_removed"` | `feedback` | `text` ""{name}" was already removed." No Undo, because nothing changed. |
| `ambiguous` with `candidates` (2–5 matches) | `feedback` | `choice` "Which one should I remove?" with options from `candidates` (`caption` = `display_name`, `detail` = "{category} · your side \| Zestil default", `value` = `side_uuid`) and submit "Remove" → `remove` with `side_uuid: "{value}"` |
| No match (`ok: false`, no candidates) | `feedback` | `text` "No side named "{name}" is in your list." |
| Error (RPC failure, refused account) | `info` | **none**. The model's text explains, as today. |

The model's `response` text is written as today and sits above the blocks. The `text` block is the authoritative confirmation, so the UI can show it even if the model's sentence is vague.

### 5.3 The two `sides-catalog` calls

**Remove** already exists: `{ "action": "remove", "side_uuid": "…" }` → `remove_user_side()`. For v1 it gains a `message` and a `ui_body` in its reply, built by the same code as the planner's (§6), so a removal from the `choice` list ends in the same "Removed X" + Undo state as a removal straight from chat.

**Restore** is **new**: `{ "action": "restore", "side_uuid": "…" }` → a new RPC, `restore_user_side(p_account_key, p_side_uuid)`. It exactly reverses `remove_user_side`:

| Row state | Effect | Reply |
|---|---|---|
| The user's own row, `active = false` | `active = true` | `ok`, `action: "restored"`, "Restored "{name}" to your sides." |
| The user's own row, already active (restored or re-added since) | none | `ok`, `action: "already_present"`, ""{name}" is already in your sides." |
| An app row this user has excluded | delete the `tbl_side_exclusions` row | `ok`, `action: "restored"` |
| An app row that isn't excluded | none | `ok`, `action: "already_present"` |
| An app row that has since been deactivated app-wide | none | `ok: false`, ""{name}" is no longer available." |
| Missing, or another user's row | none | `ok: false`, "Side not found in your list." (the same wording as remove, so nothing leaks) |

The restore reply's `ui_body` is a single `text` block. **There is no Undo of the Undo.** To remove the side again, the user asks again.

The RPC follows the other write RPCs: `side_catalog_account_ok()` guard, SECURITY INVOKER, `REVOKE EXECUTE … FROM PUBLIC, anon`, `GRANT … TO authenticated, service_role`.

### 5.4 `adjust_my_side`: changing a side's default amount

Units only: servings for a recipe side, units (slices, pieces) for an as-sold item, portions for a cooked side. Spec: [`planner-agent/SIDES_CATALOG.md`](planner-agent/SIDES_CATALOG.md), "Adjusting a side's default".

| Tool outcome | `response_type` | `ui_body.blocks` |
|---|---|---|
| `ok` (own side updated, or an app side copied and updated) | `feedback` | `text` "{name}: default set to {n} {unit} ({grams} g). Applies to future plans." + `text` with the warning, when outside the role's range + `button` Undo → `undo_adjust` |
| `ok`, unchanged (already that amount) | `feedback` | `text` "{name} is already set to {n} {unit}." No Undo. |
| `ambiguous` with `candidates` | `feedback` | `choice` "Which one should I change?". Submit "Change" → `adjust` with `side_uuid: "{value}"` and the same `amount` |
| No match | `feedback` | `text` "No side named "{name}" is in your list." |
| Invalid amount, error, or a second side in the same request | `info` | none. The model explains. |

`{unit}` is `serving(s)`, `portion(s)`, or for as-sold items the word the user used (`unit_label`: "slice") and otherwise `unit(s)`. `({grams} g)` is left out for recipe sides with no known serving weight.

**`sides-catalog` calls.**
- `{ "action": "adjust", "side_uuid": "…", "amount": 2, "unit_label": "slice" }` → `adjust_user_side()`, and the reply carries the same blocks.
- `{ "action": "undo_adjust", "side_uuid": "…", "undo": { … } }` → `undo_adjust_user_side()`. `undo` is opaque to the UI: it's copied from the button's payload. The reply is one `text` block ("Put back …" / "Removed your copy of … and restored Zestil's default"), with no Undo of the Undo. If the default has changed since, the reply is `ok: false` with "That side has changed since, so there's nothing to undo." and no `ui_body`.

### 5.5 Snacks: the same blocks on `snacks-catalog`, plus the auto-select switch

Every builder in `_shared/ui-body.ts` takes a catalog: `'sides'` (the default) or `'snacks'`. For snacks:
- buttons call `snacks-catalog`;
- the payload id is `snack_uuid`;
- the wording says "your snacks".

Remove, restore, adjust and their Undos behave exactly as §5.1–5.4. The snack endpoint (2026-10-09, deploy pending) returns them on its direct calls. The planner's snack tools build the same blocks (see §2). `add_to_my_snacks` also returns a confirmation that says whether the snack will be picked automatically, with an Undo that calls `remove`; when the snack was already present, the confirmation stands alone.

**`set_auto`** is the per-snack switch: "may the optimizer pick this to close gaps". Owner, 2026-10-09; spec: [`optimize-day-agent/SNACKS_CATALOG.md`](optimize-day-agent/SNACKS_CATALOG.md) §7.

| Outcome | Blocks |
|---|---|
| set on | `text` "{name} can now be picked automatically to close gaps." + `button` Undo → `undo_set_auto` |
| set off | `text` "{name} won't be picked automatically any more. You can still add it by hand." + `button` Undo → `undo_set_auto` |
| unchanged | `text` "{name} is already picked automatically." / "…is already left out of automatic picks." (no Undo) |
| several matches | `choice` "Which one do you mean?", submit "Switch on" / "Switch off" → `set_auto` with `snack_uuid: "{value}"` and the same `auto` |
| `undo_set_auto` reply | one `text`: "Put back the previous setting for {name}." or, for a copy, "Removed your copy of {name} and restored Zestil's default." |

### 5.6 `list_my_snacks`: the interactive snack list

**Status:** owner, 2026-10-10. Built: `snackListBlocks` / `snackRowBlocks` / `removeSnackListBlocks` in `_shared/ui-body.ts`, called by `list_my_snacks` (planner) and by `snacks-catalog` for its `view: "list"` replies. Deploys of `planner-agent` and `snacks-catalog`, and migration `2026101001`, are pending until the frontend renders it. The Edit button is a placeholder until its action is designed.

"What snacks do I have" returns the list as blocks, on `response_type: "feedback"` (§2). Categories come in `tbl_snack_categories.display_order`, and snacks alphabetically inside each, the same order as the tool result.

**Per category: one `section`** (§3.1.6):
- `id` `cat_{category key}`, `caption` the label ("Nuts & seeds");
- `detail` the count: "2 snacks". No serving size: the category's default rarely matches its snacks (owner, 2026-10-10);
- `collapsed: true` when the list has several categories, `false` when it has one (the user asked for one category).

**Per snack: a row**, inside its section:

| Block | Content |
|---|---|
| `button_group`, `collapsed: true` | `id` `snack_{first 8 hex of snack_uuid}`, `caption` the snack's name, `detail` "{Yours \| Zestil} · {default amount}". The default amount is "30 g", "1 unit (50 g)" for a whole item, or "1 serving" for a recipe snack. |
| `nutrition`, `hidden: true` | `id` `snack_{8}_nutrition`, the macros from `tbl_snacks.macros`, and a `caption` such as "Per 30 g", "Per unit (approx. 50 g)", "Per 2 units (100 g)" or "Per serving". For an ingredient the macros are at the default amount; for a recipe they're per single serving. A snack with no macros gets no block, and its Info button is a placeholder. |

**The row's buttons**, in this order. Every call carries `"view": "list"`, which tells `snacks-catalog` to answer with the list's replies below instead of the chat replies of §5.5.

| `id` | Caption | Renders as | Action |
|---|---|---|---|
| `snack_{8}_remove` | Remove | button, `trash` | `call` `{ "action": "remove", "snack_uuid": "…", "view": "list" }` |
| `snack_{8}_info` | Info | button, `info` | `toggle` → `snack_{8}_nutrition` |
| `snack_{8}_edit` | Edit | button, `edit`, **disabled** | none yet: a placeholder (§3.1.4) |
| `snack_{8}_auto` | Auto | **switch**, `state` = picked automatically | `call` `{ "action": "set_auto", "snack_uuid": "…", "auto": "{value}", "view": "list" }` |

"Remove" rather than "Delete": for an app snack it only hides the snack for this user.

**What each tap leads to**, all inside the row's slot (§4.3):

| User taps | Reply (`ui_body`) | Next |
|---|---|---|
| Remove | One `button_group`: caption "Removed "Almonds" from your snacks.", buttons **Undo** (`undo`, `call` `restore` with `view: "list"`) and **Continue** (`check`, `replace` with `[]`, §4.6) | Continue: the row leaves the list. Undo: see the next line. |
| Undo | The **row itself** again, open (`collapsed: false`), rebuilt from the database | The user carries on with the row, so it has no Continue. |
| Undo, but the snack can't come back (e.g. withdrawn app-wide) | One group: the reason as its caption, and Continue | Continue: the row leaves the list. |
| Auto switch | The **row itself**, open, with the new state. If the snack was the app's, it's now the user's copy: `detail` says "Yours" and every button points at the copy | Nothing visibly moves (§3.1.4, "Switches"). |
| Remove "already removed" | The sentence and Continue only | |

There is no Undo of the switch: flipping it back is the undo. When the switch made a copy of a Zestil snack, flipping back leaves the user with their own copy, set the same as Zestil's. That's harmless; the only effect is that later changes Zestil makes to that snack don't reach this user.

**The "Removed" section** (owner, 2026-10-10). The last section of the full list, shown only when there is something in it, holds what the user removed, so it can come back. It isn't added to a list filtered to one category.
- `section` `id` `removed_snacks`, caption "Removed", `detail` the count ("8 snacks"), always `collapsed: true`. It doesn't count toward the fixed reply line.
- One row per removed snack, alphabetical: a `button_group` `removed_{8 hex}`, `collapsed: false` (its one button is the point). Its `caption` is the name and its `detail` is "{category} · {Yours \| Zestil}". The single button is **Restore** (`plus`), a `call` `{ "action": "restore", "snack_uuid": "…", "view": "removed" }`.
- **What's listed:** Zestil snacks this user hid, and the user's own inactive snacks, but only foods that nothing visible already covers, with one row per food and the user's own winning. Changing a Zestil snack makes a copy and hides the original, and undoing that change deactivates the copy. Neither was a removal by the user, and both foods stay visible in the list, so neither shows here.

| User taps | Reply (`ui_body`) | Next |
|---|---|---|
| Restore | One group: "Restored "Almonds" to your snacks.", with **Undo** (`call` `remove` with `view: "removed"`) and **Continue** (`replace` with `[]`) | Continue: the row leaves the section, and the snack shows in its category the next time the list opens. It isn't moved live across sections. |
| Undo (after Restore) | The **removed row** again, with Restore | |
| Restore, but it's already back | "…is already in your snacks." with Continue | |
| Restore refused (e.g. withdrawn app-wide) | The reason with Continue | Continue: the row leaves the section. |

**The help note** (owner, 2026-10-10). The very last block, after the "Removed" section and outside every section, is a `notice` (§3.1.7): `tone: "info"`, `icon: "info"`, `format: "markdown"`, collapsed. It's a short "how this list works", and its text comes from `tbl_ui_help` row `snack_list` (migration `2026101003`), editable on the dashboard under Tables → UI help, with a live preview. A missing or inactive row sends no notice, and a note is never sent on its own without a list. It describes only what works today, so it says nothing about Edit until Edit is connected.

```json
{ "type": "notice", "tone": "info", "icon": "info", "format": "markdown",
  "title": "How this list works",
  "caption": "Your snacks are grouped by **category**. Tap a category to open it, and a snack to see what you can do with it.\n\n- **Yours / Zestil**: whether you added the snack or it comes with Zestil.\n- **Auto**: when on, Zestil may add this snack to your day by itself to close a macro gap. When off, it's only added when you ask for it.\n- **Info**: the snack's nutrition for the amount shown.\n- **Remove**: takes the snack off your list (a Zestil snack is only hidden for you). You'll find it under *Removed*, where **Restore** brings it back." }
```

**The reply line is fixed** (owner, 2026-10-10). For "what snacks do I have", `response` is a line built by code, not by the model, so its format never drifts:
- "You have 27 snack options across 6 categories:" for the whole list;
- "You have 2 snack options in Treats:" for one category.

There are no counts per category: the sections show them. `list_my_snacks` returns the line as `fixed_response`, and the planner uses it as `response` when every tool the model called in the turn returned one, and the blocks are attached. A mixed turn ("list my snacks and plan tomorrow") keeps the model's text. The frontend needs nothing special: it's the ordinary `response`. After a reload (§4.4) only this line is left.

"How are my snacks organized" calls the same tool with `explain: true`. Then there's no fixed line: the model writes the explanation above the same cards, without listing what they show. Migration `2026101002` puts both rules in the planner's INTENT 8 lines.

**Size.** With the test user's 27 snacks: 6 sections holding 27 rows and 27 nutrition blocks, about 26 KB of JSON.

**Example**, trimmed to one category and one snack:

```json
{
  "version": 1,
  "blocks": [
    {
      "type": "section",
      "id": "cat_nuts_seeds",
      "caption": "Nuts & seeds",
      "detail": "2 snacks",
      "collapsed": true,
      "blocks": [
        {
          "type": "button_group",
          "id": "snack_1fc06978",
          "caption": "Almonds",
          "detail": "Zestil · 30 g",
          "collapsed": true,
          "buttons": [
            { "id": "snack_1fc06978_remove", "caption": "Remove", "icon": "trash",
              "action": { "kind": "call", "endpoint": "snacks-catalog",
                          "body": { "action": "remove", "snack_uuid": "1fc06978-94ec-4b70-aba8-feb56ab0150f", "view": "list" } } },
            { "id": "snack_1fc06978_info", "caption": "Info", "icon": "info",
              "action": { "kind": "toggle", "target": "snack_1fc06978_nutrition" } },
            { "id": "snack_1fc06978_edit", "caption": "Edit", "icon": "edit" },
            { "id": "snack_1fc06978_auto", "caption": "Auto", "state": true,
              "action": { "kind": "call", "endpoint": "snacks-catalog",
                          "body": { "action": "set_auto", "snack_uuid": "1fc06978-94ec-4b70-aba8-feb56ab0150f", "auto": "{value}", "view": "list" } } }
          ]
        },
        {
          "type": "nutrition",
          "id": "snack_1fc06978_nutrition",
          "caption": "Per 30 g",
          "hidden": true,
          "macros": { "kcal": 173.7, "protein": 6.35, "carbs": 6.47, "fat": 14.98, "sugar": 1.31, "sodium": 0.3 }
        }
      ]
    }
  ]
}
```

The Remove reply, which replaces the Almonds row:

```json
{
  "ok": true,
  "message": "Removed \"Almonds\" from your snacks.",
  "ui_body": { "version": 1, "blocks": [
    { "type": "button_group", "id": "removed", "caption": "Removed \"Almonds\" from your snacks.",
      "buttons": [
        { "id": "undo", "caption": "Undo", "icon": "undo",
          "action": { "kind": "call", "endpoint": "snacks-catalog",
                      "body": { "action": "restore", "snack_uuid": "1fc06978-94ec-4b70-aba8-feb56ab0150f", "view": "list" } } },
        { "id": "continue", "caption": "Continue", "icon": "check", "action": { "kind": "replace", "blocks": [] } }
      ] }
  ] }
}
```

**What the user sees:**
1. One header per category, closed: "Nuts & seeds" over "2 snacks".
2. Opening one shows a row per snack: "Almonds" over "Zestil · 30 g".
3. Tapping a row shows Remove · Info · Edit (disabled) and the Auto switch.
4. Info opens the macros under the row. The switch flips at once and stays flipped.
5. Remove turns the row into "Removed "Almonds" from your snacks." with Undo and Continue. Continue removes the row; Undo brings it back.

## 6. Implementation notes (agent side)

- **One builder, two callers.** `supabase/functions/_shared/ui-body.ts` (new) holds the block types, `removeSideBlocks(result, sideUuid)` / `restoreSideBlocks(result)`, their user-facing sentences (`removeSideMessage` / `restoreSideMessage`) and `assembleUiBody` (call order, id suffixes). The planner and `sides-catalog` both import it, so the chat path and the direct-call path can't drift apart.
- **Planner.** `removeFromMySides` attaches the built blocks to its result. `index.ts` collects them across the turn, adds `'feedback'` to `ResponseType` and `deriveResponseType` (§5.1), and sets `ui_body` only when the final type is in the §2 "attached on" table (v1: `feedback`). Otherwise it drops the blocks and logs it (§5.1). The blocks are **not** shown to the model: the tool result the model sees stays as it is today.
- **Extraction pass.** It may refine `info` → `macro_summary` today. It must never change `feedback`. Its override only applies when the type is `info`, so this already holds; keep it that way.
- **Migration:** `2026100801_restore_user_side.sql`, for the RPC and grants.
- **Deploys:** `planner-agent` and `sides-catalog`. `router-agent` is unchanged.
- **Docs to update when it ships:** planner `SPEC.md` §2 (the new type and field, linking here), `TOOLS.md` (`remove_from_my_sides`), `SIDES_CATALOG.md` (the `restore` action) and a `DECISIONS.md` entry.

## 7. Open questions (not blocking v1)

1. **Other tools.** `add_to_my_sides` is the obvious next user (Undo → `remove`, and a `choice` for its candidates). After that, any confirmation that today is a yes/no in prose.
2. **`quick_replies` and `suggestion_pending`.** Both are really `ui_body` blocks: a row of `message` buttons, and a Yes/No confirmation. Folding them in later would need `kind: "message"` and a frontend migration, so they stay as they are for now.
3. **`multi` select** for "remove these three", if it's ever needed.
4. **The snack list's Edit button** (§5.6). It's a placeholder now. Options: toggle a hidden `choice` of amounts that calls `adjust` (this needs `toggle` to target a `choice`), or the reserved `kind: "message"`.
5. **`list_my_sides`** gets the same list (§5.6) without the Auto switch, and with the same "Removed" section and a help note (`tbl_ui_help` `side_list`, without the Auto line) (owner, 2026-10-10), once the snack list is proven.
