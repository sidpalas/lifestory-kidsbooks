# Decisions

The source of truth for how this codebase is built, together with [brief.md](brief.md). Each decision lists
its reason and what would reopen it. A decision changes only when new evidence turns up: whoever finds it
reports the evidence and a proposal, Sid decides, and the change is recorded here with the date.

Status: **Decided** (by Sid, in the brief or in a thread), **Recommended** (the brief's recommended design,
adopted), **Made** (chosen during implementation, Sid can veto), or **Proposed** (not in effect until Sid decides).

## Product and platform

### D1. TypeScript throughout, except the image model — Decided

- **Why:** one language for web, server, worker, and shared domain code; the image model runs Python on Modal.
- **Reopen if:** never expected.

### D2. React, Tailwind, shadcn/ui — Decided

- **Why:** brief. shadcn components are copied into `apps/web/src/components/ui` (style `new-york`, `components.json`).
- **Reopen if:** never expected.

### D3. Better Auth; a family is an organization; operator via the admin plugin without impersonation — Decided

- **Why:** brief. Accounts hold details about children (names, ages, looks; no photos since D26), so nobody, the
  operator included, may sign in as someone else.
- **How:** family roles `owner`, `parent` (edit books; the app calls it Editor, since a relative or friend can hold
  it too), `viewer` (read only), defined in `packages/core/src/auth.ts`
  with an extra `book: [read, edit]` statement. The operator role (`admin`) is a custom admin-plugin role whose
  permissions omit `impersonate` and `impersonate-admins`; the smoke test asserts the impersonation endpoint
  returns 403 for the operator. `emailAndPassword.disableSignUp` is on: accounts come only from invitations, the
  operator command (D21), or the development seed. Only an `owner` renames a family (`organization: update`); a
  `beforeUpdateOrganization` hook lets Better Auth's update endpoint change nothing but the name, trimmed, 1–60
  characters.
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
  images have no mise, so the command is a plain Node entry point like `migrate.ts`;
  `mise run operator:create -- --email <email>` wraps it locally. It reads the password from a prompt, never from the environment
  or arguments, creates the user with role `admin` (or promotes an existing user), and creates their one-person
  family through the same account-plus-family path as the operator's new-family invite (plan.md, "Invites and
  families"). Running it again changes nothing, and deploys never run it. The development seed
  (`mise run db:seed`, with its published password) never runs against production.
- **Reopen if:** a second operator or an automated environment needs operators without shell access.

### D33. Stories reach production through a one-off import command, run like the operator command — Made (2026-11-19)

- **How:** `node packages/core/src/story-import.ts --author <email> <story directory>...`, run inside the deployed web
  container (for example over `railway ssh`), like `operator-create.ts` (D21); `mise run story:import -- ...` wraps it
  locally. A story directory is `story.json` (ID, slug, title, summary, version number, publish date), `manifest.json`,
  and the assets the manifest names; the web image ships `fixtures/stories`. The command records the story as
  published and owned by the existing account with that email, then imports the manifest through
  `importStoryVersion`: the same validation, publish checks (every part approved, the vocabulary covered, D26), static
  fonts (D27), and object keys under `stories/<storyId>/v<n>/` (D31) as the development seed, which now imports the
  sample story through the same function. Running it again changes nothing. It stops without changing anything when
  the author has no account, the story belongs to another author, the slug belongs to another story, or a stored
  version has a different manifest or different asset files (a changed story needs a new version number in
  `story.json`). Files are compared before anything is written, so published art never changes under a version that
  books, proofs, and the recolour cache were made from.
- **Why:** of the two options in plan.md, this needs no new endpoint on an app holding children's data, and it
  publishes exactly what the seed and the e2e tests use. Shipping 0.9 MB of fixtures in the web image costs little.
- **Rejected for now:** an authenticated upload endpoint. Author uploads (plan.md, "Community authoring") will need
  one, with the manifest Schema as the validator; it should come with that tooling, designed for authors who
  aren't the operator, not as a one-person shortcut now.
- **Reopen if:** stories are authored outside the repository (the upload endpoint then replaces this), or a story's
  assets grow too large to ship in the image.

### D38. Agents sign in to production as an ordinary family the operator invites — Decided (Sid, 2026-11-19)

- **What:** the operator invites a new family named "Amp agent" with an address Sid receives (for example
  `sid+lifestory-agent@…`), sets its password from the set-password link in the web log (D23), and keeps the email and
  password as Amp project secrets `LIFESTORY_AGENT_EMAIL` and `LIFESTORY_AGENT_PASSWORD`. Agents sign in like anyone
  else: the `/sign-in` page in a browser, or `POST /api/auth/sign-in/email` with curl. README "Agent account" has the
  steps. No code changes: it is the invite path that exists. Set up 2026-11-19: Sid invited the family and set its
  password; the secrets are in the Amp project, and an agent signed in to production, read both published stories,
  and got 403 from an admin endpoint.
- **What the agent can do:** what any family owner can: read published stories, add its own (made-up) characters,
  make books and proofs, which exercises the worker. It sees no other family's characters, books, or proofs, and it
  is not the operator (`role` `user`; Better Auth's admin endpoints answer 403, checked 2026-11-19 in the production
  image).
- **Why:** no new way to authenticate on an app holding children's data, and checks run exactly the path parents use.
  A leaked password exposes one family of test data in an invite-only app, not other families.
