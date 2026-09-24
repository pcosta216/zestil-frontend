# List of things that need fixing or can be improved but are not a priority

## Bugs
1. n_goal — Skip writes the goal slug into macro_priority (macro_priority: ["eat_healthier_balanced"], verified by running applyAnswer directly) — n_goal.md:42
1. n_health_condition_note — implemented but unreachable; no live option routes to the branch — n_health_condition_note.md:3
1. n_summary — its prompt is an authoring instruction ("Render a short human-readable recap of…") and renders to users verbatim
1. n_fixed_meals — a half-filled composer is discarded silently on Continue, no warning

## Things to improve
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