# Photo books

## What it is

A parent puts their family into a story (D56): one photo per role, checked in seconds (`photo.check`), then a
"Draw {name}" for each person's character sheet, then a cover once everyone is drawn (`likeness.sheet`); three drawings per
person, where a note that edits their sheet or a new photo uses one, and "Make my book", which is the order (D57). The order deletes the photos, unless the parent
opted in to photo review, and draws every figure on every page from the approved sheets (`book.make`,
`page.figure`). The parent then changes up to 3 pages, keeping the original or the new version of each, approves a
proof and sends the book for review. The operator redoes a page, refuses the book with a note, or approves it for
print (`book.release`). Built on the fakes; the Dream Adventure import and a real-provider run are still to come.

## Routes and roles

- Story page: "Make the book" makes a draft book, or reopens the family's draft of the story (owner and editor; a
  viewer sees the stock characters only). A note under "The pages with …" says the example names and pictures are
  placeholders that the book replaces with each person's name and a drawing from their photo.
- `/books/<id>`: the steps above the editor (`components/book/photo-book.tsx`): consent, a photo per role
  (`POST /api/books/<id>/photos`, resized to 1536 px in the browser; chosen with the button or dropped on that
  person's card, where a drop of several files or a non-photo uploads nothing and says why; on touch screens a
  "Take a photo" button opens the rear camera, since Android 14+ Chrome's picker doesn't offer it), up to three optional extra photos per person, one slot per pose with its own buttons and drop target, each person's look read from the photo to confirm or correct (swatches, "From the photo" or "You set this"), "Draw {name}", their sheet and six expressions with a note for another drawing (drawings left shown), the cover,
  "Make my book", then the page-change form under each page and "Read your book": three steps in order above the
  editor (read every page, with the changed pages linked; make a proof and approve it; send for review), one marked
  current, a step with a redraw or a render under way marked in progress, and the send button off with the reason
  until a proof is approved and no page is redrawing. An approved proof the book has changed since is marked out of
  date with a warning, though sending stays allowed (the server only needs an approved proof). The last page offers
  "Done reading: make your proof ↑". From the order on, a strip of the book's stages (photos, drawing, read and
  approve, our review, print) marks where it is.
  From the order on, each cast card shows that role's approved sheet as a thumbnail that opens it across the card,
  with the six expressions drawn with it underneath (sheets drawn before the expressions show alone), each with a
  full-size link, for every family member, viewers included; display only, never a printed page.
- The draft book's photo, preview and order steps, then its page-change and review steps: owner and editor. Drafts
  are hidden from Our books and from the story page's list of the family's books.
- `/policies/terms`, `/policies/privacy`, `/policies/child-safety` (D58), public, from `apps/web/src/policies/*.md`
  rendered with marked; linked from the landing footer, the photo step and the order step. Bump `POLICY_VERSION`
  in `contracts.ts` with any text change.
- `/admin` "Books to review" and `/review/<id>`: the operator only, through `reviewBook`; sheets, pages with notes,
  the approved proof (and whether it still shows the pages: a redo since makes it out of date), and photos only on an
  opted-in book. Each character's photo, sheet and six expressions fit their card at any width. Redo a page with its
  own note under it; approve (off while a page redraws) or refuse with a note (emailed to the owners) in the decision
  box, kept in view beside the pages from 1024 px and after them on a phone.

## Seed data

- `fixtures/stories/kite-day` (The Kite Day): the placeholder format 4 story. Dream Adventure comes with
  its import.
- The fake `PhotoCheck` refuses any photo whose file name contains `two-faces`.
- `IMAGE_PROVIDER=fake` and the fake `PhotoCheck` are the defaults; no API calls in orbs or CI.

## Verify

`mise run verify -- e2e -- photo-book` (`apps/web/e2e/photo-book.spec.ts`, about 60 s): a two-role book through the check with one
bad photo, a refused two-file drop, a dropped photo and one from the camera input, a corrected hair length that reaches the sheet prompt, an extra photo of someone else refused and a passing one sent to the sheet, "Draw {name}" for each person, two notes using the child's last drawings while the grown-up's sheet stays, a refused new photo for the child, the order with the photos gone from storage and each person's sheet and expressions kept and shown with the cast, three page changes with keep and use-new, the
"Read your book" steps (send off until a proof is approved, the last page leading back to the proof, an approved proof
out of date after a text edit and current again when it's undone, the card contained at 320 and 390 px), the operator's
character cards and decision contained at 320 and 390 px, a redo with its own note that holds approval until it's
redrawn and puts the proof out of date, operator approval, a second book opted in to photo review whose photos the operator sees and approval
deletes, and the 24 h sweep of an abandoned draft. A second test covers the upload limits (D59): a refused request
not counted, a refused photo counted, a burst sent at once of which exactly the limit is stored, a check task for each stored upload and none for a refused one (the 21st in 10 minutes), the total allowance
with the message on the person's card, and that an unpaid order raises nothing while an approved book does. Other book specs start from a drawn book with `markDrawn`
(`e2e/drawn.ts`).

## Gotchas

- Every photo the server stores counts toward the uploader's limits (D59, `photo_upload`): a burst per 10 minutes
  and a total that approved books raise. A test account that hits them: `delete from photo_upload where user_id = …`
  in a dev database.
- `OPENAI_DATA_RETENTION` (`standard` or `zero`) states what the OpenAI project keeps; it blocks nothing (Sid,
  2026-11-24). The policies (`{{openai-retention}}`), the consent statement and the landing page take their retention
  sentence from `retentionCopy` by it, and each consent records `<POLICY_VERSION>/standard` or `/zero`. Production
  says `standard` until zero data retention is on for the project. Don't run them unless asked: a book costs about US$1.24 worst case.
- Photos are deleted right after the order by default. If the parent opts in to photo review, the operator sees
  them beside the sheets, and they go at approval, refusal, or 30 days after the order.
- Each person's photo and sheet cards fit their column at 320 and 390 px (`photo-book.spec.ts`, `expectContained`):
  buttons named after the person wrap, and a select is as wide as its longest option unless it may shrink (`min-w-0`).
  Keep that when the photo step changes.
- Figures on one page must not touch or overlap; the import refuses such pages.
- A generated figure keeps only the parts of the drawing attached to the bald figure, within a generous backstop
  (the bald figure dilated, plus an ellipse round the head for hair, hats and helmets) that fades instead of
  cutting: on p04 the model once redrew the elephant behind the hero, which this drops whole. A figure that loses
  more than 5% to the clip, or runs off its window, is drawn again; the least clipped of three tries is kept and
  flagged in review. Art for photo stories needs tight figure cuts and a scenery occluder over any body edge the
  scenery hides (D56).
