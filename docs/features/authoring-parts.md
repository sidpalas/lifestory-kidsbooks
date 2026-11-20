# Authoring parts

## What it is

An author generates and reviews options for a figure's bases (D36, D44). One edit draws the same option on up to
four bases, or two large bases, with 110 px of headroom. Each tile is cut out and reviewed separately. Approved
head-only parts also fill the other features' base; shoulder-length styles keep their own drawing. Fixed option
descriptions and an approved neutral-grey drawing as a second reference keep designs consistent across poses.
The Mirrored checkbox flips the figure and every part together without regenerating them.

The Review tab groups each option across pages and bases, on light/dark skin. It can plan missing parts from
existing bases and queue up to 40 per explicit round (roughly US$1.96 before tiling savings; estimates, not a
provider billing limit). Generated candidates can be flagged with a reason and redone; a replacement retains the
previous flag and requires fresh approval. Actual-page review opens the selected take, even if an older take
was approved. Uploaded options can also be reviewed and approved on sheets; replacing them remains in Pages.

## Routes and roles

- `/author/<storyId>`: page figures, their parts grids and generation/review controls.
- Only the story's author (operator or granted author) can edit a draft, generate or review its parts.
- Published versions are immutable. Start another version to generate parts.

## Seed data

- `operator@lifestory.dev` owns the sample stories and can start drafts.
- The parts e2e creates its own unpublished Moon Picnic copy and uses the fake image provider.

## Verify

`mise run verify -- e2e --ci -- parts authoring art-import`

Drives generation through the worker, fetches review files with author-only access, approves a part into the
manifest, and generates four bases in one edit. Checks tile boundaries, shared generation, repeat requests and
approved-reference metadata. Unit checks in `mise run check` cover head-only sharing versus long hair and mirrored
layer placement. The authoring e2e checks the editor through publication and a personalized book. A hair part's
cut-out metrics include `crownGap`, the bald scalp it leaves above it; `part-cutout.test.ts` holds every hair part
of the sample stories under `CROWN_GAP_LIMIT` except the published ones it lists, and every raster one with nothing
left for `coverOutline` to cover. The art-import e2e checks option-sheet generation, flag persistence through reload, a fresh unapproved redo,
actual-page composition and explicit bulk approval.

## Gotchas

- Generate missing parts sends a batch per figure, grouped by option, note and seed. A single request still uses
  the whole-base edit. Parts and their queued jobs are recorded in one transaction.
- Softer head-only cells use the defined features' drawing unless they already have their own. Draw its own
  requests a separate edit. Approval still happens on the source cell.
- An edit can copy only an already approved drawing. Approve a front part before generating its other poses.
- Inspect both skin extremes on the review sheet. The hairline transparency fix affects future cut-outs, not
  existing published assets; passing generation metrics do not establish clean edges on every skin palette.
- Bald scalp beside hair has two causes. A `crownGap` above `CROWN_GAP_LIMIT` (9) means the model drew the hair
  smaller than the bald head: retake it with a note asking the hair to cover the scalp's whole outline. The editor
  doesn't show the metric yet; it is stored with the part. A hairline, ears and translucent strands aren't counted.
  The other cause, hair stopping at the head's pencil outline (as dark as the hair, so the matte can't see it), the
  cut-out fixes itself with `coverOutline` and records `outlineCovered`. It measures the outline's width on the base
  (a thick ink line, as the picker's portraits draw, shows as dark notches and flecks under a light hair colour),
  extends only solid hair (not stubble dots), and takes the silhouette from the base's alpha, or from the paper
  around it when the base has none (`figureCoverage`).
- Scrolling never approves artwork. Bulk approval includes only pending candidates whose two review images loaded
  and whose card entered the viewport in this sheet session; a fresh take has a fresh identity. This is a guard
  against unseen work, not evidence that a person inspected it. The illustrator still explicitly approves.
- Automatic paid retries, critic triage, dedicated base/palette sheets and additions orchestration are not included.
