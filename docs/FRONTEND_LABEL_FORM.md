# The label form: a food entered from its packet

**For:** whoever maintains `zestil-frontend` (the Plan tab chat). **From:** the agents repo, 2026-10-30 (updated the same evening: the `text` field and the editable name, D88). **Contract:** `docs/UI_BODY_CONTRACT.md` §3.1.8 (the `form` block), §4.8 (the `message` action), §2 (`ui_body` on `info` replies). **Design:** `docs/planner-agent/BRANDED_FOODS.md` §7, D86–D88. **Effort:** one new block type and one new action kind. Nothing breaks if you do nothing: the reply's text still asks for the numbers, and typed numbers still work.

## What it is

When the user names a food Zestil doesn't have ("I had a Ritter Sport bar as a snack"), Zestil looks it up in Open Food Facts and USDA and offers what it found. When nothing fits, or the user says "none of these" or "I'll enter the label", the reply now carries a **form**: the food's name (prefilled with what they said, theirs to change), the numbers from the packet, per 100 g (European labels) or per serving (American ones), what one serving weighs, salt or sodium, and the allergens it lists. The user fills it in and taps Save; the values go to the agent as their next chat turn, the food is saved to their list under the name they left, and whatever they asked for (the snack on today) happens in the same reply.

Before this, the numbers were typed in chat and the model carried them to the save: live, it filled in calories the user never gave, and once saved on a "No". With the form, no number passes through the model.

## What to build

1. **Render `ui_body` on `info` replies** as well as `feedback`. A question back to the user is always `info`, and the form comes with a question ("If you have the label, fill in its numbers below."). Where on screen is your call, as the contract says; under the reply's text is the obvious place.
2. **The `form` block** (contract §3.1.8): a caption, an optional detail line, the fields in order, a Save button and a Never mind button side by side.
   - `text`: a single-line text input, `value` prefilled, `max_length` when given, `hint` as placeholder or helper text. The first field of the label form is the food's **name**: what the user typed in chat, which they may not have meant as the name on their list ("Ritter sport dark whole hazelnuts chocolate bar"). They can shorten or correct it before saving.
   - `number`: a numeric input with `unit` shown after it ("g", "kcal", "mg"), `min`/`max` when given, `hint` as placeholder or helper text, `value` prefilled when given.
   - `choice`: pick one of `options` (radio or segmented control), `value` preselected when given.
   - `checks`: tick any of `options` (checkboxes), `value` ticked when given.
   - `required` fields must be filled before Save enables (a `text` field: not empty after trimming). Both Sodium and Salt are optional, but **one of them must be filled**: the agent asks again otherwise, with the form prefilled. If you can enforce "one of the two" client-side, better.
3. **The `message` action** (contract §4.8): the submit sends the user's next chat turn through the router, exactly like a typed message plus one field:
   - `message`: `action.text`, then `": "`, then every filled field as `caption: value unit`, joined by `"; "` (below). It shows in the transcript as the user's bubble.
   - `form`: the action's `payload` with the fields' `values` added (below).
   - Never mind sends `action.text` ("Never mind") alone, with no `form`.
   - After sending, **disable the form's controls and keep the values visible** (it can't be submitted twice), as a `call` disables its scope while in flight. The reply arrives as a new chat turn, as always.

## The request on Save

```json
{
  "message": "Label for Ritter sport dark whole hazelnuts chocolate bar: Name: Ritter Sport dark hazelnuts; The label gives the numbers: per 100 g; One serving weighs: 16.7 g; Calories: 568 kcal; Protein: 8.1 g; Carbohydrate: 46 g; Fat: 40.5 g; Sugars: 33 g; Salt: 0.02 g; Contains: Dairy, Tree nuts",
  "user_id": "…", "session_id": "…", "history": [ … ], "active_date": "2026-10-30",
  "form": {
    "form": "label_food", "name": "Ritter sport dark whole hazelnuts chocolate bar", "list": "snacks",
    "values": { "name": "Ritter Sport dark hazelnuts", "basis": "100g", "unit_g": 16.7, "kcal": 568, "protein": 8.1, "carbs": 46, "fat": 40.5, "sugar": 33, "salt_g": 0.02, "allergens": ["dairy", "tree nuts"] }
  }
}
```

- `form` is the block's `submit.action.payload` plus `values`, keyed by field `id`. `payload.name` is the name Zestil asked about; `values.name` is the name the user left in the field, and that is the one the food is saved under.
- A `text` field's value is the trimmed string. A `number` field's value is a number (a numeric string is accepted). A `choice` field's value is the option's `value`. A `checks` field's value is an array of the ticked options' `value`s. Leave an empty optional field out.
- The agent reads the name and the numbers from `form`, never from `message`; the text is for the transcript.

