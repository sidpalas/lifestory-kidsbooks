# Story looks

## What it is

A story draws each family member's look with its own approved parts and palettes (D26). On a story's preview the
"Characters" section sets each role's look (curated looks and one select per axis), and every page recomposes and
recolours its figures. Use it to review a story's art across the range of looks: new parts, palettes, additions
(D41), or recolouring changes.

## Routes and roles

- `/stories/<slug>`: the selects are labelled `<Role label>: <Axis>`, e.g. `The child: Hair colour`. Looks live in
  the URL (`?looks=`), so nothing is saved.
- Any signed-in member can preview a published story.

## Seed data

- `the-moon-picnic` (roles "The child" and "A grown-up") and `the-paper-boat`.
- Skins and hair colours: `packages/core/src/looks/vocabulary.ts`.

## Verify

`mise run verify -- looks [--story <slug>] [--config dev|image|live]`

Sets every role to the lightest skin, then the darkest, with each hair colour (10 combinations), waits for the pages
to recompose, and checks every layer loaded and every combination drew different layers from the ones before.
Evidence: `contact-sheet.png`, one row per combination and one column per page. Look at it: the checks catch broken
and unchanged layers, not halos or wrong-looking art.

## Gotchas

- The first view of a combination recolours its layers on the server, so pages lag the selects by a second or more;
  the CLI waits for the layer URLs to change instead of sleeping.
- Hairstyles, glasses, and facial hair aren't swept yet; a role's own age decides which parts it draws (D29).
