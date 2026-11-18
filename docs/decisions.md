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
  returns 403 for the operator. `emailAndPassword.disableSignUp` is on: accounts come only from invitations or seeding.
- **Reopen if:** Better Auth drops organization roles or custom admin access control.

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
- **Reopen if:** revenue approaches the license threshold, or quality on children's-book character consistency is poor.

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
- **How:** Better Auth at `/api/auth/$`, file downloads at `/api/files/$`, dev sign-in at `/dev/log-me-in/$email`.
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
- `GET /dev/log-me-in/<email>?returnTo=<path>` finds or creates the user, signs in through Better Auth's real
  email-and-password endpoint (so the cookie is the normal session cookie), and redirects only to same-origin
  relative paths. Returns 404 unless `DEV_LOGIN_ENABLED=true` and `NODE_ENV !== "production"`.
- **Reopen if:** never expected; remove from production images in milestone 1's Dockerfiles.

### D18. Postgres tuned for speed in development (`fsync=off`, `synchronous_commit=off`) — Made
- Local and CI data is disposable. Production uses the host's managed Postgres defaults.

### D20. Orb sizes: `a1.small` for light work, `a1.medium` for full-stack verification — Made
- **Why:** measured peak of ~3.4 GB of 4 GB on `a1.small` with services, browsers, e2e, and typecheck running at once
  (AGENTS.md, "Orb size"). Milestone 1 adds server-side Chromium for PDFs.
- **Reopen if:** memory use changes enough that the numbers in AGENTS.md no longer hold.