## What comes back

An ordinary chat reply:
- **Saved:** `day_update` with the meal cards when the food was also put on a day ("I had X as a snack"), or `feedback` with the added-item card and its Undo when it only went on a list ("add X to my snacks").
- **A number can't be right** (sugar above the carbohydrate, more than 100 g of macros in 100 g…) or **something is missing:** an `info` reply with the reason and the same form again, prefilled with what was given (the name included).
- **The food conflicts with the user's allergy or avoided foods:** an `info` reply with the question ("… Add it anyway?") and quick replies Yes / No, as for any food. A yes saves it with the form's values.

## The block, as sent

```json
{
  "type": "form", "id": "label_food",
  "caption": "Ritter sport dark whole hazelnuts chocolate bar: from the label",
  "detail": "What the label says, per 100 g or per serving. Salt or sodium, whichever it gives.",
  "fields": [
    { "kind": "text",   "id": "name",      "caption": "Name", "required": true, "max_length": 80, "hint": "as it will show on your list",
      "value": "Ritter sport dark whole hazelnuts chocolate bar" },
    { "kind": "choice", "id": "basis", "caption": "The label gives the numbers", "required": true,
      "options": [ { "caption": "per 100 g", "value": "100g" }, { "caption": "per serving", "value": "serving" } ], "value": "100g" },
    { "kind": "number", "id": "unit_g",    "caption": "One serving weighs", "unit": "g",   "min": 1, "max": 1000, "required": true,
      "hint": "the bar, pot or slice: the serving size on the label, or the net weight" },
    { "kind": "number", "id": "kcal",      "caption": "Calories",     "unit": "kcal", "min": 0, "required": true },
    { "kind": "number", "id": "protein",   "caption": "Protein",      "unit": "g",    "min": 0, "required": true },
    { "kind": "number", "id": "carbs",     "caption": "Carbohydrate", "unit": "g",    "min": 0, "required": true },
    { "kind": "number", "id": "fat",       "caption": "Fat",          "unit": "g",    "min": 0, "required": true },
    { "kind": "number", "id": "sugar",     "caption": "Sugars",       "unit": "g",    "min": 0, "required": true, "hint": "part of the carbohydrate" },
    { "kind": "number", "id": "sodium_mg", "caption": "Sodium",       "unit": "mg",   "min": 0, "required": false, "hint": "or salt, below" },
    { "kind": "number", "id": "salt_g",    "caption": "Salt",         "unit": "g",    "min": 0, "required": false, "hint": "or sodium, above" },
    { "kind": "checks", "id": "allergens", "caption": "Contains",
      "options": [ { "caption": "Crustaceans", "value": "crustaceans" }, { "caption": "Dairy", "value": "dairy" }, { "caption": "Eggs", "value": "eggs" }, …, { "caption": "Wheat", "value": "wheat" } ] }
  ],
  "submit": { "caption": "Save", "icon": "check",
              "action": { "kind": "message", "text": "Label for Ritter sport dark whole hazelnuts chocolate bar",
                          "payload": { "form": "label_food", "name": "Ritter sport dark whole hazelnuts chocolate bar", "list": "snacks" } } },
  "cancel": { "caption": "Never mind", "icon": "cross", "action": { "kind": "message", "text": "Never mind" } }
}
```

A food for lunch or dinner (a side) has one more required `choice` field, `side_role`: "What kind of side is it", with the plate roles (starch, vegetable, …). A correction carries `value` on the fields that were filled. The allergens list is Zestil's table (`tbl_allergens`, 13 names since 2026-10-30, Wheat the newest): render whatever comes, don't hardcode it.

## Where it shows up

Any agent that looks foods up: the Planner ("I had X as a snack", "add X to Tuesday's lunch"), and the Snacks, Sides and Breakfast agents ("add X to my snacks"). The form comes after "none of these", "I'll enter the label", "enter a label for it", nothing found, the product databases unreachable, or the hourly lookup limit reached. The same reply carries `quick_replies: ["Never mind"]`, which a renderer without the form can still use.

## Also changed 2026-10-30, nothing to build

- **The products' list's quick replies are now `"1"`, `"2"`, … and `"None of these"`,** one per product, built by the agent (before, a separate model guessed two to four buttons and often left "None of these" out). Your quick-reply row renders them as it does any; a tap sends the text as today, and the router takes it straight back to the asking agent.
- **The form's reply now keeps the request paused** on the agent side (`_router.paused`), so the filled-in form resumes it without a routing decision. Before, the form came back as a new request; it worked, but through the model.

## Also pending from before

`docs/FRONTEND_REPLY_PARTS.md` (replies made of `parts`), `docs/FRONTEND_REGION_PINNING.md` (pin the edge-function calls to `us-west-1`).
