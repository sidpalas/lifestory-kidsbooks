# Milestone 1 plan

How milestone 1 ([brief.md](brief.md#milestone-1-scope)) gets built on the Phase 1 foundation. Decisions referenced
as D*n* are in [decisions.md](decisions.md). This plan changes like decisions do: with evidence, and with Sid's approval.

## Repository layout

What exists after Phase 1, and what milestone 1 adds (marked *new*):

```
apps/
  web/                      TanStack Start app
    src/routes/             _app/ (signed-in shell)  _app/books/$bookId/edit (ssr: false)  print/proofs/$proofId (print-only)
    src/routes/api/         auth/$  files/$  webhooks/modal (new)
    src/components/book/    BookPage: the one page component for editor and print (new)
    src/server/             server functions grouped by area: families, characters, books, proofs (new)
    e2e/                    smoke.spec.ts, milestone1.spec.ts (new, walks the whole slice)
  worker/                   Absurd worker; also runs Playwright Chromium for PDF proofs (new)
packages/
  core/src/                 Effect services (Auth, Database, ObjectStorage, ImageProvider, Jobs)
    families/ characters/ stories/ books/ proofs/   domain modules (new)
    book-format/            Schema for the book format, v1 (new)
    looks/                  look vocabulary, recolour (gradient-map-v1), part stacking (new)
    tasks/                  render-proof (new); generate-part (variant tooling, D36)
    providers/modal.ts      Modal ImageProvider (new)
  db/                       Drizzle schema and migrations
modal/                      Python: FLUX 3 Image Klein function, `modal deploy` target (new)
fixtures/stories/moon-picnic/   sample story manifest and placeholder art, loaded by the seed (new)
```

Rules that keep it from sprawling: domain logic lives in `packages/core` as Effect code and is called from server
functions and tasks alike; `apps/web/src/server` only adapts requests to it. Browser code imports only
`@lifestory/core/contracts` (schemas, errors, the book format types).

## Book format (v1)

A story is authored once and personalized by many families, so the format separates **what the author made**
(immutable once published) from **what a family chose** (cast and text edits). It's JSON validated by an Effect
Schema in `packages/core/src/book-format`, stored as `story_version.manifest`, with assets in object storage
under `stories/<storyId>/v<n>/`. The manifest carries `formatVersion: 1`; readers reject versions they don't know,
and a later v2 gets a migration function from v1.

```jsonc
{
  "formatVersion": 2,                         // 2 since D29; stored format 1 versions are upgraded when read
  "trim": { "widthIn": 8.5, "heightIn": 8.5, "bleedIn": 0.125, "safeMarginIn": 0.5 },
  "fonts": [{ "family": "Literata", "asset": "fonts/literata-var.woff2" }],
  "characterSlots": [
    {
      "slotId": "hero",
      "label": "The child",
      "description": "A child about 5 years old, the main character",
      "ages": ["young-child", "older-child"],   // the one axis a story may restrict: the character ages it accepts (D29)
      "example": { "name": "Mia", "pronouns": "she/her",   // fills the slot in story previews
                   "look": { "age": "young-child", "face": "face:round", "skin": "skin:s4", "hair": "hair:curly",
                             "hairColour": "hair-colour:black", "glasses": "glasses:none" } }
    }
  ],
  "palettes": {                                 // a gradient map per skin tone and hair colour in the vocabulary
    "skin": { "skin:s4": [{ "at": 0, "colour": "#1e1612" }, { "at": 0.77, "colour": "#b07548" }, { "at": 1, "colour": "#fff8f2" }] },
    "hairColour": { "hair-colour:black": [{ "at": 0, "colour": "#120d0a" }, { "at": 0.35, "colour": "#2a1d17" }] }
  },
  "partOrder": ["hair", "glasses"],             // bottom to top, between the base face and the occluder
  "pages": [
    {
      "pageId": "p01",
      "layout": "full-bleed-art/text-bottom",   // a closed set of layouts the BookPage component knows
      "text": [{ "style": "body", "content": "{{hero.name}} packed the picnic basket." }],
      "illustration": {
        "layers": [
          { "kind": "art", "asset": "pages/p01/background.png" },                 // the illustrator's art, never edited
          { "kind": "figure", "slotId": "hero", "box": [430, 250, 760, 690],    // [x0, y0, x1, y1], thousandths of the art
            // "age": "toddler",                                                // optional: draw the role at this age here (D29)
            "bases": [                                                          // one per face type, at each age drawn (D26, D29)
              { "age": "young-child", "face": "face:round", "asset": "pages/p01/hero/base-child-1.svg",
                "skinMask": "pages/p01/hero/base-child-1-skin.svg",            // every visible bit of skin
                "browMask": "pages/p01/hero/base-child-1-brows.svg",           // takes the hair colour
                "occluder": { "asset": "...", "skinMask": "..." } }           // optional: a hand in front of the face
            ],
            "parts": [                                                          // every option, on every base
              { "age": "young-child", "face": "face:round", "axis": "hair", "option": "hair:curly", "asset": "pages/p01/hero/child-1-curly.svg",
                "at": [120, 0, 880, 420],                                       // a crop, in thousandths of the box
                "palette": "hairColour", "approved": true }
            ] },
          { "kind": "art", "asset": "pages/p01/foreground.png" }                  // e.g. table edge drawn over the character
        ]
      }
    }
  ]
}
```

The Schema in `packages/core/src/book-format/manifest.ts` is the authoritative format;
[D24](decisions.md#d24-book-format-v1-the-details-the-plans-example-left-open--made) lists where it refines this example.

- **Text** is a list of styled blocks with `{{slot.field}}` tokens (`name`, `they/them`-style pronoun fields).
  A family's edits replace a block's content per page; the original stays in the story version.
- **Illustrations are layered.** `art` layers are the illustrator's files. A `character` layer is filled from the
  role's approved variant parts (D26): base face, recoloured skin, hair and extras, stacked between plate and
  foreground with no AI at book time. Parents never edit art. "Composing pages" below has the details.
- **Nothing is author-specific.** Any user can own a story; slots, layouts, and fonts are declared in the manifest,
  so a community author's story uses the same format (and the same validation an upload would run later).

## Data model

Better Auth owns `user`, `session`, `account`, `verification`, `organization` (= family), `member` (role
`owner`/`parent`/`viewer`), and `invitation`. Milestone 1 adds (all IDs are text; timestamps omitted):

| Table | Owner | Key columns | Notes |
| --- | --- | --- | --- |
| `story` (exists) | author (`user`) | `author_id`, `slug`, `status` | Never owned by a family. |
| `story_version` | story | `story_id`, `version`, `manifest` jsonb, `published_at` | Immutable after publish. Books pin one. The manifest lists each role's options and parts with their review status; publishing requires every part to be approved (D26). |
| `character` | family | `family_id`, `name`, `pronouns`, `look` jsonb | A family member as drawn. `look` holds one option ID per axis (base face, skin tone, hairstyle, hair colour, glasses…) from the shared look vocabulary. No photos. |
| `book` | family | `family_id`, `story_version_id`, `title`, `status` | A family's personalized copy. |
| `book_cast` | book | `book_id`, `slot_id`, `character_id` | Which family member fills each slot. A book stores only this and text edits; pages are composed from them. |
| `book_text_edit` | book | `book_id`, `page_id`, `block_index`, `content` | Overrides; absent row = story text. |
| `generation` (exists) | any | `provider`, `external_id`, `request` jsonb, `status`, `event_name` | One row per provider job; the Modal callback looks it up. Used by authoring tooling only, never when a book is made. |
| `proof` (exists) | family | `family_id`, `story_version_id`, `content` jsonb, `status`, `task_id`, `object_key`, `page_count`, `bytes` | An immutable print-ready PDF and the cast and text edits it shows (D27), with `book_id` when made from a book and `approved_at`, `approved_by` once a parent approves it (D32). |

Access rules, enforced in `packages/core` (not in route code): every family-owned row is reached through
`family_id`, and a `FamilyAccess` service checks the caller's membership and role (`book:edit` for writes).
A user may belong to several families: the check uses the row's `family_id`, never only the session's active family,
which just picks the default family for lists and new books.
`/api/files/*` maps the object key prefix to its owner: `families/<id>/...` requires membership in that family,
`stories/...` requires the story to be published (or the caller to be its author).

## Image providers: assessment of hosted APIs

Since D26, image generation is authoring tooling and touches no user data, so hosted image APIs are allowed. The
assessment below ran on 2026-11-19 and chose OpenAI `gpt-image-2.6-sunburst` as the primary provider, with
self-hosted FLUX 3 Klein on Modal (D25) as the fallback (D30). Any hosted provider is one more `ImageProvider`
implementation next to `fake` and `modal`; the workflow doesn't change. The criteria and test set stay here so a
successor model (or another vendor) is measured the same way before it replaces the primary.

**What we need from a provider**, in order of weight:

1. **A clean part layer:** each part (a hairstyle, glasses, a beard) has to end up as a layer that holds only
   that part, because at book time it is stacked on the illustrator's base without AI (D26). Any one of three
   routes is enough:
   - an edit of the base crop that leaves everything outside the part unchanged, so we cut the part out by
     comparison with the base;
   - a masked edit that changes nothing outside its mask;
   - native transparent (RGBA) output of the part alone, drawn to fit the base.

   A provider that also redraws the face, hands or props on every edit fails this: the difference from the base
   then includes them, and there is no clean way to separate the part.
2. **Style fidelity** to the illustrator's references across many parts, with no drift in age or proportions.
3. **Consistency:** the same hairstyle from its turnaround sheet across poses and pages.
4. **Terms on inputs:** the illustrator's art is their IP, so we need no training on inputs, short retention, and
   output ownership compatible with publishing. Content filtering on the provider's side counts toward FLUX §2e only
   for FLUX models.
5. **Price and throughput** per accepted part. A story needs ~470 parts per base face (D26), generated once, so
   rejections cost more in illustrator time than per-image price does.

**Test set:** bald bases drawn once and given to every provider: baby, toddler, a 5-year-old, a standing child and
an adult (Klein-drawn), plus three children in other styles (gouache, pencil, collage; Painter-drawn). Parts: hair
(wisps, curls, pigtails, coily, braids, bob, spiky, ponytail), glasses and a beard, edited in place; braids from a
turnaround sheet on two poses; the same parts as masked edits and as transparent output where supported. Same prompt
everywhere ("keep exactly the same face … change nothing else"), one seed per hosted model. Scored automatically
(pixels changed outside the head zone; share of eye, nose and mouth pixels changed; mean colour shift) and by eye.

**Result (2026-11-19; full write-up, images and scripts in thread T-01a1f149-95e2-74f7-9818-59d430153d86):**

| Provider and model | Faces kept: Klein-drawn / other styles | US$ per part (measured) | Seconds | Terms on inputs |
| --- | --- | --- | --- | --- |
| **OpenAI `gpt-image-2.6-sunburst`** (primary) | 13/13 / 12/12 | 0.049 | ~18 | No training; 30-day abuse retention; customer owns output |
| OpenAI `gpt-image-2.6-flare` | 12/13 / 12/12 | 0.049 | ~9 | as above |
| OpenAI `gpt-image-2` | 9/13 / not run | 0.056 | ~27 | as above; shuts down 2027-02-10 |
| Gemini 3 Pro Image (OpenRouter) | 13/13 / 12/12 | 0.139 | ~17 | No training; Vertex keeps flagged prompts ≤ 90 days, AI Studio 55 days |
| Gemini Nano Banana 2.1 (OpenRouter) | 13/13 / ~11/12 | 0.038 | ~11 | as above; routed to AI Studio unless `zdr: true` |
| Gemini 3.1 Flash Image (OpenRouter) | 12/13 / ~11/12 | 0.068 | ~10 | as above |
| BFL FLUX 3 Klein | 12/13 / 4/12 | 0.009 | ~8 | Trains on inputs and outputs (API terms §2b) |
| BFL FLUX 3 Image | 11/13 / 2/12 | 0.048 | ~24 | as above |
| Klein on Modal (fallback) | 13/13 / 6/12 | ~0.014 warm | 22–37 | Own infrastructure |
| Qwen-Image-2.1 | not run (account not cleared for paid models) | 0.016 / 0.04 published | | No training without consent |

- Every FLUX model redrew faces outside FLUX's own style; the Klein-drawn set flattered them.
- Masked edits (BFL Fill, OpenAI) redrew the whole mask or returned artefacts, and transparent parts (OpenAI) didn't
  fit the head (0/4), so edit in place and cut out stays the route.
- Every provider needs the output aligned to the base (Klein shifted 2–6 px at one seed) and colour-matched to it
  outside the part zone (sunburst ~10/255 on the Klein-drawn bases; Gemini re-renders more, 16–18/255).
- Still to confirm: one real illustrator's base, since Painter may itself use an OpenAI model.

## Looks and the picker

Characters belong to the family, not to a story, so a look can't name one story's assets. `packages/core/src/looks`
defines a shared **look vocabulary**: the axes (age, face type, skin tone, hairstyle, hair colour, glasses, and later
beard, freckles) and stable option IDs for each, such as `young-child`, `face:oval`, `skin:s4`, `hair:long`. A story
role accepts some ages (D29) and supports every other option in the vocabulary at each of them, each backed by
approved parts (Sid, 2026-11-19): a fallback to another option would draw someone who doesn't look like the family member. Publishing
checks this (`vocabularyGaps`). An option added to the vocabulary later is missing from versions already published;
`unsupportedOptions` finds it, and the book then either disables that story for the character or keeps a
story-specific override with one of the story's supported options, which the parent picks.

- **Picker** (milestone 1, item 2): the parent picks the character's age first (D29), then starts from one of a few
  curated looks of that age (full option sets) and changes one axis at a time with a live preview: a story-independent portrait composed with the same
  pipeline as the pages (D28), each option shown as a thumbnail of the character with it. No photos and no matching
  from photos (D26).
- **Bases:** one per face type at each age a role accepts, each a separate illustrator-approved base with its own
  parts (D29). An age draws only the parts it has (`partAxesAt`: a baby has no hairstyle, a toddler no glasses). Skin
  tone and hair colour apply to every base.

## Composing pages

Nothing is generated when a book is made. A page is a stack the `BookPage` component draws, the same in the editor
and in print:

```
plate (art) → for each figure on the page, in z-order:
                base figure (skin, lips, brows recoloured) → face overlays → beard → glasses → hair
                → occluders (their skin recoloured too)
            → foreground (art) → text
```

- **Recolour** is a pure, version-pinned function (`gradient-map-v1`): a region mask from the illustrator plus a
  palette maps the base's neutral tones to the chosen skin or hair colour, keeping the line work and texture. The
  skin mask covers all visible skin of the figure, not only the face: neck, arms, hands, legs and feet, including
  hands in the occluder layer and skin a part reveals (a part is split by region, so its skin pixels take the same
  palette). A page that shows only a hand still recolours it. It runs
  on the server in `packages/core`, and its output is cached in object storage under a key hashed from (asset bytes,
  palette, algorithm version). The editor and the print route load the same URLs, so the PDF has exactly the pixels
  the parent saw, and a changed algorithm is a new story version, not a silent change to approved art.
- **Part placement:** each part is an RGBA crop with an offset inside its figure's box; the manifest's `slotOrder`
  sets z-order, and pair overrides replace a part for combinations that failed review (D26).
- **A change applies everywhere, right away:** pages read the character's current look and the book's cast, so
  editing a look recomposes every page that shows them, in every book of that family. There are no render rows to
  invalidate and no progress to track.
- **Proofs pin what was printed:** an approved proof is an immutable PDF, so later look changes don't alter it.
- **Milestone 1 assets:** the sample story ships placeholder bases, masks, palettes and a small set of parts, all
  marked approved, loaded by the seed from `fixtures/stories/moon-picnic/`. A second sample,
  `fixtures/stories/paper-boat/`, has textured raster art (watercolour) to test the recolour and print on it (D24).

## Authoring-time part generation

The variant tooling for illustrators wasn't in milestone 1 (brief, "Done means"). The pipeline below is built
(2026-11-19, D36) in `packages/core/src/parts` and `tasks/generate-part.ts`; the authoring screens that call it are
the Story authoring work.

```
requestPart(author, { storyVersionId, pageId, slotId, age, face, axis, option, zone, seed?, note? })
  → story_part row (ID from the request, so repeating it is the same part), spawn part.generate
part.generate(partId)
  step  prepare      → the base flattened at working size (B) and padded to the provider's 2:3 size
  step  edit:submit  → generation row, provider.submit(key = part:<partId>)   (generateImage)
  await event        generation.done:<generationId>          (OpenAI and the fake emit it themselves; Modal calls back)
  step  edit:record  → generation status, usage, cost
  step  cut-out      → align and colour-match to B, segment, matte against B, unmix, split by region → RGBA layers
  step  review-images→ the layers on the lightest and the darkest skin of the story's palettes, and a sheet
  step  record       → status pending_review
reviewPart(author, partId, approve | reject); approvedParts + withApprovedParts → the draft's manifest Parts
```

Turnaround sheets (one per hairstyle and base) will run the same way and be referenced by the part edits. The
illustrator reviews parts and pair sheets in the tooling; approving all of them is what lets the story version
publish.

- **The zone** (where the part may be, in thousandths of the base) comes with each request: D26's head zone, which
  the format doesn't carry. Long hair needs a taller zone than glasses; a part cut off at the zone's edge shows as
  `zoneEdgeContact` and as a red outline on the review sheet.
- **Suspending.** `generateImage(ctx, name, request)` submits in a step and `ctx.awaitEvent` suspends the run without
  holding a worker. Absurd events are first-emit-wins and cached, so each wait uses a unique name (the generation ID)
  and a late or duplicate callback is harmless. Steps are idempotent: object keys derive from domain IDs and the
  seed, and writes are upserts.
- **Providers.** `ImageProvider.submit(request) → { generationId }`, completed through the `generation.done` event.
  Modal (D25): the Python function (FLUX 3 Image Klein with its prompt upsampler) receives references as presigned
  GET URLs, uploads its output to a presigned PUT URL, and POSTs `/api/webhooks/modal` with an HMAC signature over
  the generation ID; the route verifies it and emits the event. OpenAI (D30, primary): the edit API is
  synchronous, so the submit step calls it, stores the output, and emits the event itself; the model ID is
  configuration. Fake: renders a deterministic placeholder, or with a reference image an edit of it (shifted a
  pixel, re-toned, with hair or glasses drawn on), uploads it, and emits the same event, so dev, CI and tests run the
  real suspend and resume path and the whole cut-out. If inbound callbacks prove unreliable, the fallback is polling the
  provider with `ctx.sleepFor` (D14).
- **Cutting parts out** (`parts/cutout.ts`, D36). The edit C and the base B give C = a·F + (1 − a)·B, so the part
  (colour F, alpha a) is found by known-background matting, not by thresholding the difference: thresholding lost
  thin glasses frames and baby wisps and kept a band of the old skin. Steps: align C to B (integer shift, ±6 px);
  colour-match it outside the zone (linear per channel); segment the part: pixels that changed and whose colour
  isn't within 2 px in B (line work the model moved by a pixel isn't new), kept as the part's large pieces and the
  small ones that touch them; estimate F nearby from the part's opaque interior; matte by projecting C − B onto
  F − B; unmix F; split off skin the model redrew (unmixed colour within 3σ of the base's skin, inside its skin
  mask) as a layer the skin palette recolours; turn hair into neutral tones for the hair palette. Then compose on
  the lightest and darkest skin for the illustrator's review. 2–8 s per part on an `a1.small` orb.
- **Running Modal for real:** `modal deploy modal/flux_klein.py`, then set `IMAGE_PROVIDER=modal`,
  `MODAL_ENDPOINT_URL`, `MODAL_CALLBACK_SECRET`, `PUBLIC_APP_URL` (for the callback), and `S3_PUBLIC_ENDPOINT` if
  storage isn't reachable from Modal at `S3_ENDPOINT`. The app needs no Modal token (D25). The README has the steps.

## Editor and print

- `BookPage` renders one page from (manifest page, resolved text, the cast's looks) in CSS physical units
  (`in`), at trim plus bleed, with fonts loaded from the story's assets. The editor route (`ssr: false`) scales it
  with a CSS transform and shows trim and safe-area guides; editing a text block saves a `book_text_edit` row.
  Viewers see the same page without editing controls.
- `print/proofs/$proofId` renders every page with `@page { size: <w+2·bleed>in <h+2·bleed>in; margin: 0 }`, for the
  worker only (a short-lived signed token, not a session), from what the proof recorded (D27).
- `proof.render(proofId)` task: Playwright Chromium on the worker opens the print route, waits for fonts and images,
  flattens each page's art to one opaque 300 ppi image under the live text, calls
  `page.pdf({ preferCSSPageSize: true, printBackground: true })`, sets TrimBox and BleedBox, checks the file against
  Lulu's interior requirements (D35), stores `families/<familyId>/proofs/<proofId>.pdf`, and records the page count.
  The proof is the print-ready file an order will send. The parent downloads it, checks it, and approves it (who and when, once); an approved
  proof is kept with the family, and an unapproved one is deleted after 30 days (D32).
- The e2e tests check the PDF's page count, page size and font, and who may download it (`proofs.spec.ts`), and
  `milestone1.spec.ts` walks the whole slice from the invitation to the downloaded, approved proof.

## Invites and families

Every account has a family (D3). Accounts are created in two ways, and no user is left without a family:

- **Invite a new family (operator).** The operator enters a name and email. Inviting creates the account and a
  one-person family named "<name>'s family" (renamable) with the new user as `owner`, using Better Auth's
  `createOrganization` with `userId` (a server-side system action; no session needed), and it is the active family
  when they sign in. The account and family are created when the operator invites, and the invitee sets
  a password from a single-use emailed link (D23). Public sign-ups later reuse the
  same account-plus-family path.
- **Invite a member into a family.** Better Auth's organization invitation creates the `invitation` row and emails
  a link (in dev the email is logged and shown in a dev-only mailbox page). Because public sign-up is disabled (D3),
  the accept page calls a server function that verifies the pending invitation for that email, creates the account
  with Better Auth's internal adapter if there is none (as `ensureDevUser` does today), and adds the membership.
  The invitee gets no family of their own; they can create one later (`allowUserToCreateOrganization`).
- Invite with a view-only role: the inviter picks `parent` or `viewer`; `viewer` can open books and proofs only.
- An existing user can accept invitations into other families, so a user can be in several. Accepting makes that
  family active; a family switcher sets `activeOrganizationId`, and pages show the active family's characters and books.

## How "Coming later" fits

None of this is built in milestone 1; these are the seams that keep it from needing a rewrite.

- **Payments and print ordering (e.g. Lulu).** An `order` will reference an approved `proof` (an immutable PDF with
  known trim and page count, which is what print APIs take) and the `book`. A `PrintProvider` service, like
  `ImageProvider`, wraps the vendor; order fulfilment is an Absurd workflow that suspends on payment and vendor
  webhooks, received by server routes like the Modal callback.
- **Public marketplace with ranking.** `story` is already author-owned with a `status`; a public catalogue lists
  published stories. Ratings and reviews attach to `story` (by families who made a book from it), and ranking is a
  query or a periodic Absurd task writing a score.
- **Community authoring with revenue share.** Any user can own a `story`; `story_version` makes published content
  immutable, so a sale can name exactly which version (and author) it paid for. A royalty ledger keyed by order line
  and author comes with payments. Authors upload assets through the same storage service; the manifest Schema is
  the validator for uploads. Author and illustrator groups (studios) will be a second kind of Better Auth
  organization: a `kind` column (`family` / `studio`) on `organization`, studio roles beside the family roles, and
  an optional studio owner on `story`. Since a user can be in several organizations, family lists, the active
  family, and `FamilyAccess` will then filter to `kind = family`; until then every organization is a family.
- **Moderation.** `story_version` gains a review state (`submitted` → `approved`) gating publication, plus a
  `report` table; the operator's admin role gets moderation permissions (still without impersonation).
- **Public sign-ups.** Flip `disableSignUp` off and keep invitation acceptance as is; nothing else assumes
  every user was invited (families are created by their first member, not by the operator).
- **Server-rendered catalogue pages for search engines.** Catalogue routes keep TanStack Start's SSR on (only the
  editor turns it off) and read published stories only, with no session required.

## Delivery

Pull requests (or reviewed local branches, as Sid prefers) in this order, each with its tests. All seven are done
(2026-11-19).

1. Book format Schema, `story_version`, seeded sample story with placeholder art, `BookPage` and the print route.
2. Families and invites (sign up by invite, roles, viewer read-only), family-scoped file access.
3. Characters and the look picker: the look vocabulary, curated looks, one feature at a time, live preview.
4. Personalization: cast slots, recolour and its cache, pages composed from approved parts, a look change shown on
   every page.
5. Editor text editing; PDF proof task, download, and approval (D32, with how long proofs are kept).
6. Modal provider and Python function, callback route, README instructions (done, D25); the hosted image API
   assessment (done, D30).
7. `milestone1.spec.ts` walking the whole slice in CI; Dockerfiles for web and worker (no host-specific config);
   the `operator:create` command (D21), and the `story:import` command that publishes a story in production (D33);
   the development seed never runs there.

Open needs found on the first production deploy (2026-11-19):

- **Getting a story into production.** Done: `story-import.ts`, run once over `railway ssh` (D33). An authenticated
  upload endpoint waits for the author tooling.
- **Agent access to production.** An agent verifying a deploy can't sign in, so live checks behind a session (story
  preview, worker jobs, proofs) need a person. Options: an ordinary "agent" family the operator invites, with its
  password kept as an Amp secret (no new API surface), or an API key (for example Better Auth's apiKey plugin),
  which is more capable but adds a way to authenticate on an app holding children's data.
