# Milestone 1 plan

How milestone 1 ([brief.md](brief.md#milestone-1-scope)) gets built on the Phase 1 foundation. Decisions referenced
as D*n* are in [decisions.md](decisions.md). This plan changes like decisions do: with evidence, and with Sid's approval.

## Repository layout

What exists after Phase 1, and what milestone 1 adds (marked *new*):

```
apps/
  web/                      TanStack Start app
    src/routes/             _app/ (signed-in shell)  _app/books/$bookId/edit (ssr: false)  print/books/$bookId (print-only)
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
    tasks/                  render-proof (new); part-generation tasks come with the variant tooling (later)
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
  "formatVersion": 1,
  "trim": { "widthIn": 8.5, "heightIn": 8.5, "bleedIn": 0.125, "safeMarginIn": 0.375 },
  "fonts": [{ "family": "Literata", "asset": "fonts/literata-var.woff2" }],
  "characterSlots": [
    {
      "slotId": "hero",
      "label": "The child",
      "description": "A child about 5 years old, the main character",
      "pronounSet": "from-character",           // text tokens resolve from the chosen character
      "defaults": { "hair": "short brown", "glasses": false }
    },
    { "slotId": "grownup", "label": "A grown-up", "description": "A parent or grandparent", "defaults": {} }
  ],
  "pages": [
    {
      "pageId": "p01",
      "layout": "full-bleed-art/text-bottom",   // a closed set of layouts the BookPage component knows
      "text": [{ "style": "body", "content": "{{hero.name}} packed the picnic basket." }],
      "illustration": {
        "layers": [
          { "kind": "art", "asset": "pages/p01/background.png" },                 // the illustrator's art, never edited
          { "kind": "character", "slotId": "hero", "box": [420, 120, 940, 480],  // FLUX bbox grid: [y0, x0, y1, x1] of 0..1000
            "direction": "kneeling, holding a basket, smiling, side view" },
          { "kind": "art", "asset": "pages/p01/foreground.png" }                  // e.g. table edge drawn over the character
        ]
      }
    }
  ]
}
```

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
| `proof` | book | `book_id`, `status`, `object_key`, `page_count`, `approved_at`, `approved_by` | An immutable print-ready PDF. |

Access rules, enforced in `packages/core` (not in route code): every family-owned row is reached through
`family_id`, and a `FamilyAccess` service checks the caller's membership and role (`book:edit` for writes).
A user may belong to several families: the check uses the row's `family_id`, never only the session's active family,
which just picks the default family for lists and new books.
`/api/files/*` maps the object key prefix to its owner: `families/<id>/...` requires membership in that family,
`stories/...` requires the story to be published (or the caller to be its author).

## Image providers: assessment of hosted APIs

Since D26, image generation is authoring tooling and touches no user data, so hosted image APIs are allowed, and
they will likely replace self-hosted FLUX 3 Klein on Modal (D25) as the primary provider. Klein stays as the
fallback and as the baseline every API is measured against. Any hosted provider is one more `ImageProvider`
implementation next to `fake` and `modal`; the workflow doesn't change. Nothing below has been run yet.

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

**Candidates** (prices and features as published, not verified by us):

| Provider | Why it's a candidate | Known so far |
| --- | --- | --- |
| BFL API: FLUX 3 Klein and the larger FLUX 3 models | Same family as our baseline; the bigger models may hold style better | Klein is served as the same distilled checkpoint |
| OpenAI `gpt-image-2` | Strong instruction following; markup-guided edits | Transparent backgrounds; ~$0.006 / $0.053 / $0.211 per 1024² image at low / medium / high |
| Qwen-Image-2.1 API (Turbo, Pro) | Native RGBA generation and editing, masked local edits, up to 10 references | ~$0.016 (Turbo) / $0.04 (Pro) per image; open weights are research-only |
| Self-hosted Klein on Modal (baseline) | Already deployed | ~$0.014 per warm 1 MP image, ~45 s cold start (D25) |

**Assessment:** run the same set through each provider with the same base, references and prompts: four
hairstyles, glasses and a beard on the bald sitting base; one hairstyle on two poses from its turnaround sheet; and
the same parts as masked edits and as transparent output where supported. Score each output on whether it gives a
clean part layer (automatic: pixels outside the head zone or mask unchanged, or for transparent output, no face or
background pixels in the layer and a correct fit on the base), halo and holes at print size, style match and age
drift (Sid or the illustrator, blind), and
cost and time per accepted part. Record the provider terms checked. The result becomes a decision naming the
primary provider.

## Looks and the picker

Characters belong to the family, not to a story, so a look can't name one story's assets. `packages/core/src/looks`
defines a shared **look vocabulary**: the axes (base face, skin tone, hairstyle, hair colour, glasses, and later
beard, freckles) and stable option IDs for each, such as `face:child-2`, `skin:s4`, `hair:braids-2`. A story role
declares which options it supports, each backed by approved parts. When a character's option isn't supported by a
role (an adult face cast as the child, a hairstyle the story lacks), the role's default for that axis is used and the
editor says so next to the slot.

- **Picker** (milestone 1, item 2): a character starts from one of a few curated looks (full option sets), then the
  parent changes one axis at a time with a live preview: the role's portrait figure (the sample story's cover in
  milestone 1) composed with the same parts and recolour as the pages. No photos and no matching from photos (D26).
- **Base faces:** a handful per role, covering age, gender and facial structure, each a separate illustrator-drawn
  base with its own parts. Skin tone and hair colour apply to every base.

## Composing pages

Nothing is generated when a book is made. A page is a stack the `BookPage` component draws, the same in the editor
and in print:

```
plate (art) → for each figure on the page, in z-order:
                base face (skin, lips, brows recoloured) → face overlays → beard → glasses → hair → occluders
            → foreground (art) → text
```

- **Recolour** is a pure, version-pinned function (`gradient-map-v1`): a region mask from the illustrator plus a
  palette maps the base's neutral tones to the chosen skin or hair colour, keeping the line work and texture. It runs
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
  marked approved, loaded by the seed from `fixtures/stories/moon-picnic/`.

## Authoring-time part generation (later milestone)

The variant tooling for illustrators is not in milestone 1 (brief, "Done means"); this is the shape it will take, on
the foundation that exists now.

```
generate-part(storyVersionDraftId, appearanceId, axis, optionId, seed)
  step  submit       → generation row, provider.submit(key = part:<appearance>:<axis>:<option>:<seed>)
  await event        generation.done:<generationId>          (provider callback, or the fake provider)
  step  cut out      → compare with the base inside the head zone, split by region, store RGBA crops
  step  record       → part status = generated, waiting for review
```

Turnaround sheets (one per hairstyle and base) run the same way and are referenced by the part edits. The
illustrator reviews parts and pair sheets in the tooling; approving all of them is what lets the story version
publish.

- **Suspending.** `generateImage(ctx, name, request)` submits in a step and `ctx.awaitEvent` suspends the run without
  holding a worker. Absurd events are first-emit-wins and cached, so each wait uses a unique name (the generation ID)
  and a late or duplicate callback is harmless. Steps are idempotent: object keys derive from domain IDs and the
  seed, and writes are upserts.
- **Providers.** `ImageProvider.submit(request) → { generationId }`, completed through the `generation.done` event.
  Modal (D25): the Python function (FLUX 3 Image Klein with its prompt upsampler) receives references as presigned
  GET URLs, uploads its output to a presigned PUT URL, and POSTs `/api/webhooks/modal` with an HMAC signature over
  the generation ID; the route verifies it and emits the event. Fake: renders a deterministic placeholder, uploads
  it, and emits the same event, so dev, CI and tests run the real suspend and resume path. Hosted APIs are added as
  more implementations after the assessment above. If inbound callbacks prove unreliable, the fallback is polling the
  provider with `ctx.sleepFor` (D14).
- **Running Modal for real:** `modal deploy modal/flux_klein.py`, then set `IMAGE_PROVIDER=modal`,
  `MODAL_ENDPOINT_URL`, `MODAL_CALLBACK_SECRET`, `PUBLIC_APP_URL` (for the callback), and `S3_PUBLIC_ENDPOINT` if
  storage isn't reachable from Modal at `S3_ENDPOINT`. The app needs no Modal token (D25). The README has the steps.

## Editor and print

- `BookPage` renders one page from (manifest page, resolved text, the cast's looks) in CSS physical units
  (`in`), at trim plus bleed, with fonts loaded from the story's assets. The editor route (`ssr: false`) scales it
  with a CSS transform and shows trim and safe-area guides; editing a text block saves a `book_text_edit` row.
  Viewers see the same page without editing controls.
- `print/books/$bookId` renders every page with `@page { size: <w+2·bleed>in <h+2·bleed>in; margin: 0 }`, for the
  worker only (a short-lived signed token, not a session).
- `render-proof(bookId)` task: Playwright Chromium on the worker opens the print route, waits for fonts and images,
  calls `page.pdf({ preferCSSPageSize: true, printBackground: true })`, stores `proofs/<bookId>/<proofId>.pdf`, and
  records the page count. The parent downloads it, checks it, and approves it; an approved proof is immutable.
- The e2e test checks the PDF's page count and page size and renders page 1 to an image for the report.

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

Pull requests (or reviewed local branches, as Sid prefers) in this order, each with its tests:

1. Book format Schema, `story_version`, seeded sample story with placeholder art, `BookPage` and the print route.
2. Families and invites (sign up by invite, roles, viewer read-only), family-scoped file access.
3. Characters and the look picker: the look vocabulary, curated looks, one feature at a time, live preview.
4. Personalization: cast slots, recolour and its cache, pages composed from approved parts, a look change shown on
   every page.
5. Editor text editing; PDF proof task, download, and approval.
6. Modal provider and Python function, callback route, README instructions (done, D25); the hosted image API
   assessment.
7. `milestone1.spec.ts` walking the whole slice in CI; Dockerfiles for web and worker (no host-specific config);
   the `operator:create` command (D21), with production loading the sample story under the real operator
   instead of running the development seed.
