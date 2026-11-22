# Character picker

## What it is

A parent adds a family member as a character: name, pronouns, an age, then one feature at a time in a fixed order
(skin tone, face, features from teen up, hairstyle, hair colour, facial hair from adult up, extras/glasses). Each
choice changes only its own axis; there are no whole-look presets (D50). New characters start from `defaultLook`.
Glasses and facial hair go to none at an age that doesn't draw them and come back with an age that does, while the
picker is open (not saved). Each age offers its own hairstyles (D51): bald at every age; babies wispy or soft curls;
toddlers and young children also a top knot or puffs; full-head styles from toddler up. A hairstyle an age doesn't
have becomes the nearest one it does (`hairAt`: long is wispy at baby) and comes back the same way. Facial hair is
none, a moustache or a full beard; stubble was retired (D52), and a look saved with it reads as none. Bald hides the
hair colour step. A
story-independent portrait (`/api/portrait?<look>`, D28) follows every choice, and the summary under it names the look.

Signed-out visitors can try the same picker on the landing page ("Try it: build a child"): Baby, Toddler, and Young
child only (whom picture books are mostly bought for), labelled Demo, with no name, no save, and no server calls. Its portraits stack static, pre-recoloured layers from
`apps/web/public/marketing/looks/` instead of `/api/portrait` (which needs a session and renders on the server), and
its code loads only when the button is pressed.

## Routes and roles

- `/family/new` (add), `/family/<id>` (edit, both under Our family; "Change look" in a book's cast links here).
- Owner and editor edit; a viewer (grandparent) reads characters but has no picker.
- `/` signed out: the landing demo, for anyone.

## Seed data

- `parent@lifestory.dev` owns "The Example Family"; `grandparent@lifestory.dev` is its viewer.
- Look vocabulary: `packages/core/src/looks/vocabulary.ts`; portrait art: `packages/core/src/looks/portrait/`. Its hair
  and facial hair reach the head's ink outline and cover the ink they lie over
  (`fixtures/art-sources/portrait/build-outline.ts`, the shared `coverOutline`); `part-cutout.test.ts` holds every
  portrait part to that and to `CROWN_GAP_LIMIT`. Rerun `node apps/web/scripts/marketing-looks.ts` after re-cutting.

## Verify

`mise run verify -- picker [--config dev|image|live]`

Starts from Young child, goes to Older child and back, then Very light skin, Oval face, Long hair, Red hair colour,
Round glasses. Checks after each step: the summary text, the portrait URL changed, and the portrait
image decoded; then every option thumbnail loaded and every `/api/portrait` URL answered `image/png`. It never
presses "Add to the family", so it writes nothing. Evidence: `picker-<n>-<step>.png` per step, `picker-final.png`,
`portraits.txt`.

The landing demo: `verify e2e -- smoke` ("signed-out visitors try the character picker…") checks a baby offers bald,
wispy and soft curls and a bald baby is one layer, then picks Toddler, braids, red, Young child, and glasses, and checks the summary, that the preview's three
layers are `/marketing/looks/` files that loaded, that there's no save button, and that no `/api` or server function request was made.

## Gotchas

- The demo's layers are generated: rerun `node apps/web/scripts/marketing-looks.ts` after the portrait art changes
  (it checks stacks against `lookPortrait` before writing). A dev server started before `public/marketing/looks`
  existed answers 404 for them until restarted.

- The form opens at Young child, so clicking Young child first changes nothing: the age step goes away and back.
- Pronouns order hairstyles from young child up, never filter them (D29); babies and toddlers get a fixed order
  (D51). Button names are stable ("Bald", "Wispy hair"), positions aren't.
- Teen and up add a Features step, adult and up a Facial hair step; a viewer gets no picker at all.
