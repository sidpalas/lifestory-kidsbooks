# Story looks

## What it is

A story draws each family member's look with its own approved parts and palettes (D26). "Who's in this book"
chooses family members and previews their saved looks immediately. "Change look for this book" opens the character
builder's visual picker with compatible options; these changes stay in the preview until "Make the book" saves
them on that book, never on the family member (D46). "Use <name>'s saved look" resets the book's changes.
Alternatively, "Try looks on <name>, the story's example" opens a separate visual picker for reviewing the story's
art across new parts, palettes, additions (D41), or recolouring changes.

## Routes and roles

- `/stories/<slug>`: role selects choose family members or the story's example. Visual pickers show each option as
  a portrait or colour swatch. Cast, example looks and book-only changes live in the URL; nothing is saved yet.
- Any signed-in member can preview a published story; only owners and parents can make a book.
- `/books/<id>`: owners and parents can change the book-only look, reset it, or edit the separate saved family look.
  Viewers read the book without editing.

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
