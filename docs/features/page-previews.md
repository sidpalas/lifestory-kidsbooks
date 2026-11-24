# Page previews

## What it is

Every on-screen page is `BookPage` at print size (8.5 in trim + bleed = 840 CSS px) scaled down by `ScaledPage`. A
preview shows at its view's scale (book editor 0.72, its page strip 0.14, story page 0.5, draft preview 0.55) or
smaller when its container is narrower, so on a phone each page shrinks to fit, keeps its shape, and overlaps nothing.
The page inside never reflows: screen and print keep the same line breaks.

## Routes and roles

- `/books/<bookId>`: the editor's page and, under it, the "All pages" strip of thumbnails that scrolls sideways,
  with Previous and Next above the page; owners and viewers of the family.
- `/stories/<slug>`: the story's pages with the chosen cast; any signed-in account. Laid out as the printed book's
  spreads: page 1 (the cover) alone in its row, then each even page facing the next (2–3 … 16–17), meeting at the
  gutter; on a phone the pages stack. `e2e -- stories` checks the cover's row and the pairing at desktop and phone.
- `/author/<storyId>`: the draft preview; the story's authors.

## Seed data

The sample stories. `verify layout` opens the family's first book of `--story`, making one (and a child and a grown-up
if nobody fits) when there is none. The author view needs a story with a draft page that the account authors; without
one the run says so and checks the other two.

## Verify

`mise run verify -- layout [--story the-kite-day] [--as operator@lifestory.dev]` at 320, 390, and 1280 px: each
preview shows the page's whole shape, stays on screen, overlaps no other, and the page doesn't scroll sideways.
A preview in a strip that scrolls sideways (the book editor's) needs to fit the strip, not the screen. Screenshots
per view and width. `e2e -- books` asserts the same for the book editor at 320 px, and that changing pages from the
strip moves neither the window nor the strip.

## Gotchas

- `ScaledPage` sizes its box with an svg of the page's aspect ratio (no minimum width, so grid cells shrink it) and
  measures that box with a ResizeObserver for the scale; don't give it a fixed width again.
- `verify proof` undoes the scaling to compare at full size; it knows `ScaledPage`'s structure.
