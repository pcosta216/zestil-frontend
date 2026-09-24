# Draft: `favorite_recipes` section prompt — compound-entry rule

Two additions to the existing section. Part A is safe to push on its own. Part B should only go
live once the Edge Function passes `split_into` through its output schema, otherwise the field
is generated and then silently dropped.

---

## Part A — add to the Flag criteria

Replace the existing Flag paragraph:

> Flag (never invalid) when the entry reads as a category rather than a specific recipe — a
> cuisine name, a generic ingredient, or a near-duplicate of something already in
> favorite_dishes (suggests the user re-answered a different question). Reason: a friendly,
> specific nudge toward naming the particular dish or version meant.

with:

> Flag (never invalid) when the entry reads as a category rather than a specific recipe — a
> cuisine name, a generic ingredient, or a near-duplicate of something already in
> favorite_dishes (suggests the user re-answered a different question) — OR when the entry names
> two or more distinct dishes rather than one ("butter chicken and pizza", "lasagna + caesar
> salad", "pad thai / green curry"). Reason: a friendly, specific nudge toward naming the
> particular dish or version meant; for a multi-dish entry, toward listing them separately.
>
> Be careful with the word "and": it is part of many single dishes ("macaroni and cheese", "fish
> and chips", "sweet and sour pork", "bangers and mash", "rice and beans"). Only treat an entry
> as multi-dish when the parts are genuinely separate dishes a person would eat or order on
> their own — not when "and" joins the components of one named dish. When in doubt, treat it as
> ONE dish and return valid.

## Part B — add after the Normalize paragraph (ships with the schema change)

> When — and only when — you flagged an entry as naming two or more distinct dishes, also return
> `split_into`: an array of the individual dish names, each cleaned to display text the same way
> `label` is ("butter chicken and pizza" -> ["Butter Chicken", "Pizza"]). Omit `split_into`
> entirely for every other entry and every other verdict. Do not use it to break a single dish
> into its ingredients — ["Macaroni", "Cheese"] is never correct. Each element must stand alone
> as something the user could have typed as its own entry.

---

## Frontend behaviour once each part lands

| | A only | A + B |
|---|---|---|
| Compound entry | flagged, no approve option | flagged, no approve option |
| Resolving it | "Rewrite this one" — text returns to the input, user adds commas | "Add as 2 separate recipes" — one tap, chips replaced |
| Per-dish verdicts | yes, on the next Continue | yes, on the next Continue |

`split_into` is optional on the wire: if it's absent, the row falls back to the Part A behaviour.
So pushing A alone is safe and complete, and B is a pure UX upgrade on top.
