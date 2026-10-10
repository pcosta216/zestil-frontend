# UI body contract — `ui_body` and `response_type: "feedback"`

**Status:** v1 built 2026-10-08 — migration `2026100801_restore_user_side.sql` **not yet applied**; `planner-agent` and `sides-catalog` **deploy pending**; frontend renderer not built. Users: the planner's `remove_from_my_sides` and (2026-10-08, migration `2026100802` not yet applied) `adjust_my_side`.
**2026-10-10:** the interactive snack list (§5.6): `button_group` gains `detail` and `collapsed`, a group's call reply replaces only that group (§4.3), and the Edit button is a placeholder. The producer in `list_my_snacks` is built; `planner-agent` deploy and migration `2026101001` are pending, and both should wait for the frontend renderer.
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

### 3.1 Block types (v1)

Five types: `text`, `button`, `choice`, `button_group` and `nutrition`.

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
    { "caption": "Roasted carrots",  "detail": "vegetable · app default", "value": "0b5e…" },
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
  "detail": "App · 30 g · Auto on",
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
| `buttons` | array of `{id, caption, style?, icon?, action?}` | 1–4 buttons, shown in array order. Each one has the same fields as a `button` block, without `type`. Each `id` must be unique within the whole `ui_body`, not just within the group. No more than one `"primary"`. **`action` may be absent** in a group: the button is a placeholder for an action not connected yet, and renders disabled. |

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

### 3.2 Icons

An icon is a **name**, never a URL or an image. The frontend maps each name to its own artwork, so the set is closed, like the block types (§3.1) and the endpoint allowlist (§4.1). An unknown name renders with no icon, not as an error.

| Name | Meaning | Used by (v1) |
|---|---|---|
| `trash` | Remove or delete | `choice` submit "Remove" (§5.2); snack list Remove (§5.6) |
| `edit` | Change an amount or a setting | `choice` submit "Change" (§5.4); snack list Edit (§5.6) |
| `toggle` | Switch something on or off | `choice` submit "Switch on" / "Switch off" (§5.5); snack list Auto (§5.6) |
| `undo` | Reverse the last change | Not used yet |
| `info` | Show more detail, e.g. a hidden `nutrition` block | Snack list Info (§5.6) |
| `check` | Confirm, done | Not used yet |
| `cross` | Cancel, dismiss, no | Not used yet |
| `alert` | Warning: something needs attention | Not used yet |
| `plus` | Add | Not used yet |
| `swap` | Replace one item with another | Not used yet |

An icon goes on any button: `button`, a button in a `button_group`, or a `choice`'s `submit`. Absent or `null` means no icon.

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

In a `choice`'s `submit.action.body`, any string that is **exactly** `"{value}"` is replaced with the selected option's `value`. This is the only templating that exists. No other placeholders, and no substitution inside longer strings.

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
| `ambiguous` with `candidates` (2–5 matches) | `feedback` | `choice` "Which one should I remove?" with options from `candidates` (`caption` = `display_name`, `detail` = "{category} · your side \| app default", `value` = `side_uuid`) and submit "Remove" → `remove` with `side_uuid: "{value}"` |
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
- `{ "action": "undo_adjust", "side_uuid": "…", "undo": { … } }` → `undo_adjust_user_side()`. `undo` is opaque to the UI: it's copied from the button's payload. The reply is one `text` block ("Put back …" / "Removed your copy of … and restored the app's default"), with no Undo of the Undo. If the default has changed since, the reply is `ok: false` with "That side has changed since, so there's nothing to undo." and no `ui_body`.

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
| `undo_set_auto` reply | one `text`: "Put back the previous setting for {name}." or, for a copy, "Removed your copy of {name} and restored the app's default." |

### 5.6 `list_my_snacks`: the interactive snack list

**Status:** owner, 2026-10-10. The producer is built (`snackListBlocks` in `_shared/ui-body.ts`, called by `list_my_snacks`); `planner-agent` deploy and migration `2026101001` are pending, until the frontend renders it. The Edit button is a placeholder until its action is designed.

"What snacks do I have" returns the list as blocks, on `response_type: "feedback"` (§2). Blocks are in category order (`tbl_snack_categories.display_order`), then alphabetical inside each category, the same order as the tool result. With a cateAgory filter there is only that category.

