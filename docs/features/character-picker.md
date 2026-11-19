# Character picker

## What it is

A parent adds a family member as a character: name, pronouns, an age, a curated look of that age, then one feature at
a time (face, features from teen up, skin, hairstyle, hair colour, glasses, facial hair from adult up). A
story-independent portrait (`/api/portrait?<look>`, D28) follows every choice, and the summary under it names the look.

## Routes and roles

- `/characters/new` (add), `/characters/<id>` (edit; "Change look" in a book's cast links here).
- Owner and parent edit; a viewer (grandparent) reads characters but has no picker.

## Seed data

- `parent@lifestory.dev` owns "The Example Family"; `grandparent@lifestory.dev` is its viewer.
- Look vocabulary: `packages/core/src/looks/vocabulary.ts`; portrait art: `packages/core/src/looks/portrait/`.

## Verify

`mise run verify -- picker [--config dev|image|live]`

Starts from Young child, goes to Older child and back, picks "Curly black hair", then Long hair, Red hair colour, Very
light skin, Round glasses. Checks after each step: the summary text, the portrait URL changed, and the portrait
image decoded; then every option thumbnail loaded and every `/api/portrait` URL answered `image/png`. It never
presses "Add to the family", so it writes nothing. Evidence: `picker-<n>-<step>.png` per step, `picker-final.png`,
`portraits.txt`.

## Gotchas

- The form opens at Young child, so clicking Young child first changes nothing: the age step goes away and back.
- Pronouns order hairstyles and curated looks, never filter them (D29); button names are stable, positions aren't.
- Teen and up add a Features step, adult and up a Facial hair step; a viewer gets no picker at all.
