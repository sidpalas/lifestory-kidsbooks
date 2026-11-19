# Decisions

The source of truth for how this codebase is built, together with [brief.md](brief.md). Each decision lists
its reason and what would reopen it. A decision changes only when new evidence turns up: whoever finds it
reports the evidence and a proposal, Sid decides, and the change is recorded here with the date.

Status: **Decided** (by Sid, in the brief or in a thread), **Recommended** (the brief's recommended design,
adopted), or **Made** (chosen during implementation, Sid can veto).

## Product and platform

### D1. TypeScript throughout, except the image model — Decided
- **Why:** one language for web, server, worker, and shared domain code; the image model runs Python on Modal.
- **Reopen if:** never expected.

### D2. React, Tailwind, shadcn/ui — Decided
- **Why:** brief. shadcn components are copied into `apps/web/src/components/ui` (style `new-york`, `components.json`).
- **Reopen if:** never expected.

### D3. Better Auth; a family is an organization; operator via the admin plugin without impersonation — Decided
- **Why:** brief. Accounts hold photos of children, so nobody, the operator included, may sign in as someone else.
- **How:** family roles `owner`, `parent` (edit books), `viewer` (read only), defined in `packages/core/src/auth.ts`
  with an extra `book: [read, edit]` statement. The operator role (`admin`) is a custom admin-plugin role whose
  permissions omit `impersonate` and `impersonate-admins`; the smoke test asserts the impersonation endpoint
  returns 403 for the operator. `emailAndPassword.disableSignUp` is on: accounts come only from invitations, the
  operator command (D21), or the development seed.
- **Every account has a family (Sid, 2026-11-18):** an account that isn't joining an existing family gets a
  one-person family, with that user as `owner`, when the account is created. There is no separate "create a
  family" step, and the UI says little about families until someone invites a second member. Rejected: families
  that users create themselves, which leaves a user with no family that every page must handle; and characters
  and books owned by the user with families added later, which still needs sharing for the view-only member and
  later moves ownership of every character, book, and stored file.
- **Several families per user:** a user can belong to any number of families, each with its own role (for example
  a grandparent who views two children's families). Better Auth 1.7.25 allows it by default (`organizationLimit`
  is unset), and the session's `activeOrganizationId` picks the current family.
- **Reopen if:** Better Auth drops organization roles or custom admin access control.

### D21. The production operator account comes from a one-off CLI command — Decided (Sid, 2026-11-18)
- **Why:** the operator is the one account no invitation can create. A first-sign-in-becomes-admin rule would
  open sign-up on an empty database, so anyone reaching a fresh (or wiped) deploy first would own an app holding
  children's photos. Seeding from environment variables would keep a password in the host's variables and
  re-run admin-granting code on every boot.
