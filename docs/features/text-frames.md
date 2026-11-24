# Text frames

## What it is

A page's text sits in text frames (book format 3, D54): boxes placed in inches inside the safe area, each holding
one or more paragraphs on an optional light panel, keeping to its top, middle or bottom as names change length. An
author adds frames from presets (along the bottom, along the top, right half, a small frame), drags them on the
preview, resizes them by their handles, nudges them with the arrow keys, or types their position and size. Typed
line breaks are kept. Both editors warn when text runs past its frame. Format 2 stories upgrade to one frame per
page when read and print exactly as before.

## Routes and roles

- `/author/<storyId>`: the Pages tab and the draft preview; the story's authors.
- `/books/<bookId>`: a family's text editor warns under a paragraph whose frame overflows; owners and editors.
- Every page view and the print page draw frames through `BookPage`.

## Seed data

The sample stories are format 2 and read as one frame per page. Start a version of one as
`operator@lifestory.dev` to edit frames; neither sample can publish a new version in an orb (look-vocabulary gaps).

## Verify

- `mise run verify -- e2e --ci -- authoring`: adds a second frame, places it by inch field and keyboard, publishes,
  and checks the family's book draws it at that position with its line break.
- `mise run verify -- proof --story the-kite-day`: words in frames on the same lines and within 0.5 pt (x) and
  1 pt (y) in the PDF.

## Gotchas

- A family's edits address paragraphs across frames in reading order; reordering frames in a new version changes
  which paragraph an edit lands on, as reordering paragraphs always did.
- Frames are measured from the trim, not the page: add the bleed for CSS positions.
- agent-browser ignores a `>> nth=` suffix on `fill`: target an inch field by its snapshot ref or a scoped locator.
