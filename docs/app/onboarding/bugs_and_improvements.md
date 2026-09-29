# List of things that need fixing or can be improved but are not a priority

## Bugs
1. n_goal — Skip writes the goal slug into macro_priority (macro_priority: ["eat_healthier_balanced"], verified by running applyAnswer directly) — n_goal.md:42
1. n_health_condition_note — implemented but unreachable; no live option routes to the branch — n_health_condition_note.md:3
1. n_summary — its prompt is an authoring instruction ("Render a short human-readable recap of…") and renders to users verbatim
1. n_fixed_meals — a half-filled composer is discarded silently on Continue, no warning

## Things to improve
### back button
*fixed on 24-09-2026*
* Every screen now re-renders with the answer that was given: selections re-selected, typed
  "Other" entries listed under the field as removable rows. Covers the Back button and
  n_allergy_confirm's "Something's missing or wrong" rewind. See `_shared/back-navigation.md`.
* Still open, and a different thing: items 1 under *Intolerances screen* and *Country / region
  selection* below ask for feedback at the moment text is typed, not on the way back.

*not a bug, 25-09-2026* — "two dishes typed under Other, only one comes back". The other one
matched a curated tile after the agent normalised it (`chelo kabab` → `kebab`, which is in the
Lebanese list), so it came back as a **selected tile** rather than a removable row — the
post-normalisation dedupe doing its job. Verified against the live agent with a non-matching
pair: both entries stored, both rows restored. See `_shared/validator-gate.md`.

When the user uses the back button, there is not feedback on the current options choosen, or what "others" were added.
I'd like that when the user pushes the back button, the onscreen options that have been selected and are stored in memory, show up selected, and if the "other" was used, there should be a list present where the user can remove the items from, if they so whish.

### Pairings screen
1. When loading the dishes, match the dishes being offered with the allergies and intolerances selected and ensure to suggest valid options based on those preferences
### Intolerances screen
1. If the user chooses "other", there is no feedback that the user input was accepted

### Country / region selection
1. Same thing for the contry/region selection

### When choosing dishes
In diet styles I choose Mediterranean, Vegetarian and Vegan.
In dishes I choose:
“Lasagna”

Got this feedback from the agent
Lasagna typically contains dairy, but you told us you're vegan. Still want to add it?

However, we had established that the options available in the *diet styles* screen, were not exclusive e.g. I follow a mediterranean diet and I eat everithing in it including beef and pork. I also like vegetarian and vegan food, so I would like  suggestions accordingly.
This type of suggestion from the agent makes sense, IF the user had only choosen Vegan, then, and only then the user should have gotten this call.

### Fats exclusion cards
*fix on 24-09-2026*
* the issue was related to the intolerances and not the diet styles, so it was working as expected. I also corrected the curated:intolerance_macro.exclusions entry in tbl_onboarding_content and removed ghee and butter form the lactose intolerant entry.

In diet styles I choose Mediterranean, Vegetarian and Vegan, and choose nut allergy.
Nuts where excluded—correct since i said i have a nuts allergy.
However, butter, ghee were also excluded. Considering we had established that the options available in the *diet styles* screen, were not exclusive, these two options should be available, sice they are part of the Mediterranean diet. e.g. I follow a mediterranean diet and I eat everything in it including beef and pork. I also like vegetarian and vegan food, so I would like  suggestions accordingly.
This type of suggestion from the agent makes sense, IF the user had only chosen Vegan, then, and only then the user should have gotten this call.