- **How:** `node packages/core/src/operator-create.ts --email <email> [--name <name>]`, run once inside the deployed
  web container (any host's one-off run or shell, for example `railway ssh`; nothing host-specific). Production
  images have no mise, so the command is a plain Node entry point like `migrate.ts`; `mise run operator:create --
  --email <email>` wraps it locally. It reads the password from a prompt, never from the environment
  or arguments, creates the user with role `admin` (or promotes an existing user), and creates their one-person
  family through the same account-plus-family path as the operator's new-family invite (plan.md, "Invites and
  families"). Running it again changes nothing, and deploys never run it. The development seed
  (`mise run db:seed`, with its published password) never runs against production.
- **Reopen if:** a second operator or an automated environment needs operators without shell access.

### D23. A newly invited family sets its password from a single-use emailed link — Made (2026-11-18)
- **How:** the operator's "Invite a new family" creates the account (no password yet) and its one-person family
  right away, through the same `createAccountWithFamily` path as `operator:create` (D21), and emails a link to
  `/set-password/<token>`. The token is a Better Auth `reset-password:` verification value valid for 7 days, so
  Better Auth's own `/reset-password` endpoint sets the password and consumes it; the page then signs the user in.
  Inviting the same email again before a password is set sends a fresh link; after that it is refused.
- **Why:** of the two options in plan.md, this reuses Better Auth's token storage, expiry, single use, and password
  hashing instead of a token table and accept page of our own. Creating the family at invite time also means the
  family exists (and can be renamed or pre-filled later) before the invitee arrives, and every account is created by
  one function. The other option, an invite token our accept page checks before creating the account and family,
  needs a "pending family" record Better Auth has no model for (its invitations belong to an existing organization).
- **Email:** there is no delivery provider yet. A `Mailer` service logs every email and keeps the last 50 in memory
  for the dev-only `/__dev/mailbox`. Until a provider is added, the operator copies the link from the web server's
  log in production. Adding one means a second `Mailer` layer; nothing else changes.
- **Member invitations** use Better Auth's organization invitations (`/invitations/<id>`, also 7 days). Someone
  without an account creates one there with their name and password and joins only that family; someone with an
  account signs in and accepts. Opening the emailed link is what proves the email.
- **Reopen if:** we add a delivery provider that offers magic links, invitees often miss the 7-day window, or we
  need invitations that don't create an account until accepted (for example to keep unaccepted invites out of user lists).

### D4. Absurd for jobs and durable workflows on Postgres; every step idempotent — Decided
- **Why:** brief. Postgres is the only moving part; workflows can suspend for days (preview approval).
- **How:** Absurd 0.5.1's SQL is vendored verbatim as a Drizzle custom migration, so `mise run db:migrate` is the only
  schema tool. The `Jobs` service and `step()` helper in `packages/core/src/jobs.ts` are the only places that touch
  the SDK, so tasks are Effect programs.
- **Production readiness (reviewed 2026-11-18):** the SDK README still says "early experiment", and it is at 0.5.x.
  Sid pointed to [Absurd In Production](https://lucumr.pocoo.org/2026/4/4/absurd-in-production/) (April 2026):
  Earendil runs it in production; releases since hardened claim handling, leases, watchdogs, deadlocks, and event
  races; the core model didn't change; the TypeScript SDK is ~1,400 lines. That settles it. Known gaps from the
  same post that matter here: no built-in scheduler (use idempotency keys), no push/webhook wake-up (our Modal
  callback route emits the event itself, as planned), and no partitioning, so cleanup of old task data is a
  periodic delete we'll add when volume needs it.
- **Reopen if:** a correctness bug in claiming, retries, or events shows up in our usage, or the project is abandoned.

### D5. Image generation: FLUX 3 Image Klein on Modal — Decided
- **Why:** brief. Checked 2026-11-18: released 2026-10-15, 5.6B parameters, open weights, image editing and
  multi-reference generation with up to 10 references, bounding boxes for placement (useful for character slots).
- **License:** FLUX Kommunity License. Non-commercial use, plus commercial output for organizations under
  US$5M gross annual revenue. Above that, a commercial license from Black Forest Labs is needed.
- **Sid, 2026-11-18:** revenue is not expected to exceed the threshold; revisit only if it approaches it.
- **License conditions on that exception (§2e), Sid 2026-11-18:** outputs must pass content filtering (or a review)
  before anyone sees them, and carry an AI disclosure where the law requires one. The Modal function runs the
  classifier BFL's reference code ships (`Falconsai/nsfw_image_detection`) on every image and fails the generation
  when it scores ≥ 0.5 as NSFW, so a flagged image is never uploaded. Still open for the product: the §4 limits on
  rights of publicity and "digital replica" rights (consent from the people in uploaded photos) and the AI disclosure.
- **Sid, 2026-11-18 (with D26):** image generation is now authoring tooling only, and hosted image APIs will likely
  become the primary provider, with this Modal function as the fallback. plan.md's "Image providers" section holds
  the assessment; the choice gets its own decision.
- **Reopen if:** revenue approaches the license threshold, or quality on children's-book character consistency is poor.

### D24. Book format v1: the details the plan's example left open — Made
- **Where:** `packages/core/src/book-format` (Effect Schema, browser-safe through `@lifestory/core/contracts`) is the
  format; `story_version.manifest` stores it; `fixtures/stories/moon-picnic` is the sample. The plan's example is
  refined in these ways:
  - **`textStyles`** (`title`, `body`: font family, size in points, line height, weight, alignment) are declared
    per story, so a community author picks their own type; each family must be in `fonts`.
  - **Fonts ship with the story**, as woff2 assets with optional `weight`, `style`, and `unicode-range` (the sample
    uses Literata, SIL OFL, latin and latin-ext subsets, so names like "Łucja" print in the same font). The app UI
    keeps Nunito (D12); a page never uses app fonts. `font-display: block`, so print never falls back.
  - **Story fonts are static (Sid, 2026-11-19):** one file per weight, each declaring that single `weight`, and every
    text style's weight declared for its family. Variable fonts print as Type 3 (D27). `importStoryVersion` checks
    this on the files' bytes (`staticFontIssues`, `isVariableFont`), not the decoder, so versions stored earlier stay
    readable. The sample's v2 replaced v1's variable Literata with static instances at 450 (body) and 700 (title),
    made with `fonttools varLib.instancer` (the OFL declares no Reserved Font Name). Databases seeded before keep v1.
  - **Slots carry an `example`** (name, pronouns, look) that fills them in story previews before a family casts
    anyone, and an `age` (`child`, `adult`): the faces the slot draws. The plan's `pronounSet: "from-character"` and
    free-text `defaults` are dropped: pronouns and look always come from whoever fills the slot.
  - **Characters are figures composed from parts (D26).** A `figure` layer has a `box` on the page and, for each
    face of its slot's age, a base drawn bald in neutral greys with a `skinMask` covering every visible bit of skin,
    an optional `browMask`, and an optional `occluder` with its own skin mask. Its `parts` are cropped drawings
    placed `at` a rectangle inside the box, one per option and face, each naming the palette it takes and whether
    it is approved. `showsHead: false` marks a figure with only a hand in frame (no parts, skin still recoloured).
    The manifest's `partOrder` (bottom to top) can be overridden per figure, e.g. glasses under hair. `palettes`
    holds the illustrator's gradient map for each skin tone and hair colour. Full-page canvases were the
    alternative; crops keep each part small and match the plan's "Composing pages".
  - **The look vocabulary** is `packages/core/src/looks/vocabulary.ts`: face (by age), skin, hairstyle, hair colour,
    glasses, with curated looks for the picker. Decoding checks that the manifest names only known options and has
    no misplaced faces; `vocabularyGaps` (run when publishing) checks that every option has a palette or a part on
    every figure, and `unapprovedParts` that every part is approved.
  - **Recolour** (`gradient-map-v1`, `looks/recolour.ts`, sharp): each pixel's luminance indexes the palette inside
    a mask, mask alpha blends soft edges, everything else is untouched. Vector placeholders rasterize at 300 dpi.
    The server caches each recoloured layer under `stories/<id>/v<n>/recoloured/<hash>.png`, keyed by the asset,
    the palettes, masks, and the algorithm name, so the editor and print load the same pixels. Measured on
    `a1.small`: a cold preview of the sample (24 recolours) takes about 1.8 s, then about 40 ms.
  - **Text tokens:** `{{slot.name}}` and `{{slot.they|them|their|theirs|themself}}` for `she/her`, `he/him`, and
    `they/them`; a capitalized field (`{{hero.They}}`) capitalizes the result. Pronouns don't fix verb agreement
    ("they are" against "she is"), so authors write around it, as in past tense.
  - **Layouts** (closed set): `full-bleed-art/text-bottom`, `full-bleed-art/text-top` (text on a light panel so it
    reads over any art), and `art-left/text-right`. Figure boxes are thousandths of the illustration area.
  - **Validation** checks references across the manifest (slots, page IDs, fonts, tokens, boxes, look options,
    asset paths that stay inside the version's folder) and reports every problem with its path, so it can serve as the upload validator.
  - **Placeholder art is SVG**, at 1 unit = 0.01 in, so it's small, diffable, and sharp at any print resolution.
    The format also accepts PNG, JPEG, and WebP for real illustrations.
- **Published versions don't change:** `importStoryVersion` (used by the seed) leaves an existing version alone and
  fails if its manifest differs, so editing the fixture means adding a version (or resetting a dev database).
- **Story assets** under `/api/files/stories/<storyId>/v<n>/` follow the story's read rule: published story and
  version, or the caller is the author. File responses carry `Content-Security-Policy: sandbox` and `nosniff`,
  because stored SVGs (and later author uploads) could contain scripts.
- **Reopen if:** an author needs a layout or text style outside the closed sets, or pronoun tokens prove too
  limiting for real stories (then per-pronoun text variants).

### D25. The Modal function: one A100-80GB, scale to zero, signed submit and callback — Made
- **How:** `modal/flux_klein.py` runs the distilled checkpoint through Diffusers' `ModularPipeline` with the prompt
  upsampler on (BFL: "do not use the model without it"), all in bf16 (~39 GB), on one A100-80GB. Weights live on
  the Modal Volume `lifestory-flux-klein-weights`, filled once on a CPU. Containers scale down 60 s after the last job
  and `max_containers=1` queues jobs instead of fanning out. The app POSTs jobs to the function's web endpoint,
  signed with HMAC-SHA256 over the body (`MODAL_CALLBACK_SECRET`); the GPU function reads references and writes its
  PNG through presigned S3 URLs and calls back `/api/webhooks/modal` with the same signature. The app needs no Modal
  token: `MODAL_TOKEN_*` is only for deploying.
- **Measured 2026-11-18:** cold start ~45 s (weights load 27–33 s), one 1024×768 image 19.5 s, so a cold job costs
  ~US$0.09 at US$0.000694/s including the 60 s idle tail, and a warm one ~US$0.014.
- **Reopen if:** GPU spend matters more than latency (fp8 weights or the upsampler on a smaller GPU), or bursts of
  pages need more than one container.

### D26. Characters are illustrator-approved variants composed from parts; no AI when a book is made — Decided (Sid, 2026-11-18)
- **What changed:** parents no longer upload photos and no model draws family members into books. For each role
  a parent picks a base face (a handful per role, covering age, gender and facial structure, drawn by the illustrator),
  a skin tone, a hairstyle, a hair colour and extras such as glasses. Every option is approved by the illustrator before
  the story is published, and a book is a stack of approved layers composed on the CPU, so it is instant and needs no GPU.
- **How:** for every appearance the illustrator delivers each base figure (bald, neutral skin) with region masks (skin
  covering every visible body part, not only the face; brows, lips, line), an occluder layer with its own skin mask
  (hands in front of the face) and a head zone, plus skin and hair palettes. Authoring tooling generates each shape
  option in place on the base (with a turnaround sheet per option for consistency), cuts it out by comparison with the
  base inside the head zone, and splits it by region. Skin and hair colour are a version-pinned recolour, not AI. The
  picker starts from a few curated looks and refines one feature at a time.
- **Looks are shared across stories (Sid, 2026-11-19):** a family's members each have a name, pronouns and a look,
  and any member can fill a role in any story. A look holds option IDs from one shared vocabulary (plan.md, "Looks
  and the picker"). **Every story supports every option except age (Sid, 2026-11-19):** a role draws only faces of
  its age, and covers every other option; falling back to a default would draw someone who doesn't look like the
  family member. Publishing checks this. When an option added later is missing from an older published version, the
  book either disables that story for the character or keeps a story-specific override with a supported option.
- **Why:** no children's photos to store or protect, and nothing near the license's biometric and digital-replica
  limits; a human reviews every image before families see it (the §2e content-review condition); consistent, print-
  quality art. With no user data, hosted image APIs are also allowed as authoring providers.
- **Evidence (thread T-01a1f012-4acc-7483-a9a5-8d5c5353cdee):** whole-page AI edits changed 0.8–13.6% of pixels
  outside the target region, so art never passes through a model. Five in-place renders on one base gave 24
  combinations (3 tones × 4 hairstyles × glasses) with the face pixel-identical; hair colour by gradient map kept the
  watercolour texture. Parts grow as a sum of options per base, not a product.
- **Open:** cut-outs at print size, hairstyle consistency across poses, glasses-over-hair layer order, a hosted API
  with transparent output.
- **Rejected:** photo likeness per book (privacy, license, cost, art drift); every combination pre-drawn (thousands of
  images per story to review); standalone reusable parts (they ignore each page's head angle and light).
- **Reopen if:** families need closer likeness than variants give, or illustrators can't supply bases and masks.

### D27. PDF proofs: printed by the worker from a token-gated print page, recorded with what they show — Made (2026-11-19)
- **How:** a `proof` row belongs to a family and pins a story version plus its **content**: the cast (name,
  pronouns, look per slot) and the text edits, copied when the proof is requested, so later look or text changes never
  alter it. Requesting one needs `book:edit`; any member of the family (a viewer too) downloads it from
  `/api/files/families/<familyId>/proofs/<proofId>.pdf`. The `proof.render` task (spawned with the proof ID as
  idempotency key) has two steps: `render` opens `PRINT_APP_URL/print/proofs/<id>?token=…` in playwright-core's
  Chromium headless shell, waits for fonts and images, calls `page.pdf({ preferCSSPageSize, printBackground })` and
  writes the PDF to a key derived from the proof ID (a rerun overwrites it with the same content); `record` marks the
  row ready with page count and size. The render fails, and Absurd retries, if an image or story font didn't load or
  the PDF's page count differs from the number of BookPages, so an overflowing page never reaches a printer.
- **The print page** (`apps/web/src/routes/print/proofs.$proofId.tsx`) draws every page with BookPage as on main, one
  per sheet, with `@page { size: <trim + 2 × bleed>; margin: 0 }`. It needs no session: it answers 404 unless the
  query carries an HMAC token over the proof ID and a 10-minute expiry, signed with `BETTER_AUTH_SECRET` (both services
  have it). Its images and fonts load from `/api/files/<key>` like the editor's, and Chromium answers those requests
  straight from object storage, so the PDF uses the same objects, recoloured layers included, without the worker
  holding a session.
- **Books plug in** through `createProof({ familyId, storyVersionId, content: { cast, textEdits }, requestedBy })`
  (`packages/core/src/proofs.ts`). Until personalized books land, the story page's "Make a PDF proof" calls it with
  the example characters and the looks chosen in the picker, and no text edits. The book adds a nullable `book_id`
  to `proof` and approval (`approved_at`, `approved_by`), which belongs to the book.
- **Chromium only in the worker image:** `playwright-core` is a dependency of `@lifestory/core` but loads on first
  use, so the web app never starts a browser. `apps/worker/Dockerfile` installs the matching headless shell with its
  system libraries and fonts (image 1.96 GB). On Railway the worker reaches the web app at its private domain.
- **Checked 2026-11-19** (orb, dev worker and the production worker image): 6 pages of 630 × 630 pt (8.5 in trim +
  0.125 in bleed per side); Literata embedded; recoloured layers at 300 ppi; the same line breaks as on screen, and
  1.6–3.1% of pixels differ by more than 5% (anti-aliased edges) when screen and PDF are compared at 96 dpi after a
  4× downscale. A render takes 1–1.6 s (4.3 s with a cold recolour cache).
- **Fonts:** Chromium embeds a variable font as **Type 3** glyph procedures, which print preflight flags, and a static
  instance of the same file as CID TrueType (tested 2026-11-19). So story fonts must be static (Sid, 2026-11-19; D24);
  proofs of the sample's v2 embed Literata Regular and Bold as CID TrueType.
- **Open:** the PDF keeps the layers' transparency (soft masks) and has no TrimBox or BleedBox (its page size is
  trim + bleed, which is what Lulu asks for); flattening and boxes are print-order work. The placeholder SVGs'
  "PLACEHOLDER ART" labels use a system sans, which can differ between screen and print; real illustrations won't
  have text.
- **Reopen if:** a print provider needs PDF/X, flattened transparency or page boxes; longer books make one browser
  page too slow (then render in page ranges); real screen-versus-print mismatches show up (D12).

### D6. Postgres with Drizzle for schema and migrations — Decided
- **How:** schema in `packages/db/src/schema`, `casing: snake_case`, migrations generated with drizzle-kit and
  committed; one `pg` pool per process is shared by Drizzle, Better Auth's Drizzle adapter, and the Absurd client.
- **Reopen if:** never expected.

### D7. Only containers, Postgres, and S3-compatible storage; nothing host-specific — Decided
- **Reopen if:** never expected.

### D8. SeaweedFS for local object storage, not MinIO — Decided (Sid, 2026-11-18)
- **Why:** Sid's call. Supporting evidence: on 2026-11-18 `docker pull minio/minio` failed with "pull access denied"
  and `quay.io/minio/minio` returned 401, so MinIO images are no longer anonymously pullable. Phase 1's
  "MinIO in Docker" step is replaced by SeaweedFS (`chrislusf/seaweedfs:4.54`, S3 API on :8333), configured like
  Sid's deputies repo: credentials from `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. Anonymous requests get 403.
- **Reopen if:** SeaweedFS's S3 API lacks something we need (for example presigned uploads), checked against the AWS SDK.

## Recommended design (adopted)

### D9. TanStack Start; server functions for app calls, server routes for outside callers; no separate API — Recommended
- **How:** Better Auth at `/api/auth/$`, file downloads at `/api/files/$`, dev sign-in at `/__dev/log-me-in/$email`.
  The Modal callback will be a server route. Editor routes will set `ssr: false` (milestone 1).
- **Reopen if:** server rendering or routing blocks the print path or the editor.

### D10. Effect v4 as the server programming model, one shared runtime, Effect Schema for validation — Recommended
- **How:** see "Conventions" in [AGENTS.md](../AGENTS.md). Server function inputs use
  `Schema.toStandardSchemaV1`; there is no Zod in our code.
- **Reopen if:** an Effect v4 release breaks the service or Schema APIs without a migration path.

### D11. Typed errors cross the server function boundary as an encoded Exit — Made
- **Why:** the brief asks to keep Effect's typed errors across the boundary. A server function returns
  `Schema.toCodecJson(Schema.Exit(success, failures, Schema.Defect()))`; `unwrapResult` on the client returns the
  value or rethrows the same tagged error class. Unit-tested in `packages/core/test/rpc.test.ts`.
- **Alternative rejected:** throwing errors and relying on TanStack Start's error serialization, which loses the
  error class and its fields.
- **Reopen if:** TanStack Start adds first-class custom serializers that preserve error classes with less code.

### D12. One React page component, physical units, embedded fonts; PDF from headless Chromium — Recommended
- **How (milestone 1):** the PDF proof is an Absurd task on the worker that opens a print-only route of the app in
  Playwright Chromium and calls `page.pdf` at the trim size plus bleed. Chromium lives in the worker container,
  not the web container. Fonts are self-hosted with fontsource (Nunito today), so screen and print use the same files.
- **Sid, 2026-11-18:** confirmed rendering proofs on the worker.
- **Reopen if:** real screen-versus-print mismatches show up (then precomputed layout, per the brief).

### D13. One image provider interface; a deterministic fake provider by default — Recommended
- **How:** `ImageProvider` service in `packages/core/src/image-provider.ts`. The fake renders an SVG whose colours
  derive from a hash of the request key, so retried steps write byte-identical objects.
- **Reopen if:** never expected.

### D14. Generation as an Absurd workflow that suspends for Modal's callback and for preview approval — Recommended
- See [plan.md](plan.md#generation-workflow). The fake provider goes through the same suspend-and-callback path
  (it emits the completion event itself), so tests exercise the real workflow.
- **Sid, 2026-11-18:** confirmed the callback design.
- **Reopen if:** the Modal callback can't reach the app (then poll Modal's function-call result with
  `ctx.sleepFor` between checks, which needs no inbound endpoint).

## Implementation choices (Made)

### D15. Toolchain: Node 26.13.1 (LTS), pnpm 12, TypeScript 7, Vite 8, Vitest 5, oxlint, Playwright — Made
- **Why:** current stable releases; TypeScript 7's native compiler typechecks the repo in seconds, and oxlint is fast
  enough to run on every change.
- **Reopen if:** a tool blocks something we need (for example a lint rule only ESLint has).

### D19. mise pins the toolchain and holds the task commands — Decided (Sid, 2026-11-18)
- **How:** `mise.toml` pins Node, pnpm, and mise itself (`min_version`), loads `.env`, and defines every command as a
  task (`check`, `dev`, `test:e2e`, ...). `.agents/setup`, `.amp/services.yaml`, CI (`jdx/mise-action`), and
  AGENTS.md all call the tasks; the root `package.json` has no scripts. This replaced `.node-version` and the
  `packageManager` field.
- **Gotcha:** mise's `.env` loading overrides variables already in the environment, so `BETTER_AUTH_URL` is not in
  `.env`; the `dev:web` task derives it from `$PUBLIC_URL` or `$PORT`.
- **Reopen if:** never expected.

### D16. Dependency versions: latest stable release at least 3 days old, pinned exactly — Decided (Sid, 2026-11-18)
- **How:** `minimumReleaseAge: 4320` in `pnpm-workspace.yaml` enforces it for transitive dependencies too.
  No `minimumReleaseAgeExclude` entries. CI installs with `--frozen-lockfile`.
- **Reopen if:** a security fix is needed sooner than 3 days; then add a dated, commented exclusion.

### D17. Development sign-in route — Made
- `GET /__dev/log-me-in/<email>?returnTo=<path>` finds or creates the user, signs in through Better Auth's real
  email-and-password endpoint (so the cookie is the normal session cookie), and redirects only to same-origin
  relative paths. Returns 404 unless `DEV_LOGIN_ENABLED=true` and `NODE_ENV !== "production"`.
- Dev-only routes live under `/__dev` (Sid, 2026-11-18): the convention agents know from Amp's own orb setup, and
  it can't collide with product routes. The folder is `routes/[_][_]dev`, because TanStack Router treats a
  leading `_` as a pathless layout. `GET /__dev` lists the endpoints and local users; `GET /__dev/log-me-out`
  ends the session. All of them share the same 404 gate.
- **Production (2026-11-18):** the gate also requires `import.meta.env.DEV`, which `vite build` compiles to false, so
  the production image returns 404 for every `/__dev` route whatever its environment says.
- **Reopen if:** never expected.

### D18. Postgres tuned for speed in development (`fsync=off`, `synchronous_commit=off`) — Made
- Local and CI data is disposable. Production uses the host's managed Postgres defaults.

### D22. Deployment: two images, migrations as a release step, Railway configured by its IaC file — Made
- **Images:** `apps/web/Dockerfile` and `apps/worker/Dockerfile` (Node 26 slim, pnpm prod install, workspace packages
  run from TypeScript source). Configuration is only environment variables, so any container host works.
- **Web server:** `vite build` emits a fetch handler, not a listener, so `apps/web/server.ts` serves it with srvx
  1.0.8 (already in the lockfile through TanStack Start). Rejected: Nitro, whose only current release is an RC (D16).
- **Migrations:** a separate command in the web image (`node packages/db/src/migrate.ts`) run before each release
  (Railway's pre-deploy command), not on container start, so a failed migration stops the release instead of
  crash-looping, and replicas don't race.
- **Railway:** `.railway/railway.ts` (Railway Infrastructure as Code, `railway` SDK 3.17.0) declares the services,
  Postgres, the bucket, and variables. `railway.json`/`railway.toml` are deprecated and stop being read on
  2026-12-01 (Sid, 2026-11-18). Code deploys with `railway up` because a project token can't connect a GitHub repo.
- **Storage URLs:** `S3_FORCE_PATH_STYLE` (default true for SeaweedFS); Railway buckets need virtual-hosted style.
- **Reopen if:** a release needs steps the pre-deploy command can't run, or deploys should follow pushes to `main`
  (then connect the GitHub repo as the services' source).

### D20. Orb sizes: `a1.small` for light work, `a1.medium` for full-stack verification — Made
- **Why:** measured peak of ~3.4 GB of 4 GB on `a1.small` with services, browsers, e2e, and typecheck running at once
  (AGENTS.md, "Orb size"). Milestone 1 adds server-side Chromium for PDFs.
- **Reopen if:** memory use changes enough that the numbers in AGENTS.md no longer hold.
