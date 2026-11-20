# Character picker

## What it is

A parent adds a family member as a character: name, pronouns, an age, a curated look of that age, then one feature at
a time (face, features from teen up, skin, hairstyle, hair colour, glasses, facial hair from adult up). A
story-independent portrait (`/api/portrait?<look>`, D28) follows every choice, and the summary under it names the look.

Signed-out visitors can try the same picker on the landing page ("Try it: build a child"): Baby, Toddler, and Young
child only (whom picture books are mostly bought for), labelled Demo, with no name, no save, and no server calls. Its portraits stack static, pre-recoloured layers from
`apps/web/public/marketing/looks/` instead of `/api/portrait` (which needs a session and renders on the server), and
its code loads only when the button is pressed.

## Routes and roles

- `/characters/new` (add), `/characters/<id>` (edit; "Change look" in a book's cast links here).
- Owner and parent edit; a viewer (grandparent) reads characters but has no picker.
- `/` signed out: the landing demo, for anyone.

## Seed data

- `parent@lifestory.dev` owns "The Example Family"; `grandparent@lifestory.dev` is its viewer.
- Look vocabulary: `packages/core/src/looks/vocabulary.ts`; portrait art: `packages/core/src/looks/portrait/`. Its hair
  and facial hair reach the head's ink outline (`fixtures/art-sources/portrait/build-outline.ts`, the shared
  `coverOutline`); `part-cutout.test.ts` holds every portrait part to that and to `CROWN_GAP_LIMIT`.

## Verify

`mise run verify -- picker [--config dev|image|live]`

Starts from Young child, goes to Older child and back, picks "Curly black hair", then Long hair, Red hair colour, Very
light skin, Round glasses. Checks after each step: the summary text, the portrait URL changed, and the portrait
image decoded; then every option thumbnail loaded and every `/api/portrait` URL answered `image/png`. It never
presses "Add to the family", so it writes nothing. Evidence: `picker-<n>-<step>.png` per step, `picker-final.png`,
`portraits.txt`.

The landing demo: `verify e2e -- smoke` ("signed-out visitors try the character picker…") checks a baby is one
layer, then picks Toddler, braids, red, Young child, and glasses, and checks the summary, that the preview's three
layers are `/marketing/looks/` files that loaded, that there's no save button, and that no `/api` or server function request was made.

## Gotchas

- The demo's layers are generated: rerun `node apps/web/scripts/marketing-looks.ts` after the portrait art changes
  (it checks stacks against `lookPortrait` before writing). A dev server started before `public/marketing/looks`
  existed answers 404 for them until restarted.

- The form opens at Young child, so clicking Young child first changes nothing: the age step goes away and back.
- Pronouns order hairstyles and curated looks, never filter them (D29); button names are stable, positions aren't.
- Teen and up add a Features step, adult and up a Facial hair step; a viewer gets no picker at all.
