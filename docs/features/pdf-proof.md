# PDF proof

## What it is

"Make a PDF proof" on a story's preview or a book asks the worker (`proof.render`, D27) to print every page with
headless Chromium from a token-gated print page; the result is the print-ready file (D35): flattened 300 ppi art, live
text in the story's static fonts, TrimBox and BleedBox. Members download it; on a book an owner or parent approves it
for print (D32).

## Routes and roles

- `/stories/<slug>` (preview with chosen looks) and `/books/<id>` (a family's book): the "PDF proofs" section.
- Download: `/api/files/families/<familyId>/proofs/<proofId>.pdf`; any member of that family, 404 for others.
- Owner and parent make and approve proofs; a viewer downloads only.
- The worker opens `PRINT_APP_URL/print/proofs/<id>?token=…`; that origin must be the web app the run drives.

## Seed data

- Stories `the-moon-picnic` (placeholder SVG art, 6 pages) and `the-paper-boat` (watercolour, 3 pages), from
  `fixtures/stories`.

## Verify

`mise run verify -- proof [--story the-moon-picnic|the-paper-boat] [--config dev|image|live]`

Presses "Make a PDF proof" on the story preview, waits for the worker, downloads the PDF, then checks:

- **print-ready**: `checkPrintReady` against Lulu's requirements, one PDF page per book page.
- **pixels**: each editor page (full Chromium at 192 dpi with the preview's 0.5 scale undone) against the PDF page
  (`pdftoppm`), both downscaled to 96 dpi; fails above 10% of pixels off by more than 5%. Measured: 1.1–1.5% on
  the Moon Picnic, 3.1–4.8% on the painted Paper Boat (resampled edges).
- **line breaks** and **word positions**: each word's line and left edge in the editor DOM against `pdftotext
  -bbox`; fails above 0.5 pt. Measured 0.01 pt; without `geometricPrecision` (c9a06f1) it measures 5.11 pt and fails.

Evidence: `proof.pdf`, `print-ready.json`, `screen-<n>.png`, `pdf-<n>.png`, `diff-<n>.png` (red = differing).
It writes one proof row in the signed-in family (live: the agent family's; unapproved proofs expire in 30 days).

## Gotchas

- Drive in full Chromium, never Playwright's headless shell: the shell rounds words to whole pixels, so a comparison
  inside it can't see screen-versus-print drift. The CLI launches `channel: "chromium"`.
- Proofs fail if any live worker prints from an origin where nothing answers; `doctor` checks this first.
- Needs poppler (`pdftoppm`, `pdftotext`); `.agents/setup` installs it.
- Text drift shows in the word check, not the pixel check: shifted glyphs are a fraction of a page's pixels.
