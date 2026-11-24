# Photo books

## What it is

A parent puts their family into a story (D56): one photo per role, checked in seconds (`photo.check`), then a
character sheet per role and a cover (`likeness.preview`), up to two rounds of notes that edit the sheets
(`likeness.revise`), and "Make my book", which is the order (D57). The order deletes the photos and draws every
figure on every page from the approved sheets (`book.make`, `page.figure`). The parent then changes up to 3 pages,
keeping the original or the new version of each, approves a proof and sends the book for review; the operator
approves it for print, redoes a page, or refuses it with a note. Being built: phases 3–9 of the "Photo books: plan
and UX" artifact.

## Routes and roles

- Story page: "Put your family in this book" makes a draft book (owner and editor; a viewer sees the stock
  characters only).
- The draft book's photo, preview and order steps, then its page-change and review steps: owner and editor. Drafts
  are hidden from Our books and from the story page's list of the family's books.
- Policies: terms, privacy policy, child safety and AI policy, linked from the footer, account setup, the photo
  step and the order step (D58).
- `/admin` review queue: the operator only, through `reviewBook`; it shows sheets and pages, never photos.

## Seed data

- To come with format 4: a photo story (Crosby locally; a small placeholder fixture for tests) and fake test photos,
  one named `two-faces` that the fake `PhotoCheck` refuses.
- `IMAGE_PROVIDER=fake` and the fake `PhotoCheck` are the defaults; no API calls in orbs or CI.

## Verify

`mise run verify -- e2e -- photo-book` once `photo-book.spec.ts` lands: a two-role book through the check with one
bad photo, two rounds, the order with the photos gone from storage, three page changes with keep and use-new, a
proof, operator approval, and the 24 h sweep of an abandoned draft. A dedicated `verify` command with screenshots of
each step comes with the parent screens.

## Gotchas

- Real providers need `OPENAI_ZDR=enabled` for the OpenAI project in use; without it the worker refuses to send a
  photo. Don't run them unless asked: a book costs about US$1.24 worst case.
- Photos are deleted at the order, on refusal, or after 24 h; a test that looks for them later finds nothing, by
  design.
- Figures on one page must not touch or overlap; the import refuses such pages.