- **Rejected:** an API key (Better Auth's apiKey plugin). It is more capable (scopes, expiry, no browser), but it adds a
  second way in that every route must handle, and keys need their own scoping and revocation design. Also rejected:
  having an agent read the link from `railway logs` and set the password itself: the password would then pass
  through a thread transcript.
- **Gaps:** there is no operator UI to disable an account. Until there is, a leaked password is rotated by signing in
  as the agent and calling Better Auth's `POST /api/auth/change-password` with `revokeOtherSessions: true`, and the
  operator can ban the user through `POST /api/auth/admin/ban-user` from a signed-in browser.
- **Then:** D34's post-deploy check can add signed-in steps (its "reopen if").
- **Reopen if:** agents need operator-only checks, several agents need separate identities, or checks need to run
  where a password can't be kept.

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
  log in production. `EMAIL_PROVIDER` picks the delivery (`log`, the default, is the only one so far): a provider is
  one entry in `packages/core/src/mailer.ts` that delivers an `Email`; the outbox and everything else stay the same.
- **Member invitations** use Better Auth's organization invitations (`/invitations/<id>`, also 7 days). Someone
  without an account creates one there with their name and password and joins only that family; someone with an
  account signs in and accepts. Opening the emailed link is what proves the email.
- **Reopen if:** we add a delivery provider that offers magic links, invitees often miss the 7-day window, or we
  need invitations that don't create an account until accepted (for example to keep unaccepted invites out of user lists).

### D39. Email delivery: Resend's free plan over its HTTPS API — Decided (Sid, 2026-11-19)

- **Need:** invitations and set-password links (D23), a few a week while invite-only. Each email holds the recipient's
  name and address and a single-use link valid for 7 days; no children's data. The provider must work from any host
  (D7) over HTTPS: Railway disables outbound SMTP on Free, Trial, and Hobby plans (Railway docs, "Outbound
  Networking", checked 2026-11-19). The app needs only a `Mailer` provider entry that POSTs JSON with `fetch` (D23); no
  SDK. Every option needs SPF and DKIM DNS records on the sending domain (for example a `mail.` subdomain of
  `devopsdirective.com`).
- **Compared (pricing pages, 2026-11-19):**

  <!-- oxfmt-ignore -->
  | | Resend | Postmark | Amazon SES |
  | --- | --- | --- | --- |
  | Price at our volume | Free: 3,000 a month, 100 a day, forever | Free: 100 a month; Basic $15/mo for 10,000 | No free tier for new accounts; $0.10–0.16 per 1,000 (cents a month) |
  | Next step up | Pro $20/mo for 50,000 | $1.80 per extra 1,000 | Same rate |
  | Message content kept | 30 days, every plan (Enterprise can change it) | 45 days by default; 7–365 days as a paid add-on | Not stored unless we publish events ourselves |
  | Terms | DPA pre-signed at sign-up, SCCs; data stored in the US; content not used for training | Transactional mail on separate IPs from bulk; DPA not checked | AWS DPA in the service terms; region we choose |
  | Setup | Sign up, verify a domain (DNS), one API key | Sign up, manual account approval, verify a domain | AWS account, IAM user and key, verify a domain, request production access (sandbox sends only to verified addresses) |

- **Decision:** Resend Free (Sid, 2026-11-19). It costs nothing at invite-only volume with room to spare, needs the least setup, is the
  provider Railway's docs recommend, and keeps content 30 days (the links in it are single-use and expire in 7). The
  `resend` entry would read `RESEND_API_KEY` and `EMAIL_FROM`, and production would stop logging links. Moving later is
  one `Mailer` entry and DNS records.
- **Alternatives:** Amazon SES if Sid wants no stored message content or already runs an AWS account (cheapest, most
  setup); Postmark if deliverability matters more than price (it vets senders and separates transactional traffic;
  $15/mo once past 100 emails a month).
- **How:** `EMAIL_PROVIDER=resend` POSTs each email to `https://api.resend.com/emails` with `RESEND_API_KEY`, from
  `EMAIL_FROM`, which must be on a domain verified in Resend. A refused or failed send fails the invite, so the operator
  sees it, and the error log still carries the link. `log` stays the default everywhere else, and production stays
  on `log` until the sending domain is verified (README "Email").
- **Reopen if:** volume passes 100 a day (Resend Free's cap), we need content kept less than 30 days, or deliverability
  to invitees' inboxes is poor.

### D4. Absurd for jobs and durable workflows on Postgres; every step idempotent — Decided

- **Why:** brief. Postgres is the only moving part; workflows can suspend for days (an illustrator's review of
  generated parts).
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
- **Sid, 2026-11-19:** the primary provider is OpenAI `gpt-image-2.6-sunburst` (D30); this function is the fallback.
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
    anyone, and the character `ages` it accepts (D29; format 1 had one `age`, `child` or `adult`). The plan's `pronounSet: "from-character"` and
    free-text `defaults` are dropped: pronouns and look always come from whoever fills the slot.
  - **Characters are figures composed from parts (D26).** A `figure` layer has a `box` on the page and, for each
    face type at each age it draws (D29), a base drawn bald in neutral greys with a `skinMask` covering every visible bit of skin,
    an optional `browMask`, and an optional `occluder` with its own skin mask. Its `parts` are cropped drawings
    placed `at` a rectangle inside the box, one per option, age and face, each naming the palette it takes and whether
    it is approved. `showsHead: false` marks a figure with only a hand in frame (no parts, skin still recoloured).
    The manifest's `partOrder` (bottom to top) can be overridden per figure, e.g. glasses under hair. `palettes`
    holds the illustrator's gradient map for each skin tone and hair colour. Full-page canvases were the
    alternative; crops keep each part small and match the plan's "Composing pages".
  - **The look vocabulary** is `packages/core/src/looks/vocabulary.ts`: age, face type, skin, hairstyle, hair colour,
    glasses, with curated looks for the picker (D29). Decoding checks that the manifest names only known options and
    draws only the ages its slots accept; `vocabularyGaps` (run when publishing) checks that every option has a palette or a part on
    every figure, and `unapprovedParts` that every part is approved.
  - **Recolour** (`gradient-map-v1`, `looks/recolour.ts`, sharp): each pixel's luminance indexes the palette inside
    a mask, mask alpha blends soft edges, everything else is untouched. Vector placeholders rasterize at 300 dpi.
    The server caches each recoloured layer under `stories/<id>/v<n>/recoloured/<hash>.png`, keyed by the asset,
    the palettes, masks, and the algorithm name, so the editor and print load the same pixels. Measured on
    `a1.small`: a cold preview of the sample (24 recolours) takes about 1.8 s, then about 40 ms.
  - **Text tokens:** `{{slot.name}}`, `{{slot.title}}` (what the children call them, such as "Dad", separate from
    the name and falling back to it when a member has none; Sid, 2026-11-19), and `{{slot.they|them|their|theirs|themself}}` for `she/her`, `he/him`, and
    `they/them`; a capitalized field (`{{hero.They}}`) capitalizes the result. Pronouns don't fix verb agreement
    ("they are" against "she is"), so authors write around it, as in past tense.
  - **Layouts** (closed set, format 2; replaced by text frames in format 3, D54): `full-bleed-art/text-bottom`,
    `full-bleed-art/text-top` (text on a light panel so it reads over any art), and `art-left/text-right`. Figure boxes are thousandths of the illustration area.
  - **Validation** checks references across the manifest (slots, page IDs, fonts, tokens, boxes, look options,
    asset paths that stay inside the version's folder) and reports every problem with its path, so it can serve as the upload validator.
  - **Placeholder art is SVG**, at 1 unit = 0.01 in, so it's small, diffable, and sharp at any print resolution.
    The format also accepts PNG, JPEG, and WebP for real illustrations.
  - **A raster sample tests the recolour on texture (2026-11-19):** "The Paper Boat" (`fixtures/stories/paper-boat`,
    3 pages) has watercolour art drawn with OpenAI `gpt-image-2.6-sunburst` like an illustrator's: JPEG plates, a
    WebP foreground, and per role two bald base figures with skin masks and hair and glasses parts cut out of in-place
    edits as RGBA PNGs (its `ART.md` has the source, licence, and how the layers were made). Rendered at 300 ppi
    with every skin tone and hair colour: paper grain, granulation and wash edges carry over, with no banding and no
    halos at mask edges; the editor and the print-ready proof (D35) show the same art (mean colour difference under
    0.03 levels, 0–0.8% of pixels off by more than 5% at 96 dpi, all at resampled edges). What a gradient map can't
    keep is colour inside the skin: the cheek blush became a dark smudge and an open mouth's tongue turned skin-brown on
    dark skin. v1 worked around it in its art; v2 uses the face overlay below. v5 (originally repo v3, 2026-11-19) poses every figure (kneeling
    side-on, pointing, sitting, seen from behind, and a hand in front of the face as an occluder), made with the art
    import's base code and the part pipeline (D36, D42) for US$2.76; addition 2 completes D43 on every pose for another
    US$3.86 without changing the published manifest. What took hand work is in its `ART.md`. Writing PNGs
    at zlib level 6 instead of 9 cut a recolour of an 800 × 1600 raster figure from ~0.8 s to ~0.3 s (the encoder
    took ~90%), for files 4–5% larger and the same pixels.
  - **Face overlays (Sid, 2026-11-19):** a base may have an `overlay` on its canvas, drawn as the illustrator made it
    (never recoloured) above the recoloured base and below the parts. It holds the colour a gradient map can't keep
    inside skin: blush, lips, an open mouth, later freckles. It's optional, so stored versions stay valid. The Paper
    Boat v2 uses it (blush as a translucent rose, the open mouth in its own colours), and both read right from the
    lightest to the darkest skin tone. Rejected: a second palette per region (blush tones per skin colour), which
    multiplies the illustrator's palettes and still can't hold a tongue next to teeth.
- **Published versions don't change:** `importStoryVersion` (used by the seed) leaves an existing version alone and
  fails if its manifest differs, so editing the fixture means adding a version (or resetting a dev database).
- **Story assets** under `/api/files/stories/<storyId>/v<n>/` follow the story's read rule: published story and
  version, or the caller is the author. File responses carry `Content-Security-Policy: sandbox` and `nosniff`,
  because stored SVGs (and later author uploads) could contain scripts.
- **Reopen if:** an author needs a text style outside the closed set, or pronoun tokens prove too limiting for real
  stories (then per-pronoun text variants). Layouts were reopened and replaced by text frames (D54).

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
  picker starts from a few curated looks and refines one feature at a time. (Curated looks replaced by an ordered
  sequence of single choices, D50.)
- **Looks are shared across stories (Sid, 2026-11-19):** a family's members each have a name, an optional title ("Dad", "Nana"), pronouns and a look,
  and any member can fill a role in any story. A look holds option IDs from one shared vocabulary (plan.md, "Looks
  and the picker"). **Every story supports every option except age (Sid, 2026-11-19):** a role accepts some ages
  (D29), and covers every other option at each of them; falling back to a default would draw someone who doesn't look like the
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

### D30. Part generation: OpenAI `gpt-image-2.6-sunburst` as the primary provider, Klein on Modal as the fallback — Decided (Sid, 2026-11-19)

- **What:** authoring tooling generates parts by editing the base in place with OpenAI `gpt-image-2.6-sunburst`
  (medium quality, base padded to 2:3), then cuts the part out (plan.md, "Authoring-time part generation").
  `gpt-image-2.6-flare` is allowed for faster drafts. Klein on Modal (D25) stays as the fallback. Masked edits and
  transparent output are not used.
- **Why (assessment of 2026-11-19, thread T-01a1f149-95e2-74f7-9818-59d430153d86):** 13 edits on Klein-drawn bases
  (11 of them children) and 12 on three Painter-drawn styles (gouache, pencil, collage), scored by the share of
  eye, nose and mouth pixels changed and by eye.
  - Sunburst kept the face intact in 13/13 and 12/12, at US$0.049 per part (measured, including image-input tokens)
    and ~18 s, with calls in parallel.
  - Every FLUX model redrew faces outside FLUX's own style: Klein on Modal 6/12, BFL Klein 4/12, BFL FLUX 3 Image
    2/12, up to 57% of the face changed. Klein's 13/13 on its own drawings didn't carry over.
  - Gemini (via OpenRouter) also held faces: 3 Pro Image 13/13 and 12/12 at US$0.139; Nano Banana 2.1 13/13 and
    ~11/12 at US$0.038. It re-renders more of the picture (mean change outside the part 16–18/255 against ~11).
  - Masked edits (BFL Fill, OpenAI) redrew the whole mask or returned artefacts; OpenAI's transparent parts had
    clean alpha but didn't fit the head (0/4). This closes D26's open question on transparent output.
- **Terms (official pages, 2026-11-19):** OpenAI doesn't train on API inputs by default (Services Agreement §4.2),
  keeps them 30 days for abuse monitoring, and assigns output to the customer (§4.1). BFL's API terms (§2b) license
  BFL to train on inputs and outputs, which rules it out for illustrators' art without an enterprise contract.
  Qwen wasn't tested: the Alibaba account couldn't call paid models.
- **How:** OpenAI's edit API is synchronous, so its `ImageProvider` calls it inside the submit step, stores the
  output and emits `generation.done` itself, like the fake provider. Before the cut-out, outputs are aligned to the
  base and colour-matched to it outside the part zone (sunburst re-toned Klein-drawn bases by ~10/255). The part is
  then cut out by known-background matting rather than a threshold on the difference (refines D26's "by comparison
  with the base"; plan.md, "Cutting parts out"), because thresholding lost glasses frames and baby wisps.
- **Watch:** OpenAI retires models (`gpt-image-2` shuts down 2027-02-10), so the model ID is configuration and a
  successor gets the same test set before it replaces this one. The style set was drawn by Painter, which may use an
  OpenAI model; a real illustrator's base should confirm the result.
- **Reopen if:** an illustrator's base shows sunburst redrawing faces or drifting in style; a seeded rerun puts
  Nano Banana 2.1 level with it on faces (then Gemini through Vertex directly, not AI Studio); OpenAI's terms change;
  or BFL offers zero retention and no training to us.

### D36. Part generation runs as `part.generate`; the cut-out is known-background matting in TypeScript; parts live in `story_part` until approved — Made (2026-11-19)

- **What:** `requestPart` records a `story_part` row for an appearance (page, role, age, face) and an option and
  spawns `part.generate` (plan.md, "Authoring-time part generation"). The OpenAI provider (`IMAGE_PROVIDER=openai`,
  D30) edits the base padded to the provider's 2:3 size; the cut-out (`packages/core/src/parts/cutout.ts`) stores
  RGBA layers under the version's folder (D31) with review images on the story's lightest and darkest skin. The
  author approves or rejects; `approvedParts` and `withApprovedParts` (or `manifestParts` for a caller recording
  draft parts) put approved layers into the draft's manifest as ordinary `Part`s, so composing a book never reads
  the table. Each `generation` row records the provider's usage and `cost_usd`.
- **Cut-out in TypeScript, not pymatting (refines D30's "known-background matting"):** the assessment's prototype
  ran Levin's closed-form matting in Python (pymatting) on the edit alone. Here alpha comes from the known base: the
  change C − B projected onto F − B, with F estimated from the part's opaque interior nearby. It needs no sparse
  solver and no Python in the worker image (D1), and runs in 2–8 s per part on an `a1.small` orb; a process
  cutting out and composing a 1024×1536 part peaked at ~630 MB resident. Measured on seven sunburst edits (US$0.34;
  three bases: the Klein-drawn portrait, the Painter gouache child, the sample's placeholder) and a synthetic test with known alpha
  (`part-cutout.test.ts`: alpha error < 0.02, 2 px frames, half-transparent wisps).
- **What the light/dark check found, and the fixes:**
  - The assessment's 1 px opening of the change mask erased 2 px glasses frames. Speckle now goes by piece size
    relative to the part instead.
  - The model redraws line work by a pixel or two (eyes, jaw), which put ghost lines in the layer. A change now
    counts only where nothing within 2 px of the base looks like it.
  - Skin the model drew inside a part (an ear over a glasses arm) kept the base's tone on every skin. Such pixels
    (colour within 3σ of the base's skin, inside its skin mask, in patches rather than streaks) are split into a
    layer with `palette: "skin"`; the format already allowed it. This is the plan's "split by region". Glasses
    keep no skin at all since the review below: skin the model redrew under an accessory is the base's skin with its
    lines moved, so the base shows there.
  - Glasses showed bits of the eyes and nose, which the model redraws a few pixels off when it adds glasses: orange
    slivers inside the lenses on dark skin (Sid's review, 2026-11-19). The cut-out kept them because they lie within
    reach of the frame. Pieces the part encloses (inside a lens) are now dropped, a hole is matted only at its rim,
    and glasses drop the skin they redrew. Of the 11 stored hair parts, 10 cut identically; one long-hair part lost
    40 faint edge pixels of 97,501 inside a gap in the hair, with the same opaque pixels. A line the model redraws in
    the frame's own colour where it touches the frame (a nose stroke at the bridge) still gets through, which is
    what the review is for.
  - Hair over a base outline of its own colour (gouache) left a dark arc. Pixels coloured like the part inside its
    closed opaque mass are opaque.
- **Hair is asked for in dark brown** and turned into neutral tones (median 0.40, where the hair palettes put the
  colour), so it stands out from every skin and still takes any hair colour.
- **The zone is per request,** not in the format (D26's head zone): the authoring UI asks the illustrator for it.
- **Open:** pencil textures weren't tried; a real illustrator's base (D30's "Watch") is still the test that counts;
  the portrait base's own extraction artefacts (D28) show up as small changes the model "repairs"; figures are
  addressed by page and role (`slotId`), so a page with the same role twice needs another key.
- **Reopen if:** illustrators reject more than a few parts for cut-out defects rather than drawing (then try a
  learned hair or glasses segmenter as the prior, or closed-form matting); the worker can't afford the memory of a
  cut-out (~630 MB peak for the process at 1024×1536).

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
- **Only books make proofs (D45):**
  `createProof({ familyId, bookId, storyVersionId, content: { cast, textEdits }, requestedBy })` (`packages/core/src/proofs.ts`) takes a book's cast as drawn and its text edits and sets `book_id`.
  Proofs made from the story page before D45 have no `book_id`; they stay listed nowhere and expire as drafts (D32).
  Approval belongs to a book's proof (D32).
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
- **Print-ready since D35:** the render flattens each page's art to one opaque 300 ppi image under live text, sets
  TrimBox and BleedBox, and checks the file against Lulu's requirements. The placeholder SVGs'
  "PLACEHOLDER ART" labels use a system sans, which can differ between screen and print; real illustrations won't
  have text.
- **Reopen if:** longer books make one browser
  page too slow (then render in page ranges); real screen-versus-print mismatches show up (D12).

### D28. The picker shows a story-independent portrait; books keep per-role overrides — Decided (Sid, 2026-11-19) / Made

- **Portrait (Sid's request):** while a parent picks a look, the picker shows one character illustration that belongs
  to no story (`packages/core/src/looks/portrait.ts`), served as `/api/portrait?<look>`. Each story then draws the same
  option IDs with its own parts. The portrait is composed like a story figure (`composeFigure`, then `gradient-map-v1`),
  from art shipped with the code because the vocabulary it covers ships with the code. This replaces plan.md's "the
  sample story's cover" as the preview.
- **Art (Sid chose the style, 2026-11-19):** gouache with an ink outline, drawn with OpenAI `gpt-image-2.6-sunburst`
  (D30) in thread T-01a1f24f-b041-739f-953a-45680530a7c3, replacing the FLUX 3 Klein placeholder (one grown-up base
  for every age and face type). Sid picked it from four samples (gouache, watercolour, flat mid-century, crayon).
  Each age and face type has its own base (14), each an edit of the chosen sample; teens, adults and older adults
  needed a second prompt asking for adult proportions, or they read as children. Each base's skin mask is found by
  colour (eyes, mouth and line work stay as drawn), and its skin's median luminance is set to 0.684, the portrait
  palettes' tone stop. The 46 parts (hairstyles at every age that has them, glasses from young child up) were made
  and cut out like story parts (D36) and reviewed on the lightest and darkest skin; two were retaken (a redrawn
  chin line, an eyebrow on a lens). Stored at 488 × 560 (the picker shows 244 × 280), parts cropped to their pixels
  and listed in `portrait/parts.json`. US$3.78 in all (4 samples, 20 base edits, 48 part edits).
- **Hair reaches the ink outline (2026-11-20, Sid's request):** the matte left the bases' thick ink outline half
  covered under the hair, as dark notches around a light buzz cut and flecks under long hair. The book parts' rule
  (`coverOutline`, Paper Boat v6) now measures each base's outline width and finds the silhouette of a base drawn on
  paper; `fixtures/art-sources/portrait/build-outline.ts` re-cut the stored parts with it (no new edits). No part
  leaves scalp above it (`crownGap` at most 8.1, under the limit of 9), so none was redrawn.
- **Hair covers the ink it lies over (2026-11-20, Sid: "the toddler and young child ponytail has some outline
  bleed through", then braids and short hair on the round face):** a separate defect from the crown ring above. Where
  hair is painted over the base's line art (a braid across the jaw and collar, a ponytail or short cut over the
  head's outline) the matte can't tell ink from dark hair and left it at alpha 0.5–0.9, which `coverOutline` skipped
  as "already mostly hair": a dotted trace of the outline under light colours on every skin. `figureCoverage` now
  also returns the base's ink (darker than 0.4 of the paper) for bases drawn on paper; with it, `coverOutline` covers
  ink in its band even when mostly covered, ink the hair spans on both sides anywhere, and reaches one pixel further
  (the ink's anti-aliased inner edge). Ink beside hair (a cheek's outline beside long hair, a crown under wisps) stays.
  Bases with alpha (Paper Boat, Moon Picnic) get no ink, so published book parts don't change.
  `build-outline.ts` re-cut all 197 stored portrait parts (no new edits, no spend) and the landing demo's layers
  were regenerated.
- **A line belongs to what it outlines (2026-11-20, Sid adopted it):** the ink rules above also covered the outline of
  an ear beside long hair and of an earlobe beside a beard, measured by re-running them on every portrait part as it
  was before them (`114f451`) and on Paper Boat's bases flattened onto paper. Ink is now covered only when the nearest
  figure across from it that isn't ink or paper is mostly hair. On the portraits it keeps the crown, ponytail, braid
  and buzz-cut fixes (it covers 103,492 of the 111,668 px the rules covered, nothing new) and restores those ears.
  `build-outline.ts` re-cut the portrait parts again from `114f451`, and the landing demo's layers were regenerated.
  Not settled: Paper Boat's pencil flattened onto paper still loses lines at ears, neck and shoulders to these rules
  (27,148 px over 114 parts, against 0 on its transparent bases), because thin pencil isn't the thick ink they were
  measured on. Its published bases have alpha and get no ink, so no book changes; art drawn in pencil on paper would
  need the rules limited to ink as dark as the hair before it is imported. Sid deferred a general pass until more
  stories in other styles exist: plan.md, "How Coming later fits", "Cut-outs that hold across art styles".
- **The beard needs no rule of its own; stubble couldn't be fixed (2026-11-20, Sid: "the full beard has a similar
  issue", "the stubble options look bad/patchy"):** the dark dashes where the live beard's sides meet the neck are
  the same half-covered ink, and the rule above covers them. A rule that also covered the ink facial hair merely
  touches was tried and dropped: it left blobs of hair colour on the nostrils under the moustache. Stubble was tried
  without `coverOutline` (extended to the face's outline, its dots became a solid band at the cheek) and redrawn
  (8 parts, US$0.42, the prompt asking for an even shadow with no bare patches; edits kept outside the repo): fuller
  on younger adults but still patchy, worse on the older round face, where the model drew the dots close to the
  skin's tone and the cut-out drops most of them. Stubble was retired instead (D52).
- **Overrides (Made):** `book_cast.look_override` holds options a book draws instead of the character's own, for axes
  its story version can't draw (D26's "story-specific override"). `castLook` applies an override only while the
  character's own option is unsupported, so a later look change back to a supported option takes effect again. A role
  still undrawable (no override yet, or a character of an age the role doesn't accept) is left out of the pictures, never drawn with a default,
  and the editor asks the parent to pick a stand-in or someone else; the text still uses the name and pronouns.
- **Reopen if:** the illustrator delivers real portrait bases (then replace the art; nothing else changes), or parents
  are confused that the portrait and a story's drawings differ.

### D29. Character ages: seven buckets first in the picker; roles accept some, figures can pin one — Decided (Sid, 2026-11-19) / Made

- **What:** a look's first axis is the character's `age`, one of `baby` (0–1), `toddler` (1–3), `young-child` (3–7),
  `older-child` (8–12), `teen` (13–17), `adult` (18–64), `older-adult` (65+). The buckets are character ages, not
  Wonderbly-style reader ages: they split where the body changes enough that one drawn base can't cover both, or where
  the character plays a different part in a story. Finer buckets multiply the bases to draw and review; coarser ones
  lose likeness. Faces become **face types** (`face:round`, `face:oval`) drawn at every age, so a character keeps their
  face as they grow.
- **Roles and figures:** a slot declares the `ages` it accepts (the hero of the sample takes young and older
  children; its grown-up takes adults and older adults), and a figure has a base and parts per face type at each.
  A figure may pin an `age`, so a role can grow up during a story (a newborn on page 1, a toddler on page 6); it then
  draws that age whatever the character's own. `partAxesAt(age)` says which parts an age has: a baby none, a toddler
  hair only. An override never sets an age. A character whose age a role doesn't accept leaves that role's pictures
  and the editor asks for someone else (D28), the same when a character's age changes later.
- **Pronouns order, never filter (Sid, 2026-11-19):** the picker lists the hairstyles (and, until D50 removed them,
  the starting looks by their hairstyle), likelier first for the chosen pronouns (`she/her`: long first; `he/him`: short first; `they/them`:
  vocabulary order). Every option stays offered: pronouns don't decide how someone looks.
- **Bases from the illustrator's samples (amends D26):** authoring tooling may generate bases for other ages from a
  few illustrator-drawn sample characters; every generated base and part still needs the illustrator's approval
  before publishing, as in D26.
- **Format 2:** `formatVersion` 2 with `ages` on slots and `age` on bases, parts, examples, and optionally figures.
  Stored format 1 versions are upgraded when read (`upgradeFormat1`: child → young child, adult → adult, the four old
  faces → face types at those ages), so they keep drawing exactly what they drew. Migration 0006 converts stored
  looks the same way. The sample story's v3 is format 2; its new ages reuse the placeholder SVGs.
- **Reopen if:** an illustrator finds a bucket boundary wrong for real bodies (split or merge it), or generated bases
  fail review often enough that hand-drawing every age is cheaper.

### D40. Features: softer or defined, from teen up; pronouns pick the default — Decided (Sid, 2026-11-19) / Made

- **Why (Sid):** the gouache portrait's teen and adult bases read male even with long hair (D28), and a face type
  in two versions gives better likeness. Sid chose a new axis over replacing round and oval, and more hairstyles plus
  facial hair over a gender or ethnicity axis (those are still to come).
- **What:** a look's `features` is `features:soft` or `features:defined`, a choice from teen up (`featureAges`);
  younger bases read neutral, so children have none. Looks saved before the axis decode as defined, which is what
  their bases showed. A story's bases and parts carry an optional `features`; absent means defined.
- **Defaults from pronouns (Sid):** she/her suggests softer, he/him defined, they/them keeps what's chosen. Applied
  when pronouns change and when a look grows into a teen age; one click changes it. Curated teen and adult looks came
  in both until D50 removed curated looks.
- **A story without softer features draws the defined base (Made; Sid can veto):** softer features refine likeness,
  so instead of leaving the character out (D28's rule for options a story can't draw), the figure falls back to the
  defined base of the same face type. Publishing requires the defined bases as before, and a softer base, when drawn,
  must have all its parts. Moon Picnic and The Paper Boat keep working unchanged. Reopen if parents find the fallback
  worse than the stand-in prompt.
- **Authoring:** the figure editor lists a softer and a defined base cell per face type from teen up, and generated
  parts record their base's features (`story_part.features`, migration `0012_part_features`).
- **Portrait art:** 6 softer bases (edits of the defined ones; a first, subtler prompt was redrawn because the recolour
  erased its pink lips, so lips and lashes are now ink line) and their 24 parts, made and reviewed like the rest (D28).

### D41. New look options reach a published story as additions, not a new version — Decided (Sid, 2026-11-19) / Made

- **Why (Sid):** "It seems important to be able to make tweaks like this to the authorship side without requiring a
  new version of every story to be created." A new vocabulary option (red hair) meant a new version of every story,
  which copies every file, and books stay pinned to the old version, so they never got the option anyway. One shared
  palette can't replace per-story ones: Moon Picnic's hair stops sit at 0.35 and 0.48, The Paper Boat's at 0.15–0.85.
- **What:** a published version keeps an append-only list of **additions** (`story_version_addition`, migration
  `0013_story_version_additions`): revision 1, 2, … each a `StoryAddition` (`book-format/additions.ts`) of palettes,
  figure bases, and approved parts for options the version lacks. `additionIssues` refuses anything that replaces what
  is published (a palette, a base, or a part for the same option and appearance), names a figure that isn't on the
  page once, or adds an unapproved part; the merged manifest then passes the format's own checks (`mergeAdditions`).
  The `story_version` row never changes (D24 holds as written), and additions are never edited or deleted:
  publishing a revision again with other content is refused. Their files go under the version's folder (D31).
- **Who draws what:** books, previews, the catalogue, the author's list, and "Start version n+1" read the version
  with every addition (`withStoredAdditions`), so a stand-in (D28) gives way to the character's own option as soon as
  the story can draw it. A proof records the revision it was requested at (`proof.addition_revision`) and its print
  page composes with exactly those additions: an addition can change how an existing look draws (D40's softer base
  replacing the defined fallback, an override no longer applying), and an approved proof and its PDF never change
  (D27, D32, D35). Proofs made before this record 0, which is what they drew.
- **How they're published now:** a story directory may hold `additions/1.json`, `2.json`, …; `story:import` (and so
  the seed and production, D33) publishes the version, then each addition in order, idempotently. Publishing a version
  checks vocabulary coverage counting its additions, so a fresh database imports an older version plus its additions.
  `publishStoryAddition` is the function an authoring panel will call (generating parts against a published version
  with D36 and approving them into an addition); that panel isn't built yet.
- **When an author never adds an option (Sid chose this, 2026-11-19):** the story behaves as before: it reports the
  option unsupported, the book asks for a stand-in, and no proof prints until every role draws. To make the gap
  visible, `/author` lists the options each published version can't draw yet (`uncoveredOptions`), and making a book
  warns when the story can't draw someone picked for a role.
- **New axes later:** an axis with a no-part default (as `glasses:none`) leaves every stored look and story drawing
  nothing new; additions would also need to place it in `partOrder`, which this format doesn't hold yet. Add that
  with the first such axis.
- **First use:** `hair-colour:red`, with a red palette tuned to each sample story's own hair stops, as
  `additions/1.json` of Moon Picnic v5 and The Paper Boat v2, and a portrait palette for the picker.
- **Rejected:** growing a published manifest in place (breaks D24, and pinning proofs would need the old manifests
  kept anyway); vocabulary-level default palettes per tone convention (palettes only, unreviewed per story against
  D26, and the samples don't share a convention); cheap new versions with books moved forward (copies every file,
  and moving books needs the same additive check).
- **Reopen if:** authors need to withdraw an addition (then a withdrawal that pinned proofs ignore), or additions grow
  so many that merging them on every read gets slow (then cache the merged manifest per revision).

### D43. Six more hairstyles and facial hair; options added later are optional for stories published before them — Decided (Sid, 2026-11-19)

- **What (Sid):** hairstyles buzz cut, ponytail, braids, coily afro, locs and bun join short, curly and long, and a
  facial hair axis (none, stubble, moustache, full beard) is offered from adult up. Pronouns order the hairstyles
  (she/her starts with long, ponytail and braids; he/him with short and buzz cut) and never hide one. Facial hair is
  a part like glasses, drawn in neutral tones and recoloured with the hair colour, below the glasses and hair.
- **Stories published before an option stay valid (Decided, Sid, 2026-11-19):** each option added after the first stories
  carries `addedAt`. Publishing still requires every option (D26), except those added after the version's
  `publishedAt`; a stored `partOrder` may lack an axis added later, which then goes at the bottom (`fullPartOrder`).
  Moon Picnic and The Paper Boat keep their versions; a parent who picks a new option sees the book's stand-in
  prompt (D28) until the story draws it, and `/author` lists the options as uncovered; the author adds them as
  additions (D41). Without this, every new option would stop the samples (and any older version) importing on a fresh
  database until each story drew it in its own style. Looks saved before the axis decode with no facial hair.
- **Facial hair's place for stories that don't list it (D41's "new axes later"):** a stored `partOrder` without
  `facialHair` draws it at the bottom, under glasses and hair, which is where a beard goes; additions don't carry a
  `partOrder` yet, so a story that wants it elsewhere needs a new version.
- **Portrait art:** the new hairstyles on every base from toddler up (108 parts) and the facial hair on every adult
  and older adult base, defined and softer (24), made and cut out like the rest (D28, D36) and reviewed on the
  lightest and darkest skin; US$7.30 on OpenAI, including one retake of the stubble. Stubble stays faint on older
  adults: the model draws it as sparse dots close to the skin's tone, which the cut-out drops as noise or skin, so a
  stronger prompt only helped younger adults. Each base keeps the stronger of the two takes; tuning the cut-out for
  stippled texture would fix it without new edits. Red hair's portrait palette (D41) is retuned from a bright
  orange-red to copper (`#8c3a1c`).
- **Not here:** auburn (a palette, through additions like red, D41).

### D44. Parts cost less per option: tiled edits, head-only parts shared across features, and a `flip` on figures — Decided (Sid, 2026-11-19) / Made

- **Why (assessment of 2026-11-19, artifact "Per-pose parts: cost and consistency" in thread
  T-01a1f50e-6d8e-70ce-bea8-adf2e7932795):** with D43's vocabulary a figure needs a part per option on every base
  (hero: 4 bases × 10 = 40 parts; a grown-up with softer bases: 8 × 13 = 104), so a 24-page book with 2 roles comes to
  2,352–6,360 generated pieces, US$115–312 at US$0.049 per edit, and an estimated 13–80 h of review at 20–45 s per
  piece (not measured). Counted with `vocabularyGaps` itself on synthetic manifests. Sid keeps every option, because
  they make characters look like the family, so these changes make each option cheaper.
- **Tiled edits:** part generation edits several bases of one appearance in one image (four at 512 × 768 in a
  1024 × 1536 edit, two for large figures) and cuts each tile out against its own base. Measured on four Paper Boat
  bases: one sunburst edit (US$0.047) gave four parts with `cutOutPart`, children's faces changed 0.6–1.5% of
  eye-to-mouth pixels (a single-figure edit: 0.4%), and all four drew visibly the same hairstyle. Each tile needs
  ~110 px of headroom above the head (with 30 px the model moved two heads down 32 px and clipped the curls).
- **Head-only parts shared between softer and defined bases:** short, curly, buzz cut, coily afro, bun, glasses and
  facial hair are drawn once per face type and listed again for the other features (the format already lets two
  parts name the same asset). Measured on the portrait bases: short hair and glasses fit the other base cleanly (skin
  masks overlap 0.90–0.94 IoU); long hair didn't (hard cut and a halo at the narrower shoulders), so styles that
  touch the body keep a part per base.
- **`flip` on figures:** an optional field mirrors a figure (base, masks, overlay, occluder and parts together), so
  a pose facing the other way reuses its drawing and parts. Additive: stored versions stay valid.
- **Together with OpenAI's Batch API** (50% off edits within 24 h; documented for sunburst 2.5, to confirm for 2.6):
  about US$20–45 per book. Review stays the larger cost, so the editor should review one sheet per option across all
  bases and appearances.
- **Not chosen:** a 3D model posed per page (the story's watercolour still needs an edit per pose, so it saves
  nothing), Klein or another cheap model (redraws faces, D30), a head-only crop (US$0.052, more than the full
  figure), quality `low` (30% cheaper, but the hairstyle changes character), heads split from bodies (a one-way format
  change; held back). Options generated when a family first picks them: plan.md, "How Coming later fits".
- **Reopen if:** tiled tiles show faces redrawn more than single edits on an illustrator's art, or shared parts draw
  visibly wrong on a real illustrator's softer bases.
- **Built (2026-11-19, thread T-01a1f52f-9f17-761c-8b02-18545ddf2d8d):** `requestParts` takes a batch and spawns
  `part.generate` per option for up to four new parts; the task tiles them (`tileBases`, `cutOutTile` in
  `parts/images.ts`), and a single part keeps the whole-figure edit. Each tiled part shows a quarter (or half) of the
  edit's cost. The editor's "Generate missing parts" sends one batch per figure. Checked on the real pipeline: one
  sunburst edit of four Paper Boat bases (US$0.047) cut into four curly parts, outside change 2.5–4.7, recomposite
  2.3–4.6, no zone-edge contact or shift; on the assessment's tiles the cut-out reproduces its numbers, and the
  coarse alignment finds a 32 px head move. Sharing happens where approved parts merge into the manifest
  (`withApprovedParts`): a head-only part (`HEAD_ONLY_OPTIONS`) is listed again for the other features when the
  figure has that base and no generated part or approved upload of its own; the editor shows those cells as shared,
  with "Draw its own". `flip` mirrors the composed figure's layers within its box, and the page cache stores the
  mirrored PNGs next to the recoloured ones. Not built: the Batch API (support for 2.6 unconfirmed), review of one
  sheet per option across appearances, and options drawn on first pick (plan.md).
- **Consistency across poses (same day, the assessment's final findings):** a hairstyle drifted between poses
  because the prompt named only the style ("curly": loose waves on one pose, tight coils on the front). Each option
  now has one fixed, detailed description (`optionWords`), and every edit gets an approved drawing of the option as
  a second image: the version's approved manifest part, else its earliest approved generated part, preferring the
  same role, then face type, composed on its own base in neutral grey (a peach-skinned reference recoloured the
  face) and cropped around the head (`referenceImage`). The part's metrics name the reference. Checked: one tiled
  edit of four Paper Boat bases with the front long hair as reference (US$0.055) drew straight hair with a
  straight-cut fringe on all four, where the bare prompt drew waves without a fringe on the v3 poses.
- **Hairline edges:** the cost/consistency thread's fix (`eedf883`) samples colours deeper inside the part and
  recovers boundary transparency instead of keeping blended strands as opaque pale hair. D44 uses that unchanged
  `cutOutPart` interface for both single and tiled edits; no duplicate edge fix and no new image spend. It applies
  to future cut-outs, not the immutable assets already published in Paper Boat v3.
- **Review and retake estimates (corrected):** 15 s per part was not measured. The pose thread's expanded pass
  estimates 20–40 s per contact-sheet part and 12.5% extra calls for retakes. The generation savings above do not
  remove human review or include a measured whole-book turnaround.

### D45. The story page previews the family's own cast; example looks are a separate "try looks" mode; proofs belong to books — Made (2026-11-19)

- **Why (Sid, on production):** "i selected characters from my family, but it didnt update the images and it also
  still shows the placeholder pickers with default names?" The story page had a "Make our book" cast form that changed
  nothing on the page, below it look pickers for each role's example character ("Leo as the child") as text
  dropdowns, and a proof panel for the example cast, so it wasn't clear what the pages showed or what to do next.
- **What:** "Who's in this book" lists each role with a portrait and a choice of the family members of an age the role
  accepts (D29). The pages below are composed with that cast and their saved looks as soon as it changes, and start
  with the first family member who fits each role, so a family sees itself before making the book. A role the story
  can't draw (D28, D41) is left out of the pictures with the same warning the book gives. The choice is in the URL
  (`?cast=`, character IDs of the user's active family; any other ID falls back to the example).
- **Trying looks:** the role's last option, "Try looks on Mia, the story's example", opens the character builder's
  visual picker (`LookPicker`, Sid asked to reuse it) limited to the role's ages, in its own card that says it's the
  story's example and nothing is saved (`?looks=`). "Make the book" needs a family member in every role. A family with
  nobody of a role's age sees the example, with a link to add someone.
- **Proofs belong to books:** a proof is the print file of a family's book (D27, D32, D35), so the story page no
  longer makes them; `requestStoryProof` and `listStoryProofs` are gone.
- **Viewers** preview with their family's members and try looks (nothing is saved), and get no "Make the book".
- **Books the family made are listed on the story page**, so a parent opens the one they made instead of making it
  again; since D47, the page sends them to it instead of silently making another.
- **Deleting a book (Sid: "there's no way to delete a book"; Made, Sid can veto):** a parent or owner deletes a book
  from Our books or its page, after a confirmation that names it. Its cast, text edits, and proofs go with it,
  approved proofs too: no print order references a proof yet, so D32's "kept as long as the family" has nothing to
  protect. The `storage.sweep` task then deletes the PDFs. The family's characters stay. When orders exist, a book
  with an ordered proof should be kept or archived instead.
- **No guides for families (Sid):** trim, safe area, and figure boxes are for authors placing art; parents edit only
  text, so the story page and the book editor no longer offer them. The author's draft editor keeps them.
- **Reopen if:** families want a proof of a story before making a book, or want to try looks on their own family
  member without saving them (then a "try on Clara" mode that offers saving to her character).

### D46. A book can draw a family member with its own look, kept on the book; the story page shows it before the book is made — Approved by Sid / Made (2026-11-19)

- **Why (Sid):** "being able to set an override style on the page (without modifying the canonical definition for a
  family member) would be ideal", chosen before "Make the book", shown in the preview, and "not saved to the DB until
  you click make this book".
- **What:** `book_cast.look_changes` (migration `0014_book_look_changes`, nullable jsonb, a `LookOverride`) holds the
  axes one book draws differently from the character's saved look; age never, since another age draws someone else.
  The pages draw `withLookChanges(saved, changes)`, so any other saved-look edit still shows in the book. Stand-ins
  (D28's `look_override`) apply on top only for options still undrawable. Choosing someone else for the role drops
  the changes; deleting the book deletes them (D45).
- **Only what the story draws:** the picker is the character builder's (`LookPicker`) at the character's own age,
  offering only options `castLook` says this story draws for the role, so a styled look never needs a stand-in;
  `createBook` and `setBookLook` refuse anything else.
- **Before the book exists:** "Change look for this book" on the story page keeps the changes in the URL
  (`?changes=`) and the preview draws them; nothing is stored until "Make the book" saves them with the cast. In the
  book editor the same picker saves each change to the book, and "Use <name>'s saved look" clears it.
- **Reopen if:** families want a book look to follow later edits of the same axis in the saved look (today the book's
  choice wins for that axis), or want to save a book's look back to the character.

### D47. A family with a book of a story is sent to it; another copy is made only on purpose — Made (2026-11-20)

- **Why (Sid):** "if someone clicks 'Make the book' they would not want to create a new copy of it. Perhaps if an
  instance of a book already exists in the family, we should warn the user about that and take them to the existing
  one rather than creating a new one with no mention of the existing one."
- **What:** when the active family has a book of the story, of any version, the story page says so above the roles and
  lists each one (with "made from version n" when it pins an older version). With one book, "Open our book" is
  the main action; with several, the page names none of them for you, and each is a link. "Make the book" becomes an outline
  "Make another copy", which says the existing books stay as they are. Opening a book never applies the story page's
  cast or book-only looks (D46) to it.
- **On the server:** `createBook` takes `existing`, the books the page listed, and makes a book only if the family
  has no other book of the story; otherwise it fails with `BookExists` and changes nothing, and the page reloads its
  list. It checks under a Postgres advisory lock per family and story, so a double click, a second tab, or two parents
  at once make one book, not two.
- **Not a ban:** multiple copies stay possible and existing duplicates and their data are untouched; there's no
  unique constraint. A book of an older version is still "a book of this story": a newer version doesn't
  upgrade it, and "Make another copy" makes one of the newest version.
- **Reopen if:** families want to move a book to a newer version, or Sid wants one book per story enforced.

### D48. The app is a sidebar shell; Home opens on the next step, then the last book, then stories; Studio is apart — Decided (Sid, 2026-11-20) / Made

- **Why (Sid):** "an app dashboard with a left sidebar that would have things like family settings, family characters,
  our books". The old home was one page of cards: the family panel and invite form first, stories last, and the
  operator's cards styled like family content. Five layouts were compared (sidebar, bookshelf, three tabs, next
  step, family first); Sid chose the sidebar and kept the next-step card "at the top of the homepage during user
  onboarding, basically until they have added a character and made at least one book".
- **What:** the sidebar lists Home, Stories, Our books, Characters, and Family settings ("Family" for viewers), with
  the family switcher (only past one family, D3) at the top and who's signed in at the foot. Pages:
  `/` (Home), `/stories`, `/books`, `/characters` (and its new and edit pages), `/family` (name, members,
  invitations). Below `md` the sidebar becomes a top bar and five bottom tabs. Home shows the next-step card to
  parents and owners while the family has no character or no book, then "Pick up where you left off" (the newest
  book), then the stories; a story the family already has one book of offers "Open our book" instead of "Make a book",
  and one with several ("Our 2 books") opens the story page, which lists them (D47).
- **Studio:** authors and the operator get a "Studio" link under the sidebar; `/author` and its story pages carry a
  dark "Lifestory Studio" bar with "Back to family". Studio is only for making stories: the operator's tools moved
  to Admin (`/admin`, Sid, 2026-11-20), a page in the shell linked under Studio for the operator only, with Families
  ("Invite a new family") and Authors (who can write stories). Its server functions check the operator role; others
  get not found. On phones (Sid chose the Menu sheet over a More tab and an avatar menu, 2026-11-20) the top bar
  keeps the logo, the family name, and one Menu button, the account's initial and a down arrow in an outlined pill (a hamburger read as a
  second navigation, a bare initial as a picture), whose sheet, opening from the bottom, holds who's signed in,
  the family switcher, Studio, Admin, and Sign out; the five tabs stay the family's places.
- **Story and book pages stay full width** without the shell, so their pages have room.
- **Reopen if:** families find the sidebar heavy for a handful of stories (the bookshelf layout was the runner-up),
  or orders and a marketplace need a different top level.

### D49. An author archives a story instead of deleting it; families keep their books — Made (2026-11-20)

- **Why (Sid):** "we should be able to delete (or at least archive) a story as the author so it doesn't show up for
  users to create new books."
- **What:** the existing `archived` value of `story.status` (no migration). The author archives a published story from
  its Studio page after a confirmation, and restores it with one click. Archived: not in `listPublishedStories`, not
  readable by families (`readableStoryVersion`, so `/stories/<slug>` is not found), and `createBook` refuses it inside
  its per-family lock. Its author still reads it, previews it (with a notice and no make-a-book button), drafts and
  publishes versions, which keep it archived until restored.
- **Existing books keep working:** books load by ID, not through the catalogue rule, and `canReadStoryAsset` also lets
  members of a family with a book of a version read that version's files, so pages, proofs, and reprints draw.
- **Not deleting:** books and proofs pin versions (`onDelete: restrict`), and a hard delete would break families'
  books. Nothing is deleted; whether to offer deleting a never-published draft, or a story nobody made a book of, is
  Sid's call.
- **Reopen if:** authors need a hard delete, families should be told a story they have was archived, or archiving
  should also stop new proofs of existing books.

### D50. The picker is one ordered sequence of single choices; no whole-look presets — Decided (Sid, 2026-11-20) / Made

- **Why (Sid):** "Start from a look" was confusing: picking one replaced every axis, so a parent working down the
  steps lost what they'd already chosen below it, and after one tweak no preset showed as chosen. This replaces D26's
  "starts from a few curated looks".
- **What:** Age → Skin tone → Face → Features (teen and up) → Hairstyle → Hair colour → Facial hair (adult and up) →
  Extras (glasses, young child and up), numbered, skipping steps the age doesn't draw. Skin tone comes early because
  every thumbnail is drawn on the current look; hair colour sits with hairstyle (a baby gets colour only). Each choice
  changes only its own axis; age keeps everything else, as before. A new character (and the landing demo) starts
  from one `defaultLook`, so the preview is never empty. The per-book picker keeps "Use <name>'s saved look" as its
  only whole-look reset. The same picker serves the character form, a story's try-a-look, the per-book picker, and
  the landing demo.
- **Hidden choices come back (Sid):** an age that doesn't draw glasses or facial hair sets them to none, and the
  picker remembers them for as long as it's open, so teen → toddler → teen keeps the glasses. The look itself never
  holds a choice the parent can't see: a page that pins a role to an older age would draw it. A choice the age hides
  is not saved.
- **Reopen if:** parents testing it want a quick start again (then offer it before step 2, not mid-sequence).

### D51. Young hair: bald at every age; wispy, soft curls, top knot and puffs for babies to young children — Decided (Sid, 2026-11-20)

- **Why (Sid):** "0–7 are the most likely hero characters … we don't have anything kind of between infant with no hair
  and toddler with a full head of hair." Every baby was drawn bald (`partAxesAt("baby")` was empty) while the picker
  still asked for a hair colour; toddlers had only full-head styles. Research (thread
  T-01a1f6cc-1614-7455-9bf1-b3c1e843c2ba, artifact "Young characters (0–7)"): Wonderbly's baby characters all have
  wisps or tufts, and pediatric sources say sparse hair until 1–3 is normal.
- **What (Sid chose each):** `hair:none` (Bald) at every age, with no part (the base is bald), and the hair colour
  step hidden while chosen; `hair:wispy` and `hair:soft-curls` at baby, toddler and young child; `hair:sprout`
  (Top knot) and `hair:puffs` at toddler and young child. Babies have a hairstyle part now, and no full-head style
  (those start at toddler; thick-haired babies can come later). Babies and toddlers list hairstyles in the order hair
  grows in, whatever the pronouns; from young child up pronouns order them as before (D29, D43). The
  picker's single-choice steps (D50) gain this: a hairstyle the new age lacks becomes the nearest one there and comes
  back with an age that has it, as hidden glasses do. A very short "fuzz"
  was tried and left out: faint, it doesn't show; strong, it reads as the buzz cut.
- **Options by age:** a `LookOption` may list `ages`; coverage (`vocabularyGaps`, `uncoveredOptions`), the figure
  editor's cells, part requests and the picker use only the options an age offers (`optionsAt`). A look that changes
  age keeps the nearest hairstyle there (`hairAt`: short to wispy, curly to soft curls, and back), and a page that
  pins another age (D29) draws that nearest one.
- **Compatibility:** the new options carry `addedAt` (D43), so Moon Picnic and The Paper Boat keep publishing and
  importing; `/author` lists wispy, soft curls, top knot and puffs as uncovered for their young-child hero until
  additions draw them (D41). A baby figure without baby hair parts was drawn before D51 and still draws bald
  (`figurePartAxes`); a version published since must draw every baby hairstyle. Migration `0016_young_hair` sets
  every saved baby look, book change, stand-in and stored proof cast to `hair:none`, which is what they drew.
- **Sparse hair shows scalp on purpose:** `SPARSE_HAIR` (wispy, soft curls, top knot) is exempt from the portrait's
  `crownGap` check; the part prompts ask for distinct strands clearly darker than the skin (D43's stubble lesson).
- **Portrait art:** 20 parts (each style on every base that offers it), made with the app's part prompt and
  `cutOutLayer` at twice the stored size, reviewed on the lightest and darkest skin with no retakes, then put
  through `build-outline.ts`; US$1.05 on OpenAI. Their small skin layers were dropped, as no portrait part has one.
- **Reopen if:** families with babies born with a full head of hair ask for it (add short and curly at baby, dated),
  or the sparse styles don't survive an illustrator's story art.

### D52. An option leaves the vocabulary by retiring, never by deletion; stubble is retired — Decided (Sid, 2026-11-20) / Made

- **Why (Sid):** stubble "read as patchy" on every face after two rounds of edits (D43's retake, then 8 redraws for
  US$0.42): "Lets delete and then I can republish", and "we should establish a strategy for handling things like
  this in the future". Deleting an option ID outright breaks what already names it: published manifests and their
  additions (The Paper Boat v6 has stubble parts on two poses, revision 2 on a third), which never change, fail the
  manifest check for an unknown option; and saved looks, book changes and stand-ins (`character.look`,
  `book_cast.look_override`, `look_changes`) stop decoding, so those books and characters fail to load.
- **How:** `RETIRED_OPTIONS` maps a retired ID to its replacement (stubble → no facial hair). The option leaves
  `lookVocabulary`, so the picker, coverage checks, part requests and the figure editor no longer know it, and the
  picker's portrait parts for it are deleted. Its axis schema still accepts the old ID and decodes it as the
  replacement, so a saved look reads as the replacement and is written back that way at its next save; no migration
  and no production write. A published version's parts for a retired option stay valid and are never drawn, so no
  version is republished for a retirement (a republish only drops dead parts). A retired ID is never reused.
- **Reopen if:** a retired option has no sensible replacement (then a book asks for a stand-in, like an unsupported
  option), or stubble returns with art that survives the cut-out: give it a new ID.

### D54. Book format 3: a page's text is a list of text frames placed in inches — Decided (Sid, 2026-11-20) / Made

- **Why (Sid):** "lay out stories exactly how we want them", with "multiple text boxes in different locations" that
  an author moves around. Format 2 placed one panel of paragraphs by one of three layouts (D24), dropped typed line
  breaks, and had no position or size per block. Sid weighed three shapes: optional boxes on format 2's blocks (A),
  a `free` layout (B), and frames (C). He chose C for the best design going forward over backward compatibility.
- **How:** a page has `art` (`full-bleed` or `left-half`) and `frames`, in reading order. A frame has a `frameId`, a
  `box` (`xIn`, `yIn`, `widthIn`, `heightIn` from the trim's top-left), `valign` (top, middle, bottom: the edge the
  text keeps to as a family's names make it longer), `panel`, and `paragraphs` (format 2's blocks). BookPage draws
  each frame at its box with one panel as tall as its text; lines break where text was typed (`pre-line`) and where
  they run out of room. Publishing rejects a frame past the safe margin, a frame without paragraphs, and duplicate
  frame IDs. A family's edits still address a page's paragraphs by index, now counted across its frames in reading
  order (`pageText`), so `book_text_edit`, proofs and the database don't change.
- **Format 2 upgrades when read** (`upgradeFormat2`, like format 1): each layout becomes one frame at its old text
  area (`presetFrame`: the safe area keeping to the bottom or top on a panel, or the right half's safe area, centred,
  without one) holding the page's paragraphs. Stored rows aren't rewritten. Inches, not thousandths, so the upgrade
  is exact. Measured 2026-11-20: proofs of both published samples (9 pages, all three layouts) with format 3 have
  word boxes identical to `main`'s (`pdftotext -bbox`, 85 and 122 words) and 0 pixels off by more than 5%. Format 2
  printed a typed break as a space, so the upgrade turns breaks into spaces.
- **Authoring:** the Pages tab lists frames with inch fields, anchoring, panel and their paragraphs, and adds frames
  from presets (format 2's layouts, or a small frame to place). On the preview a frame drags to move, its 8 handles
  resize it, and focused it moves with the arrow keys (0.01 in, Shift 0.1 in; Alt resizes). Everything stays in the
  safe area. Both editors warn when text runs past its frame; proofs still print, since a long name in one family
  shouldn't block their book.
- **Checked:** `verify proof` reads words from frames and also compares each word's top with the median offset of
  its size across the book (limit 1 pt: the screen places lines on half CSS pixels; a frame printed 2 pt off fails).
  A two-frame page with a family edit printed with 88 words on the same lines, Δx 0.01 pt, Δy 0.43 pt.
- **Not now:** rotation (an optional frame field later, without a new format version; pdftotext splits rotated
  words, so the word check would measure frames unrotated), inline bold and italic, per-frame text style overrides.
- **Reopen if:** a real story needs text flowing from one frame into the next, or text along a path.

### D31. Object keys live under their owner's prefix; the app sweeps expired objects; no family deletion yet — Decided (Sid, 2026-11-19)

- **What:** every object key starts with its owner: `families/<familyId>/` (proof PDFs, anything holding family
  data), `stories/<storyId>/v<n>/` (story assets and the recolour cache). The bucket listing is the inventory; no
  table records each object. The `storage.sweep` task deletes everything under `families/<id>/` once that family no
  longer exists. (Until 2026-11-19 a home-page "Worker check" wrote `samples/<taskID>`, swept after 7 days; it's
  gone, since proofs and parts exercise the worker and the heartbeat tells the post-deploy check one runs, and the
  sweep now deletes every leftover sample with its `generation` row.) Each
  worker spawns it at start and every 6 hours, with the 6-hour period as idempotency key (Absurd has no scheduler,
  D4). Story assets and the recolour cache stay; a live family's proofs follow D32 (approved: kept; unapproved: 30
  days, row and PDF), and a proof PDF whose row is gone is deleted. Family deletion is off
  (`disableOrganizationDeletion`) until account deletion is designed, since it would leave the owner without a
  family (D3).
- **Why:** before this, nothing ever deleted an object, and Better Auth's family delete orphaned the family's PDFs
  (children's names and looks) in the bucket. Bucket lifecycle rules can't do this: Railway's buckets don't support
  lifecycle configuration (their docs, checked 2026-11-19), R2 lacks it in its S3 API, and a rule can't express "when
  the family is gone" (D7). Deleting by prefix also removes objects no row points at.
- **Rejected:** a `stored_object` table with one row per object (owner, purpose, bytes, expiry): a migration, a
  backfill, a wrapper on every write including Modal's presigned PUTs, and still a reconciliation sweep, because the
  row and the object can't be written atomically.
- **Reopen if:** we need per-family storage accounting, quotas, or deletion receipts (add the table on top of these
  keys), a new kind of object can't live under one owner's prefix, or listing `families/` gets slow.

### D32. A parent approves a book's proof once, with who and when; unapproved proofs expire after 30 days — Made (2026-11-19)

- **Approval:** `proof.approved_at` and `proof.approved_by` (migration 0008, two nullable columns). The book page's
  proof list has "Approve for print" next to each ready proof's download link, for roles that edit books (owner,
  parent); a viewer sees who approved it and when, and downloads it, but can't approve. Only a ready proof of a book
  can be approved: an older story-preview proof (D45) has no book to print. Approval is final and happens once: approving again
  keeps the first approval, and there is no "unapprove", because a print order will point at the approved proof and the
  PDF it approved never changes (D27). A book can have several approved proofs (one per round of changes); an order
  will name the one it prints. Approving doesn't require the download to have happened: the UI asks the
  parent to download and check it first, and checking can't be proven anyway.
- **Retention:** an approved proof (row and PDF) stays as long as its family or its book (D45), or until a parent
  deletes it (below), because orders will reference it and it records what was printed. An unapproved proof is a draft: the `storage.sweep`
  task (D31) deletes its row 30 days after it was made, then deletes every `families/<id>/proofs/<proofId>.pdf` whose
  row is gone. The list shows each draft's deletion date. 30 days gives a parent time to come back to a proof, while a
  new one takes seconds to make (D27); a draft holds the children's names and looks, so it shouldn't stay forever.
  The row is written before its render task starts, so a PDF without a row is always one whose proof expired or was
  deleted.
- **Deleting a proof (Sid: "there is no way for a user to delete a proof"; Made, 2026-11-20; approved proofs: Sid,
  "a parent should be able to delete an approved proof"):** an owner or parent deletes any proof of a book,
  rendering, failed, ready, or approved, from its proof list after a confirmation that names its cast and time; for an
  approved proof it also names who approved it and when, and says the approval goes too and printing needs a new
  approved proof (`deleteProof`, `packages/core/src/proofs.ts`). The row goes first, then its render task is
  cancelled and its PDF deleted; a render already mid-step can still write the PDF, and the sweep deletes it like an
  expired one. A viewer can't (Forbidden); another family's member and an unknown ID get NotFound. Approval stays
  final in that it can't be withdrawn while the proof exists. No print order references a proof yet; once one
  does, deleting an ordered proof must be refused (it records what was printed), as with D45's book deletion.
- **Rejected:** keeping only the newest unapproved proof per book (a parent comparing two drafts loses one without
  warning); deleting older drafts when one is approved (it surprises a parent who wanted the other); a
  per-proof `expires_at` column (a constant TTL from `created_at` says the same with no backfill).
- **Reopen if:** print orders need approval to expire (for example a proof approved months before ordering), parents
  ask to withdraw an approval, or families ask for drafts to be kept longer.

### D35. The proof is the print-ready file: flattened art at 300 ppi, live text, TrimBox and BleedBox, checked against Lulu's requirements — Made (2026-11-19)

- **Lulu's requirements** (checked 2026-11-19: help.lulu.com "PDF Creation Settings", modified 2026-09-25; the Lulu
  API getting-started guide; Lulu's Interior Job Options file; the Print API's interior validation): one PDF of single
  pages, all one size, at least 2; page = trim + 0.125 in bleed per side; no crop or bleed marks; no security; every
  font embedded; images at 300 ppi, 600 at most; transparency flattened (the job options export PDF 1.3 with
  transparency off); sRGB preferred, 8 bits per channel; layers flattened. **PDF/X isn't required** (the job options
  turn the PDF/X checks off). TrimBox and BleedBox aren't on Lulu's list, but every prepress tool reads the trim from
  them and they cost nothing, so print-ready files carry them.
- **How:** `proof.render` (D27) still prints the print page with Chromium, with two changes in `printPdf`
  (`packages/core/src/print.ts`): with the words hidden, it captures each page at 300 ppi (device scale 300/96) as
  one opaque JPEG (quality 95) of the paper, every illustration layer, and the text panel, composited by Chromium as
  on screen; then it swaps that image in as the page's background, hides the layers and the panel's fill, and prints.
  Each page is one opaque image plus live text in the story's embedded fonts, so nothing is left to flatten and text
  stays vector. Then `setPrintBoxes` (pdf-lib) sets each page's TrimBox to the trim and its BleedBox to the page, and
  `checkPrintReady` (`packages/core/src/print-ready.ts`) checks the file against `LULU_INTERIOR`; the render fails
  (and retries) on any issue, like a page-count mismatch, so a stored proof is always print-ready. The check reads
  the PDF with pdf-lib and walks every content stream to measure each image where it's drawn; unit tests break
  each requirement on purpose, and `proofs.spec.ts` runs it on a downloaded proof.
- **Why one file, not a separate print file:** the parent approves the PDF that will print, byte for byte, so
  approval (D32) needs nothing new, retention and the object key stay as they are, and there's no second render to
  drift from the first. Flattened proofs look the same on screen (page 4 old vs new: 1.3% of pixels differ by more
  than 5%, all anti-aliased edges, at 80 dpi).
- **Rejected:** Ghostscript `pdfwrite` at PDF 1.3 (another binary in the worker image, AGPL, and it rasterises the
  text where transparency overlaps it); compositing the art in sharp (a second renderer that could disagree with
  BookPage, against D12); rendering a separate file at approval (above).
- **Measured 2026-11-19** (the sample story, `a1.small`): 6 pages of 630 × 630 pt with TrimBox [9 9 621 621]; one
  2625 × 2625 JPEG per page at 300 ppi in ICC sRGB, no soft masks, no opacity below 1; Literata Regular and Bold
  embedded as CID TrueType; 1.1 MB (0.84 MB before); a render takes 2.7–3 s (1–1.6 s before). The watercolour Paper Boat: 7.2 MB for 3
  pages. poppler's `pdfimages`, `pdffonts` and `pdfinfo -box` agree.
- **Left for print ordering:** proofs made before this aren't flattened, so an order runs `checkPrintReady` on the
  proof's PDF before sending it (or re-renders it). The page count each binding needs, page 1 printing on the right,
  and the cover file come with the product chosen at order time. Painted art gives bigger JPEGs
  (an estimate of 1–3 MB per page); Lulu recommends under 500 MB.
- **Trim (Sid, 2026-11-19):** Lulu wants text 0.5 in inside the trim, since trimming varies by up to 0.125 in. A new
  story version must have `safeMarginIn` ≥ 0.5 and Lulu's 0.125 in bleed (`printTrimIssues`, checked by
  `importStoryVersion` like static fonts, so stored versions stay readable). Moon Picnic v5 moves from 0.375 to
  0.5 in; on its proof the closest word sits 0.519 in inside the trim. The Paper Boat already used 0.5 in.
- **Reopen if:** a print provider needs PDF/X or CMYK; Lulu rejects or normalizes a proof; flattened art at 300 ppi
  looks soft in print (then a higher resolution, up to Lulu's 600); or files of real art get too big to download.

### D37. Story authoring: the operator and accounts the operator grants write stories in the app — Decided (Sid, 2026-11-19) / Made

- **Who may author (Sid, 2026-11-19: a table, not a column on `user`, because it sets up studios):** the operator (admin role) always, and any account the operator lets author on
  `/author` ("Authors"), recorded in `story_author` (user, granted by, when; migration 0011). Revoking stops new work;
  the author's stories stay theirs and published versions stay published. Options weighed:
  - _Operator only:_ simplest, but the brief says nothing may assume Sid is the only author, and illustrators need
    to upload their own art.
  - _Any signed-in account:_ every invited parent could publish into every family's catalogue, which is public
    authoring before moderation exists (brief, "Coming later").
  - _Studios now_ (an organization `kind`, plan.md "How Coming later fits"): the right shape for groups of authors and
    illustrators later, but it changes how every family query filters organizations today, for a feature with one or
    two authors.
  - _A Better Auth admin-plugin role "author":_ a user has one admin-plugin role, shared with the operator's, and the
    plugin's role is about managing users, not content.
    A column on `user` was also weighed: one less table, but it records only when (not who granted it) and puts our
    domain data in Better Auth's table. Chosen: the grant table. Studios (organizations of authors and illustrators)
    later grant authoring through their membership next to it, with nothing to
    migrate. A published story is in every family's catalogue at once; Sid, 2026-11-19: fine as long as moderation
    stays in the plan (plan.md, "How Coming later fits": a review state on `story_version` that gates publishing).
- **Drafts are unpublished `story_version` rows:** a story has at most one (a partial unique index on `story_id`
  where `published_at` is null) with a `revision` counter each save bumps, so a save from a stale tab fails with
  `DraftChanged` instead of overwriting. Publishing sets `published_at`; from then on the row never changes (D24).
  This is the row D36's `story_part` points at, so part generation needs no second key. Books, previews, and the
  catalogue read only published versions (`readableStoryVersion`). The manifest of a draft is a `StoryDraft`, the
  book format's shape without its completeness and cross-reference checks, so work in progress saves;
  `StoryManifest` is that schema plus the checks (and now also requires a page, a layer per page, and a base per
  figure, which the shape used to). Files upload to `stories/<storyId>/v<n>/` (D31's owner prefix), named with a
  hash of their bytes, so a published version's paths never point at changed bytes and the recolour cache (keyed by
  path, D24) stays correct. Only the author reads an unpublished version's files (`canReadStoryAsset`).
- **New stories start with Lulu's trim** (0.125 in bleed, 0.5 in safe margin), and publishing refuses a version
  without them (`printTrimIssues`, D35), as importing does.
- **Uploads:** a server route, `POST /api/authoring/stories/<storyId>/assets` (multipart), checks the author, the
  folder (`fonts`, `pages/<pageId>[/<slotId>]`), the type by its bytes, size (40 MB art, 5 MB SVG and fonts), and
  that a font is static (D24). It needs an `x-lifestory-upload` header, so a cross-site form can't post to it. This
  is the authenticated upload endpoint D33 left for the author tooling.
- **Generated parts (D36) keep their review in `story_part`**, the one approve button for them: the saved draft never
  holds the parts generated for it (a save drops them; parts a published version carried into the next draft stay as
  ordinary parts), every read merges approved and waiting parts in
  (`withGeneratedParts`, built on D36's `manifestParts` and `withApprovedParts`; an approved part beats one waiting,
  and each replaces an uploaded part for the same option), and publishing writes the merged manifest, so the
  published version holds them as ordinary approved parts. Uploaded parts keep their approval in the manifest. The
  editor's parts grid generates any empty cell that has a base, or every one at once, inside a head zone the author
  sets, shows the result on the lightest and darkest skin with its cost, and approves, rejects, or tries another seed.
  Generating needs the draft saved (the task reads the stored figure) and one figure of the role on the page (D36).
- **Publishing** runs what the seed's import runs (format checks, every part approved, `vocabularyGaps`, static fonts,
  Lulu's trim)
  plus "every referenced file is stored", publishes the story if it wasn't, and deletes the version's files nothing
  references, except the recolour cache and generated parts' files (their review record). "Start version n+1" copies
  the newest version's files into a new draft.
- **The editor** (`/author/<storyId>`, no server rendering) shows the selected page with BookPage, the component the
  book editor and the PDF use, with each role played by its example, or by a family member of an age the role accepts
  ("Preview as", Sid 2026-11-19; preview only, never saved). Text and pictures follow unsaved edits: the server
  composes the draft as edited a quarter second after the last change (`previewDraft`), leaving out a figure that
  can't draw its look yet.
- **Reopen if:** studios arrive (authoring through studio membership), authors need to work on one story together,
  moderation needs a review step before a version reaches families, or uploads need to go straight to storage
  (presigned PUTs) because art outgrows the 40 MB limit.

### D42. Story art comes in as the illustrator made it and is turned into the format by an import the author reviews — Decided (Sid, 2026-11-19) / Made

- **What (design: the "Story art import design" artifact in thread T-01a1f4cb-9c6d-7743-8aea-3999570d90f1):** authors
  draw in their own tools and bring a layered file (PSD, which Photoshop, Procreate, Krita, Affinity and Clip Studio all
  export), several PNG layers, or one flat picture per page. The `/author` page tab's import turns it into what D24 and
  D26 already define, as ordinary draft files the author applies to the page: the plate (and foreground), the figure's
  box, a bald base in neutral skin tones with its skin mask and face overlay (and occluder), and the drawn hair as the
  part for the hairstyle the author names. "Draw the other face type" makes the next base from it, and the part pipeline
  (D36) draws every other option. Nothing in the book format, the database or the vendors changes.
- **How:** one Absurd task, `page.import` (`packages/core/src/imports`), in steps a rerun repeats harmlessly; the editor
  follows it with `Jobs.status` (no table). Layers are stacked by the use the author gives each (suggested from its name).
  A flat page goes through the D30 provider twice, "remove the character" and "make them bald", and D36's
  known-background cut-out separates them against each edit. The skin mask is a colour model of the skin (Lab, a
  histogram peak among warm colours refined to 3σ) with the features it encloses and the ink outline around it; blush,
  lips and an open mouth go to the overlay by their redness over the skin around them, unmixed against it; the skin's
  tones map so its median lands on the palettes' 0.77. Everything is reviewed on the lightest and darkest skin before it's
  applied, and every file stays replaceable by an upload. PSDs are read in the browser (ag-psd, MIT) with its advice for
  files from outside (structure first, sizes checked, one layer decoded at a time), so the server never parses one.
- **Measured (2026-11-19, gouache art drawn outside the app with OpenAI, US$0.17 for the art):** a PSD with a hair layer
  imports with no model call; a flat page took two edits (US$0.099), the other face type one (US$0.047). On the darkest
  skin the blush stays rose and the open mouth keeps its colours. `art-import.spec.ts` runs both paths with the fake
  provider, through publishing and a family's book.
- **Model-drawn hidden pixels are allowed, author-reviewed (Sid, 2026-11-19; amends D26):** the import keeps the
  author's pixels everywhere visible, but a flat page's plate behind the figure and the scalp under drawn hair come from
  the model; the author reviews both and can replace either. Rejected: flat pages only propose, and the author uploads
  their own plate and bald base for every page.
- **Rejected for now:** an in-process segmentation model (BiRefNet, SAM 2: a 100–900 MB model and 1–2 GB per run in the
  worker, and it still needs inpainting), a hosted segmentation API (a vendor sign-up), reading PSDs on the server.
- **Reopen if:** the provider's removals miss parts of figures often (then a segmentation prior), colour masks fail on
  real illustrators' palettes (then a mask brush), or plates need full resolution behind removed figures.

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
  The Modal callback is a server route. The book editor (`/books/$bookId`) sets `ssr: false`.
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
- **Screen vs print, 2026-11-19:** the Paper Boat proof printed words up to 3.4 pt right of where the editor drew
  them, with identical line breaks. Cause: the worker's Chromium headless shell lays text out with each word rounded
  to whole CSS pixels, while Chrome uses the font's fractional advances (reproduced at device scales 1, 2 and 3.125,
  and in print media; the headless shell's own screen layout and PDF agree exactly). BookPage text now sets
  `text-rendering: geometricPrecision`, which makes the headless shell use fractional advances and leaves Chrome's
  layout unchanged: editor and PDF agree within 0.01 pt on every word. A renderer setting, not a layout-engine
  limit, so this doesn't meet the reopen condition. Unchecked: the editor in Safari and Firefox (no WebKit or
  Firefox in orbs).
- **Reopen if:** real screen-versus-print mismatches show up (then precomputed layout, per the brief).

### D13. One image provider interface; a deterministic fake provider by default — Recommended

- **How:** `ImageProvider` service in `packages/core/src/image-provider.ts`. The fake renders an SVG whose colours
  derive from a hash of the request key, so retried steps write byte-identical objects.
- **Reopen if:** never expected.

### D14. Generation as an Absurd workflow that suspends for Modal's callback and for the illustrator's approval — Recommended

- See [plan.md](plan.md#authoring-time-part-generation-later-milestone). Since D26 it runs at authoring time only. The fake provider goes through the same suspend-and-callback path
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

### D53. oxfmt formats the repository; `mise run check` enforces it — Decided (Sid, 2026-11-20)

- **How:** `oxfmt` 0.79.0, pinned in the root `package.json`, configured in `.oxfmtrc.json`: 120 columns, the width
  the comments and docs are wrapped to (a formatter doesn't rewrap comments, so narrower code would sit next to wider
  comments); Markdown prose left unwrapped and its code blocks left as written (their examples are hand-aligned and
  commented). Markdown tables wider than 120 columns carry `<!-- oxfmt-ignore -->`, because aligning them pads every
  cell to its column's widest one (AGENTS.md went from 20 KB to 46 KB, mostly spaces, and agents read it every
  thread). `ignorePatterns` leaves alone the tracked files other tools write. `mise run format` rewrites;
  `mise run format:check` is part of `check`, so CI fails on unformatted files. `.editorconfig` and `.vscode/` give
  editors the same settings and format on save. The whole repository was reformatted once, in its own commit.
- **Why oxfmt (compared 2026-11-20):** chosen as the best long-term base, not for the smallest diff.
  - It is the formatter of the toolchain we already run: Oxc, the project behind oxlint (D15) and the compiler under
    Vite 8's Rolldown; Vite+ 1.0 (stable since 2026-09-28) ships it as the formatter of `vp check`. Projects such as
    vuejs/core, Turborepo, and sentry-javascript format with it.
  - It takes Prettier's output as its baseline and passes Prettier's JS/TS conformance tests, so it formats like the
    reference, but fixes Prettier's inconsistencies instead of copying them (documented divergences).
  - It formats every file type here, including TOML (`mise.toml`), which Prettier doesn't. It ran in 0.3 s on this
    repository; Prettier 3.10.1 took 7 s.
  - It has built-in Tailwind class sorting, import sorting, and `package.json` key sorting, which Prettier needs
    plugins for. All three are on. Imports are grouped (Node built-ins, packages, then relative) and sorted;
    side-effect imports keep their place (`sortSideEffects` is off), since they run in order. Tailwind classes are
    sorted in `className` and in calls to `cn`, `cva`, and `clsx`, against `apps/web/src/styles.css`. Turning both on
    was its own commit: every changed file differed only in order, and no class string resolved differently under
    `tailwind-merge`, which keeps the last of two conflicting classes.
  - Against it: it is 0.x (beta since 2026-02-24), so an upgrade can change output. The exact pin means an upgrade
    happens only on purpose, in its own commit with what it reformats.
  - Prettier 3.10.1: the stable reference, but about 20× slower here, no TOML, and its known inconsistencies stay.
    Biome 2.6: stable and fast, with Markdown (about 92% Prettier-compatible) and YAML since October, but it is a
    second toolchain with its own linter to switch off next to oxlint.
- **Reopen if:** an oxfmt upgrade breaks formatting we rely on and the fix stalls, or Oxc stops maintaining it.

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
- **Migrations:** a separate command (`node packages/db/src/migrate.ts`) run before each release (Railway's
  pre-deploy command), not on container start, so a failed migration stops the release instead of crash-looping,
  and replicas don't race. Both images run it, because with deploys from `main` (below) the two services release
  independently and either may start first. It holds a Postgres advisory lock (Drizzle's migrator takes none), so
  the second run waits and then finds nothing to apply (Sid, 2026-11-19).
- **Railway:** `.railway/railway.ts` (Railway Infrastructure as Code, `railway` SDK 3.17.0) declares the services,
  Postgres, the bucket, and variables. `railway.json`/`railway.toml` are deprecated and stop being read on
  2026-12-01 (Sid, 2026-11-18). Both services deploy each push to `main` from the GitHub repo once its checks pass
  (`checkSuites`; Sid, 2026-11-19). Railway's GitHub app was installed by hand: a project token can't connect a
  repo, which is why deploys used `railway up` until then.
- **Storage URLs:** `S3_FORCE_PATH_STYLE` (default true for SeaweedFS); Railway buckets need virtual-hosted style.
- **Reopen if:** a release needs steps the pre-deploy command can't run, or a migration must finish before a
  service's new code starts in a way the lock doesn't give (for example a destructive change the old code can't
  survive).

### D34. A post-deploy check of the live site runs after every production deploy, without signing in — Made (2026-11-19)

- **What:** `.github/workflows/deploy-check.yml` runs `apps/web/scripts/check-deploy.ts` (`mise run deploy:check`)
  when Railway reports a production deploy on GitHub. It waits up to 25 minutes until `/api/health` reports the
  deployed commit for the web app
  and for a worker, then checks: health is ok with as many migrations as the commit's journal; `/sign-in` loads and
  every stylesheet, font (preloaded or named in the CSS), and script it links returns 200 with a non-HTML type (the
  failure in commit fbd8a10); every `/__dev` route is 404 (D17). It lists every failure and fails the run, which
  shows on the commit and in Actions but emails nobody: the run is `railway-app[bot]`'s, and GitHub emails a failed
  run only to its actor. Sid chose that over an alerting issue (2026-11-19: "extra process"). A failed
  Railway deploy is checked without waiting, so it fails too. If a newer commit is already live, the run passes as
  superseded.
- **Version and worker heartbeat:** both services read their commit from `APP_VERSION`, else Railway's
  `RAILWAY_GIT_COMMIT_SHA`. Each worker process upserts a `worker_heartbeat` row (migration 0009) every 30 s with
  its commit; `/api/health` adds `version` and `workers` (those that beat in the last 90 s: commit, start time,
  seconds since the last beat). Health stays ok without a worker, so Railway's healthcheck judges the web app alone.
  All of it is public, like the migration count: a commit SHA of a public repository and worker uptimes.
- **Why Railway's `deployment_status`, not `workflow_run` after CI:** Railway's "Wait for CI" holds a deploy until
  every Actions workflow run on the commit has finished, and skips it if one fails. A check started after CI is one
  of those runs: it waited for the deploy while the deploy waited for it (seen 2026-11-19 on 165ba0a and dc95252,
  released by cancelling the runs). Railway posts `success`/`failure` per service only after deciding to deploy,
  so a check started then can't hold the deploy back. Also because of Wait for CI: a manual "Run workflow" on `main`
  while a deploy is waiting would hold it, and its failure would skip it. Not caught: a deploy Railway never starts
  (CI failures already email the pusher). No Railway token and no new service.
- **Reopen if:** agents get a production login (then add signed-in checks), deploys take longer than 25 minutes, or a
  failed check goes unnoticed (then notify, for example with an issue mentioning Sid).
- **Possible later (Sid, 2026-11-19: not now):** signed-in steps through the verify CLI, such as
  `mise run verify -- picker --config live` and `proof --config live` as the agent family (D38). They need the agent's
  email and password as GitHub secrets, and `proof` writes a proof row in the agent family each run.

### D20. Orb sizes: `a1.small` for light work, `a1.medium` for full-stack verification — Made

- **Why:** measured peak of ~3.4 GB of 4 GB on `a1.small` with services, browsers, e2e, and typecheck running at once
  (AGENTS.md, "Orb size"). Milestone 1 adds server-side Chromium for PDFs.
- **Reopen if:** memory use changes enough that the numbers in AGENTS.md no longer hold.
