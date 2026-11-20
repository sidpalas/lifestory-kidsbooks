# Authoring casting

## What it is

Casting comes before extraction: upload flat page pictures in reading order, get proposed roles, figure and head
boxes, and correct them on the art. Drag/resize boxes, assign roles, add missed people and ignore background people;
exact coordinates stay in Details. Corrections survive switching tabs and can be saved with the draft.

The illustrator approves casting before extraction, then separately reviews the original alongside light/dark
reconstructed pages, the shared plate and skin masks before accepting the bases. One removal edit serves the whole
cast on a page, so accepting another figure cannot restore a previously removed person. Imported hair remains
unapproved until its own option review (D26). Existing manual PSD/flat import remains in Pages.

## Routes and roles

- `/author/<storyId>`, Casting tab: only the story's author can edit its unpublished draft.
- Casting metadata is authoring-only, revision-locked alongside the draft, not part of the published book format.
- No family data is sent to models. Suggestions see uploaded story art and story-role descriptions only.

## Seed data

- `operator@lifestory.dev` can start a story and add roles before uploading page pictures.
- The casting e2e creates its own two-role story and a synthetic page with two separated people.

## Verify

`mise run verify -- e2e --ci -- art-import`

Checks saved character corrections, tab switching, approval invalidation after editing, the separate extraction
approval gate, two extracted figures sharing one plate, and pixels proving neither person remains on that plate.
It also checks EXIF orientation normalization, add/ignore, overlapping-box rejection, and transparent reconstruction.
The same spec exercises the existing PSD/flat import and the option-sheet redo loop.

## Gotchas

- `CASTING_PROVIDER=fake` is the default: labelled sample boxes, not image analysis. Set `CASTING_PROVIDER=openai`
  and `OPENAI_API_KEY` for vision suggestions; `OPENAI_CASTING_MODEL` defaults to `gpt-6.2-sol`. Image edits use
  `IMAGE_PROVIDER` independently. Both live on the worker's process-wide runtime.
- Every worker on the database takes tasks, including a preview `worker` service running real providers: stop it
  (`amp orb service stop worker`) before the e2e, or the e2e's imports and extractions become billed edits.
- Every explicit extraction shows a rough estimate before starting. No automatic paid retries are performed.
- Approving boxes does not approve generated pixels. Correcting casting clears its pending extraction review;
  previously accepted bases stay in the draft until replaced deliberately.
- Suggestions and extractions run per page and in parallel; only the page with a running job locks, and it shows
  its elapsed time. "Suggest characters on N new pages" starts every page that has never had a suggestion; suggesting
  again stays per page because it replaces corrections. Every save from the tab goes through one queue that applies
  its change to the latest state, so jobs finishing together don't fail the draft's revision check.
- Move earlier / Move later reorder the source pictures and their book pages together; book pages without a
  picture keep their positions.
- Solid boxes are figures, dashed boxes are heads (including hair). A head box moves with its figure and stays
  inside it; "Edit head boxes" turns on moving and resizing them.
- Background work can be resumed after returning to the draft. PSD semantic-layer detection, automatic full
  base-matrix derivation and foreground/overlap reconstruction are not automatic: inspect carefully and use manual
  layered import for difficult occlusion. Each selected role can occur once on a page in this slice.
- The existing skin detector can confuse warm clothing with skin: the synthetic red-shirt fixture exposes this.
  Inspect the mask and both reconstructed skin extremes; use manual assets rather than accepting an incorrect mask.
