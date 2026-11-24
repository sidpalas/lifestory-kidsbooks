# Photo books

## What it is

A parent puts their family into a story (D56): one photo per role, checked in seconds (`photo.check`), then a
character sheet per role and a cover (`likeness.preview`), up to two rounds of notes that edit the sheets
(`likeness.revise`), and "Make my book", which is the order (D57). The order deletes the photos, unless the parent
opted in to photo review, and draws every figure on every page from the approved sheets (`book.make`,
`page.figure`). The parent then changes up to 3 pages, keeping the original or the new version of each, approves a
proof and sends the book for review. The operator redoes a page, refuses the book with a note, or approves it for
print (`book.release`). Built on the fakes; the Crosby import and a real-provider run are still to come.

## Routes and roles

- Story page: "Make the book" makes a draft book, or reopens the family's draft of the story (owner and editor; a
  viewer sees the stock characters only).
- `/books/<id>`: the steps above the editor (`components/book/photo-book.tsx`): consent, a photo per role
  (`POST /api/books/<id>/photos`, resized to 1536 px in the browser), the sheets and cover with two change rounds,
  "Make my book", then the page-change form under each page and "Send for review". Proofs appear from page changes on.
- The draft book's photo, preview and order steps, then its page-change and review steps: owner and editor. Drafts
  are hidden from Our books and from the story page's list of the family's books.
- `/policies/terms`, `/policies/privacy`, `/policies/child-safety` (D58), public, from `apps/web/src/policies/*.md`
  rendered with marked; linked from the landing footer, the photo step and the order step. Bump `POLICY_VERSION`
  in `contracts.ts` with any text change.
- `/admin` "Books to review" and `/review/<id>`: the operator only, through `reviewBook`; sheets, pages with notes,
  the approved proof, and photos only on an opted-in book. Redo a page, refuse with a note (emailed to the owners),
  or approve.

## Seed data

- `fixtures/stories/kite-day` (The Kite Day): the placeholder format 4 story. Crosby's Dream Adventure comes with
  its import.
- The fake `PhotoCheck` refuses any photo whose file name contains `two-faces`.
- `IMAGE_PROVIDER=fake` and the fake `PhotoCheck` are the defaults; no API calls in orbs or CI.

## Verify

`mise run verify -- e2e -- photo-book` (`apps/web/e2e/photo-book.spec.ts`, about 60 s): a two-role book through the check with one
bad photo, two rounds, the order with the photos gone from storage, three page changes with keep and use-new, a
proof, operator approval, a second book opted in to photo review whose photos the operator sees and approval
deletes, and the 24 h sweep of an abandoned draft. Other book specs start from a drawn book with `markDrawn`
(`e2e/drawn.ts`).

## Gotchas

- Real providers need `OPENAI_ZDR=enabled` for the OpenAI project in use; without it the worker refuses to send a
  photo. Don't run them unless asked: a book costs about US$1.24 worst case.
- Photos are deleted right after the order by default. If the parent opts in to photo review, the operator sees
  them beside the sheets, and they go at approval, refusal, or 30 days after the order.
- Figures on one page must not touch or overlap; the import refuses such pages.
- A generated figure is clipped to its keep zone (the bald figure dilated, plus a hair zone above the head), not its
  box: on p04 the model redrew the elephant behind the hero inside the box. Pages that lose many pixels to the clip
  are flagged in review. Art for photo stories needs tight figure cuts and a scenery occluder over any body edge the
  scenery hides (D56).
