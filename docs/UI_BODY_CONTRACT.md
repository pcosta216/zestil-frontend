# UI body contract — `ui_body` and `response_type: "feedback"`

**Status:** v1 built 2026-10-08 — migration `2026100801_restore_user_side.sql` **not yet applied**; `planner-agent` and `sides-catalog` **deploy pending**; frontend renderer not built. First and only user: the planner's `remove_from_my_sides` tool.
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
| `planner-agent` | `feedback` | `remove_from_my_sides` (§5) |

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

Three types: `text`, `button` and `choice`.

**`text`**: a line of text, shown as is.

```json
{ "type": "text", "caption": "Removed \"Roasted carrots\" from your sides." }
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"text"` | |
| `caption` | string | Plain text, no markdown. |

**`button`**: a single action.

```json
{
  "type": "button",
  "id": "undo",
  "caption": "Undo",
  "style": "secondary",
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
| `action` | Action (§4) | What the button does. |

**`choice`**: pick one option from a list, then submit. This is the radio-button list.

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
| `submit.action` | Action (§4) | Run with `{value}` substituted (§4.2). |

## 4. Actions

### 4.1 `kind: "call"`: the UI calls an edge function directly

```json
{ "kind": "call", "endpoint": "sides-catalog", "body": { "action": "remove", "side_uuid": "…" } }
```

The UI sends `POST {SUPABASE_URL}/functions/v1/{endpoint}`, with `Authorization: Bearer <the signed-in user's JWT>` and `body` as the JSON body. There is **no model call and no chat turn**: the action is deterministic and finishes in about a second.

- **Endpoint allowlist.** The frontend calls only endpoints it knows. v1 allows `sides-catalog` and nothing else. An action naming another endpoint renders disabled. A response can never point the UI at an arbitrary URL.
- **No account in the payload.** `body` never contains `user_id` or `account_key`. `sides-catalog` takes the account from the JWT and refuses a `user_id` that disagrees with it, so a tampered payload can't act on another account.
- **Single-shot.** While the call is in flight, the control shows a pending state and every control in that `ui_body` is disabled. A double tap must not send two calls.

`kind: "message"` (send text back into the chat as the user's next turn) is **reserved** and not used in v1.

### 4.2 `{value}` substitution

In a `choice`'s `submit.action.body`, any string that is **exactly** `"{value}"` is replaced with the selected option's `value`. This is the only templating that exists. No other placeholders, and no substitution inside longer strings.

### 4.3 What a call returns, and what the UI does with it

Every `call` endpoint used here returns:

```json
{ "ok": true | false, "message": "<one user-facing sentence>", "ui_body": { ... } }
```

`ui_body` is optional in the reply.

- **Reply with `ui_body`:** it **replaces** the original `ui_body` on that chat message. The new blocks render where the old ones were. This is how "Remove" from a `choice` turns into "Removed X" + Undo.
- **Reply without `ui_body`:** the original blocks are replaced by a single `text` block showing `message`.
- **Network error or non-2xx:** the controls are re-enabled, and a short inline error is shown under them. Nothing is replaced.

### 4.4 Lifetime

`ui_body` lives only on the chat message that delivered it. It is not added to `history` or saved with the conversation, so after a reload the message shows only its `response` text. The UI does not expire buttons. Staleness is the endpoint's job: an Undo pressed long after, or twice, returns a clear `ok` reply (for example "already in your sides") instead of failing or acting twice.

## 5. First user: `remove_from_my_sides`

### 5.1 When the planner returns `response_type: "feedback"`

`remove_from_my_sides` ran in this turn, **and** no plan-writing tool ran (`DAY_UPDATE_TOOLS` → `day_update` still wins). If the turn also called read-only tools (`find_sides`, `get_week_plan`), the type is still `feedback`.

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

## 6. Implementation notes (agent side)

- **One builder, two callers.** `supabase/functions/_shared/ui-body.ts` (new) holds the block types and `removeSideUiBody(result)` / `restoreSideUiBody(result)`. The planner and `sides-catalog` both import it, so the chat path and the direct-call path can't drift apart.
- **Planner.** `removeFromMySides` attaches the built blocks to its result. `index.ts` collects them across the turn, adds `'feedback'` to `ResponseType` and `deriveResponseType` (§5.1), and sets `ui_body` only when the final type is in the §2 "attached on" table (v1: `feedback`). Otherwise it drops the blocks and logs it (§5.1). The blocks are **not** shown to the model: the tool result the model sees stays as it is today.
- **Extraction pass.** It may refine `info` → `macro_summary` today. It must never change `feedback`. Its override only applies when the type is `info`, so this already holds; keep it that way.
- **Migration:** `2026100801_restore_user_side.sql`, for the RPC and grants.
- **Deploys:** `planner-agent` and `sides-catalog`. `router-agent` is unchanged.
- **Docs to update when it ships:** planner `SPEC.md` §2 (the new type and field, linking here), `TOOLS.md` (`remove_from_my_sides`), `SIDES_CATALOG.md` (the `restore` action) and a `DECISIONS.md` entry.

## 7. Open questions (not blocking v1)

1. **Other tools.** `add_to_my_sides` is the obvious next user (Undo → `remove`, and a `choice` for its candidates). After that, any confirmation that today is a yes/no in prose.
2. **`quick_replies` and `suggestion_pending`.** Both are really `ui_body` blocks: a row of `message` buttons, and a Yes/No confirmation. Folding them in later would need `kind: "message"` and a frontend migration, so they stay as they are for now.
3. **`multi` select** for "remove these three", if it's ever needed.
