# Authoring parts

## What it is

An author generates and reviews options for a figure's bases (D36, D44). One edit draws the same option on up to
four bases, or two large bases, with 110 px of headroom. Each tile is cut out and reviewed separately. Approved
head-only parts also fill the other features' base; shoulder-length styles keep their own drawing. Fixed option
descriptions and an approved neutral-grey drawing as a second reference keep designs consistent across poses.
The Mirrored checkbox flips the figure and every part together without regenerating them.

## Routes and roles

- `/author/<storyId>`: page figures, their parts grids and generation/review controls.
- Only the story's author (operator or granted author) can edit a draft, generate or review its parts.
- Published versions are immutable. Start another version to generate parts.

## Seed data

- `operator@lifestory.dev` owns the sample stories and can start drafts.
- The parts e2e creates its own unpublished Moon Picnic copy and uses the fake image provider.

## Verify

`mise run verify -- e2e --ci -- parts authoring`

Drives generation through the worker, fetches review files with author-only access, approves a part into the
manifest, and generates four bases in one edit. Checks tile boundaries, shared generation, repeat requests and
approved-reference metadata. Unit checks in `mise run check` cover head-only sharing versus long hair and mirrored
layer placement. The authoring e2e checks the editor through publication and a personalized book. A hair part's
cut-out metrics include `crownGap`, the bald scalp it leaves above it; `part-cutout.test.ts` holds every hair part
of the sample stories under `CROWN_GAP_LIMIT` except the published ones it lists.

## Gotchas

- Generate missing parts sends a batch per figure, grouped by option, note and seed. A single request still uses
  the whole-base edit. Parts and their queued jobs are recorded in one transaction.
- Softer head-only cells use the defined features' drawing unless they already have their own. Draw its own
  requests a separate edit. Approval still happens on the source cell.
- An edit can copy only an already approved drawing. Approve a front part before generating its other poses.
- Inspect both skin extremes on the review sheet. The hairline transparency fix affects future cut-outs, not
  existing published assets; passing generation metrics do not establish clean edges on every skin palette.
- A `crownGap` above `CROWN_GAP_LIMIT` (9) means the model drew the hair smaller than the bald head: retake it with
  a note asking the hair to cover the scalp's whole outline. The editor doesn't show the metric yet; it is stored
  with the part. A hairline on the forehead, ears and translucent strands aren't counted.