**Per category:**

| Block | Content |
|---|---|
| `text`, `style: "header"` | The category label: "Nuts & seeds". |
| `text`, `style: "sub_header"` | The category's serving size: "Approx. 30 g" (`portion_default_g`). |

**Per snack**, under its category:

| Block | Content |
|---|---|
| `button_group`, `collapsed: true` | `id` `snack_{first 8 hex of snack_uuid}`, `caption` the snack's name, and `detail` "{Yours \| App} · {default amount} · Auto {on \| off}". The default amount is "30 g", "1 unit (50 g)" for a whole item, or "1 serving" for a recipe snack. |
| `nutrition`, `hidden: true` | `id` `snack_{8}_nutrition`, the macros from `tbl_snacks.macros`, and a `caption` such as "Per 30 g", "Per unit (approx. 50 g)", "Per 2 units (100 g)" or "Per serving". For an ingredient the macros are at the default amount; for a recipe they're per single serving. A snack with no macros gets no block, and its Info button is a placeholder. |

**The group's buttons**, in this order:

| `id` | Caption | Icon | Action |
|---|---|---|---|
| `snack_{8}_remove` | Remove | `trash` | `call` `snacks-catalog` `{ "action": "remove", "snack_uuid": "…" }`. The reply is "Removed X" + Undo (§5.5), in the group's slot. |
| `snack_{8}_info` | Info | `info` | `toggle` → `snack_{8}_nutrition` |
| `snack_{8}_edit` | Edit | `edit` | **None yet**: a placeholder, rendered disabled (§3.1.4). |
| `snack_{8}_auto` | Auto off / Auto on | `toggle` | `call` `snacks-catalog` `{ "action": "set_auto", "snack_uuid": "…", "auto": false \| true }`. The caption names what the tap **does**; the current state is in `detail`. The reply is the §5.5 set-auto blocks, with Undo, in the group's slot. |

"Remove" rather than "Delete": for an app snack it only hides the snack for this user.

**What the model writes.** Because `ui_body` isn't saved (§4.4), the model's `response` still has to make sense on its own after a reload. It gives the counts per category ("27 snacks: 3 fruit, 2 nuts & seeds, …") and names the snacks only when the user asked about one category. Migration `2026101001` puts this in the planner's INTENT 8 line, and the tool's own message says the same.

**Size.** With the test user's 27 snacks, the body is 66 blocks (6 headers, 6 sub-headers, 27 groups, 27 nutrition blocks), about 25 KB of JSON.

**Example**, trimmed to one category and one snack:

```json
{
  "version": 1,
  "blocks": [
    { "type": "text", "style": "header",     "caption": "Nuts & seeds" },
    { "type": "text", "style": "sub_header", "caption": "Approx. 30 g" },
    {
      "type": "button_group",
      "id": "snack_1fc06978",
      "caption": "Almonds",
      "detail": "App · 30 g · Auto on",
      "collapsed": true,
      "buttons": [
        { "id": "snack_1fc06978_remove", "caption": "Remove", "icon": "trash",
          "action": { "kind": "call", "endpoint": "snacks-catalog",
                      "body": { "action": "remove", "snack_uuid": "1fc06978-94ec-4b70-aba8-feb56ab0150f" } } },
        { "id": "snack_1fc06978_info", "caption": "Info", "icon": "info",
          "action": { "kind": "toggle", "target": "snack_1fc06978_nutrition" } },
        { "id": "snack_1fc06978_edit", "caption": "Edit", "icon": "edit" },
        { "id": "snack_1fc06978_auto", "caption": "Auto off", "icon": "toggle",
          "action": { "kind": "call", "endpoint": "snacks-catalog",
                      "body": { "action": "set_auto", "snack_uuid": "1fc06978-94ec-4b70-aba8-feb56ab0150f", "auto": false } } }
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
```

**What the user sees:**
1. Headers with one tappable row per snack: "Almonds" over "App · 30 g · Auto on".
2. Tapping the row shows Remove · Info · Edit (disabled) · Auto off.
3. Info opens the macros under the row.
4. Remove turns that row into "Removed "Almonds" from your snacks." + Undo. The rest of the list is untouched.

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
5. **`list_my_sides`** gets the same list (§5.6) without the Auto button, once the snack list is proven.
