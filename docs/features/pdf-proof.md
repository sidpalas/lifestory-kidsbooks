# PDF proof

## What it is

"Make a PDF proof" on a family's book asks the worker (`proof.render`, D27) to print every page with
headless Chromium from a token-gated print page; the result is the print-ready file (D35): flattened 300 ppi art, live
text in the story's static fonts, TrimBox and BleedBox. Members download it; on a book an owner or parent approves it
for print, or deletes any proof after confirming, an approved one with a stronger warning (D32).

## Routes and roles

- `/books/<id>` (a family's book): the "PDF proofs" section, below the wrapping page-selector grid (three columns
  on desktop, two on narrow screens). Story previews have no proof panel: make a book first.
- Download: `/api/files/families/<familyId>/proofs/<proofId>.pdf`; any member of that family, 404 for others.
- Owner and parent make, approve, and delete proofs; a viewer downloads only. A deleted proof's download is 404.
- The worker opens `PRINT_APP_URL/print/proofs/<id>?token=…`; that origin must be the web app the run drives.

## Seed data

- Stories `the-moon-picnic` (placeholder SVG art, 6 pages) and `the-paper-boat` (watercolour, 3 pages), from
  `fixtures/stories`.

## Verify

`mise run verify -- proof [--story the-moon-picnic|the-paper-boat] [--config dev|image|live]`

Opens an existing book of the story, or makes one from the preview's chosen family members, then presses
"Make a PDF proof", waits for the worker, downloads the PDF, and checks:

- **print-ready**: `checkPrintReady` against Lulu's requirements, one PDF page per book page.
- **pixels**: each editor page (full Chromium at 192 dpi with thumbnail scaling undone) against the PDF page
  (`pdftoppm`), both downscaled to 96 dpi; fails above 10% of pixels off by more than 5%. Measured: 1.1–1.5% on
  the Moon Picnic, 3.1–4.8% on the painted Paper Boat (resampled edges).
- **line breaks** and **word positions**: each word's line and left edge in the editor DOM against `pdftotext
  -bbox`; fails above 0.5 pt. Measured 0.01 pt; without `geometricPrecision` (c9a06f1) it measures 5.11 pt and fails.

- **delete**: deletes the proof with its Delete button (confirming), then checks it's no longer listed and its
  download is 404.

Evidence: `proof.pdf`, `print-ready.json`, `screen-<n>.png`, `pdf-<n>.png`, `diff-<n>.png` (red = differing).
It deletes the proof it made, and leaves a book, if it made one, in the signed-in family (live: the agent family's); a
run that stops early leaves its proof, which expires in 30 days. The family needs a character of each role's accepted age to make a book.

## Gotchas

- Drive in full Chromium, never Playwright's headless shell: the shell rounds words to whole pixels, so a comparison
  inside it can't see screen-versus-print drift. The CLI launches `channel: "chromium"`.
- Proofs fail if any live worker prints from an origin where nothing answers; `doctor` checks this first.
- Needs poppler (`pdftoppm`, `pdftotext`); `.agents/setup` installs it.
- Text drift shows in the word check, not the pixel check: shifted glyphs are a fraction of a page's pixels.
