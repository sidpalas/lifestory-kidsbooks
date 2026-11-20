# AGENTS.md

Lifestory: parents personalize human-written picture books with their own family as characters.
Read [docs/brief.md](docs/brief.md) (the product brief), [docs/decisions.md](docs/decisions.md)
(decisions and what would reopen them) and [docs/plan.md](docs/plan.md) (milestone 1 plan)
before changing anything structural. Decisions change only with new evidence: report the
evidence and a proposal, don't switch on your own.

## Layout

<!-- oxfmt-ignore -->
| Path | What |
| --- | --- |
| `apps/web` | TanStack Start app (React, Tailwind, shadcn/ui). Server functions in `src/server`, server routes in `src/routes/api` and `src/routes/[_][_]dev` (URL `/__dev`; a bare leading `_` would make a pathless layout). |
| `apps/worker` | Absurd worker. Registers every task from `@lifestory/core` and runs it through the shared runtime. |
| `packages/core` | `@lifestory/core`, the "shared package" in docs/brief.md: Effect services and layers for config, database, auth, storage, image provider, jobs, domain logic, tasks, seed. `src/contracts.ts` is the browser-safe subset; `src/testing.ts` holds test helpers. |
| `packages/db` | `@lifestory/db`: Drizzle schema and migrations (including the vendored Absurd SQL). No services or domain logic. |
| `modal` | Python: FLUX 3 Image Klein on Modal (`modal/flux_klein.py`), the real `ImageProvider` behind `IMAGE_PROVIDER=modal`. |
| `fixtures/stories` | Sample stories (book format manifest, placeholder art, fonts) that `db:seed` imports. |
| `compose.yaml` | Postgres 18 and SeaweedFS (S3 API on :8333). |
| `apps/*/Dockerfile`, `.railway/railway.ts` | Production images (build from the repo root) and the Railway project they deploy to. Redeploying: README "Deploying". |

## Commands and how long they take

Tool versions (Node, pnpm) are pinned in `mise.toml`, and every command is a mise task: `mise tasks` lists them,
`mise run <task>` runs one with `.env` loaded and `node_modules/.bin` on `PATH`. In an orb, `mise`, `node`, and
`pnpm` are already on `PATH`. Before handing work back, run `mise run check`, plus `mise run test:e2e` for any change
to app behaviour; docs-only and other small changes that can't affect a running app need only `check`.
Times measured on an `a1.small` orb.

<!-- oxfmt-ignore -->
| Command | What | Time |
| --- | --- | --- |
| `mise run check` | `typecheck`, `lint`, `format:check`, and `test` in parallel | ~18–24 s |
| `mise run typecheck` | `tsc` (TypeScript 7) over every package, one checker each (`--checkers 1`: half the memory, no slower) | ~7–15 s |
| `mise run lint` | oxlint, warnings fail | <1–3 s |
| `mise run format` | oxfmt formats TS, TSX, JS, JSON, CSS, Markdown, YAML, and TOML in place (D53) | <1 s |
| `mise run format:check` | oxfmt lists the files `format` would change and fails if there are any; part of `check`, so CI enforces it | <1 s |
| `mise run test` | Vitest unit tests (`packages/*/test`, `apps/*/test`); most of it is importing modules | ~12 s |
| `mise run verify -- <command>` | Drive the real app and keep evidence (`docs/features`): `picker` ~20 s, `proof` ~30 s, `looks` ~25 s in dev; `--config image` first builds both images, minutes on `a1.small` (`--no-build` reuses them) | see each |
| `mise run test:e2e` | Playwright end-to-end tests (28; one test worker where the memory cap is under 6 GiB); `milestone1.spec.ts` walks the whole milestone 1 slice, `parts.spec.ts` generates a part through the worker with the fake provider, `art-import.spec.ts` imports a PSD and a flat page (D42; with `IMAGE_PROVIDER=openai` it runs on real edits, ~US$0.47), `mise run test:e2e -- milestone1` runs only it. Needs Postgres and SeaweedFS migrated and seeded (`.agents/setup` does that, but doesn't start the app). Reuses a web app on :3000 if one is running (the `web` service), otherwise starts one; always starts its own worker, and refuses to run while any other worker beats on the database (the `worker` service, a preview worker with real providers): `amp orb service stop worker` first | 28 tests (`CI=1`, cold Vite cache): 5.5 min on `a1.medium`, 7.2 min capped to 2 CPUs and 3 GiB (2026-11-20; 21 tests took 3.4–3.6 min on `a1.small`); ~45 s for `milestone1` alone, ~70 s with `E2E_PORT=3100` next to the services (measured 2026-11-19). `CI=1` always starts fresh and fails if :3000 is taken: with services running, add `E2E_PORT=3100` |
| `.agents/setup` | Orb setup; idempotent | ~13 s warm, most of it `db:seed`; a fresh orb also downloads images, Node, and Chromium |
| `mise run db:migrate` | Apply Drizzle migrations; idempotent | ~1–2 s |
| `mise run db:seed` | Seed users, family, sample story; idempotent | ~4–7 s |
| `mise run operator:create -- --email <email>` | Create or promote the operator with a one-person family (D21). Prompts for the password; reads two lines from stdin when piped. In production images (no mise): `node packages/core/src/operator-create.ts --email <email>` | ~1 s |
| `mise run story:import -- --author <email> <dir>` | Publish a story directory (`story.json`, `manifest.json`, assets) under an existing account (D33); idempotent. In production images: `node packages/core/src/story-import.ts ...` | ~1 s |
| `mise run deploy:check -- --sha <commit>` | Check the live site runs that commit and serves its sign-in page, assets, health, and no `/__dev` (D34); CI runs it after each deploy. `--url` for another origin, `--wait-minutes` to wait for a deploy | ~3 s |
| `mise run db:generate --name <change>` | Generate a migration after editing `packages/db/src/schema` | ~2 s |
| `mise run dev` | Web app (`dev:web`) and worker (`dev:worker`) in the foreground | ~2 s to ready |
| `mise run stack` | Outside orbs: compose up, migrate, seed, then `dev` | ~15 s to ready |
| `mise run install` | `pnpm install --frozen-lockfile` | ~3 s |

## Verifying your work

`docs/features/README.md` is the feature map: what each feature is, its routes, roles and seed data, and the
`verify` command that proves it. `mise run verify -- <command> [--config dev|image|live]` drives the real app and
writes evidence to `.amp/in/artifacts/verify/<run>/` with a PASS/FAIL line per check; `mise run verify -- help` lists
commands. Pick the configuration by what the change can break: `dev` for every change, `image` (production images
against local data) for builds, Dockerfiles, CSS, and native modules, `live` (the agent family, D38) after a deploy.
Use it before writing a throwaway script; when a check you need is missing, add it to the CLI and the map entry.
Change a feature, update its map file in the same commit. Run the e2e suite as `mise run verify -- e2e [--ci]`: it
holds one port for the web app and the worker that prints proofs, and reports peak memory against the 3 GiB cap.

## Orb size

The OOM killer fires at 3 GiB, not 4 GB: an orb caps everything agents start (commands, `amp orb services`, and
the Docker containers) at `amp-workload.slice`'s `memory.max` = 3 GiB on `a1.small` (2 vCPU, 4 GB, no swap); the
Amp CLI itself runs outside it. What counts is `anon + shmem + kernel` in its `memory.stat`; page cache is
reclaimable and doesn't. Don't read `memory.current` or `memory.peak`: both include page cache, so they sit at the
cap after any big run, and `memory.peak` can't be reset on the orb's kernel (6.1). Sample once a second instead:

```sh
while sleep 1; do awk '/^(anon|shmem|kernel) /{s+=$2} END{print s/2^20 " MiB"}' /sys/fs/cgroup/amp.slice/amp-workload.slice/memory.stat; done
```

Measured 2026-11-20 on `a1.medium` with the workload slice set to a small-equivalent 3 GiB and 2 CPUs
(`sudo systemctl set-property --runtime amp-workload.slice MemoryMax=3G CPUQuota=200%`; restore with 6G and `CPUQuota=`),
full suite (28 tests, one Playwright worker, cold Vite cache). Memory in GiB (1 GiB = 1024 MiB) from the sampler
above; the per-process rows are PSS at the peak, approximate:

<!-- oxfmt-ignore -->
| | Before (`4086b47`, no cap) | After (3 GiB / 2 CPU cap) |
| --- | --- | --- |
| `CI=1` e2e peak (anon + shmem + kernel) | **2.96 GiB**: 0.04 GiB short of a1.small's cap; field runs 2.72–2.92 GiB and OOM kills | **2.58–2.70 GiB**, 28 passed, no retries, 7.2 min (2 CPUs); after `656e789`, **2.56–2.63 GiB**, 32 passed, 8.4 min; on a real `a1.small` at `5372474` (`verify -- e2e --ci`), **2.58 GiB**, 32 passed, no retries, 0 OOM kills, 9.0 min |
| e2e next to the `web` service (reused; `worker` stopped) | killed in the field next to both services | **2.47–2.52 GiB**, 28 passed, 6.5 min; verify waited out the stopped worker's beat |
| `mise run check` during a 40-part round, with both services up | killed 3 times in the field | **2.08 GiB**, check 49 s, 40 parts done |
| Web dev server (`vite dev`) | 1.12 | 0.86 |
| Test browser / Playwright runner + test worker | 0.70 / 0.47 | 0.70 / 0.38 |
| Worker / its print Chromium | 0.47 / 0.20 | 0.21 / 0.30 |
| Worker after a 40-part round (RSS high-water mark, alone) | 0.79–0.89 GB | 0.58–0.63 GB |
| `tsc -p apps/web` | 1.24 GB | 0.66 GB |

What took the memory, and what keeps it down now (don't undo these without measuring):

- **glibc heap fragmentation from sharp** (worker and web server: recolouring, part cut-outs, imports): Node's V8 heap
  stayed at 50–200 MB through a 40-part round while RSS reached 0.9 GB, and it didn't come back. `mise.toml` sets
  `MALLOC_MMAP_THRESHOLD_=131072` for every task, so large buffers are mmapped and returned when freed. Not it: the
  worker's task concurrency (1, 2, and 4 peaked alike), `--max-old-space-size` (the heap isn't what grows),
  `VIPS_CONCURRENCY=1`; `MALLOC_ARENA_MAX=2` and jemalloc helped less.
- **TypeScript 7's four checkers per project**, each with its own copy of the program's types: `typecheck` passes
  `--checkers 1` (TypeScript 7 is already the native, low-memory compiler; there's no lighter full type checker).
- **Two Playwright workers on a1.medium-sized RAM under a 3 GiB cap**: `os.totalmem()` reports the machine, not the
  cap, so `playwright.config.ts` reads the cgroup's `memory.max` to pick one worker.
- **Vite pre-bundling inside the dev server**: its dependency scan followed server functions into `@lifestory/core`
  and pre-bundled playwright-core, sharp, pg, and the S3 SDK for the browser, on the first page view, inside the
  server, which kept ~0.5 GB for good. `vite.config.ts` excludes `@lifestory/core` from `optimizeDeps`, and `dev:web`
  runs `vite optimize` in its own short-lived process first.
- **Contexts the specs never closed** (`browser.newContext()` lives as long as the test browser, i.e. the whole run):
  close any context you open.
- **`@lifestory/core` in the Playwright runner** (~0.2 GB, held for the run because the runner imports every spec to
  list tests): specs that need it `await import("@lifestory/core")` inside the test.
- **SeaweedFS**: `GOMEMLIMIT` in `compose.yaml`.
- **A second worker next to the suite** (the `worker` service, a preview worker): 0.2–0.9 GB more, and it takes the
  tests' tasks with its own provider (one run billed 10 OpenAI edits that way). The e2e global setup refuses to start
  while another worker beats; a worker deletes its heartbeat when it stops.
- Not the cause: sharp's cache and concurrency (turning both off changed a 4-layer recolour by <10 MB) and Postgres
  (~0.05 GB).

`playwright.config.ts` runs one test worker where the cap is under 6 GiB; two workers' proof renders don't fit.

- **`a1.small`** (the project default): docs, edits, `mise run check` (also during a part round next to both
  services), and the whole e2e suite (`CI=1`, or next to the `web` service) in one run, with ~0.4 GiB to spare at
  the e2e peak. Run e2e and `mise run check` one after the other, not in parallel, and close agent-browser
  (`agent-browser close`) before running e2e: neither was measured alongside it.
- **`a1.medium`** (4 vCPU, 8 GB): use it at your discretion for larger tasks, such as anything that runs the full
  stack plus browsers and checks at once (UI verification while e2e or typecheck runs) or needs a second worker.
- An orb can't be resized while it runs. To verify on a bigger machine, start a new thread with a larger size;
  it starts from the base branch, so push the work to a branch first.

## Running the app in an orb

- `.agents/setup` has already started Postgres and SeaweedFS, migrated and seeded.
- `amp orb services ensure` starts `web` (`mise run dev:web`, port 3000) and `worker` (`mise run dev:worker`) from
  `.amp/services.yaml` and prints the portal URL. Don't also run `mise run dev`: it would fight over port 3000.
  Logs: `amp orb service logs web` / `worker`. Restart the worker after editing tasks if `--watch` misses it.
- Docker needs `sudo` in the current shell (`sudo docker compose ps`); new login shells are in the `docker` group.
- Sign in without a password: open `/__dev/log-me-in/<email>?returnTo=/` in the browser you're testing with
  (curl doesn't sign the browser in). It creates the user, with a one-person family, if missing. `/__dev` lists the
  dev endpoints and every local user with a sign-in link; `/__dev/log-me-out?returnTo=/` signs the browser out.
  Emails (invitations, set-password links) aren't delivered: they're logged and listed at `/__dev/mailbox` (in
  memory, per web server process). All `/__dev` routes only work with `DEV_LOGIN_ENABLED=true` and `NODE_ENV` not
  `production`.

Seeded accounts (password for all: `lifestory-dev-password`):

<!-- oxfmt-ignore -->
| Email | Role |
| --- | --- |
| `parent@lifestory.dev` | owner of "The Example Family" |
| `grandparent@lifestory.dev` | viewer in that family (read-only) |
| `operator@lifestory.dev` | operator (`admin` role), owner of "Sid (operator)'s family", author of the sample story; impersonation is disabled |

## Conventions

### Effect v4 (effect@4.x — do not write v3 patterns)

- Services are classes: `class Foo extends Context.Service<Foo, Shape>()("@lifestory/core/Foo") {}` with a
  `static readonly layer`. Not `Effect.Tag`/`Context.Tag`/`Effect.Service` (v3).
- Access a service with `yield* Foo` or `Foo.use((foo) => ...)`.
- Configuration comes from `Config.*` inside the layer that needs it (`AppConfig`, `Auth`); secrets use `Config.Redacted`.
- Errors that callers can handle are `Schema.TaggedError` classes in `packages/core/src/errors.ts`, so they
  cross the wire. Infrastructure failures with no recovery (a database error) are defects (`Effect.promise`/`orDie`).
- Named domain functions use `Effect.fn("area.name")(function* () { ... })` for tracing.
- One runtime per process: `makeServerRuntime()` in `packages/core/src/runtime.ts` (`ServerLayer`). The web app
  caches it in `apps/web/src/server/runtime.ts`; the worker builds it once in `main.ts`. Don't build layers ad hoc.
- Validation is Effect Schema, never Zod. Server function inputs: `.validator(Schema.toStandardSchemaV1(...))`.

### Server functions keep typed errors

A server function returns `runEffect(ResultSchema(success, failures), effect)`: the Effect's `Exit` encoded as JSON.
The client calls `unwrapResult(ResultSchema)(await fn(...))`, which returns the value or throws the same tagged
error class (`error instanceof NotAuthenticated`). Declare result schemas next to the server function and export
them for the client. Browser code imports only `@lifestory/core/contracts`.

### Server routes vs server functions

App calls are server functions. Outside callers (Better Auth at `/api/auth/*`, the Modal callback later, file
downloads) are server routes with `server.handlers`.

### Durable tasks (Absurd)

- Define tasks with `defineTask` in `packages/core/src/tasks/` and add them to `tasks` so the worker registers them.
- **A task may run more than once.** Do side effects only inside `step(ctx, "name", effect)`, and make every step
  idempotent: derive IDs and object keys from `ctx.taskID` or domain IDs, write with upserts or `onConflictDoNothing`.
- Step results must be JSON. Spawn with `Jobs.spawn(task, params)`; pass `idempotencyKey` when a request can repeat.
- Unit-test a task by calling `task.run(params, ctx)` with helpers from `@lifestory/core/testing` (`../src/testing.ts`
  inside `packages/core`): `fakeTaskContext(taskID, checkpoints)` replaces Absurd's `TaskContext` (private constructor)
  and stores step results in `checkpoints`. Share one map across runs to test a retry that replays completed steps;
  use a fresh map to rerun a step whose result was lost. `memoryObjectStorage(objects)` is an `ObjectStorage` layer
  over a `Map` you can inspect. Provide it with `FakeImageProvider`; example: `packages/core/test/generations.test.ts`.

### Accounts and families

Every account has a family (D3). Create accounts only through `packages/core/src/accounts.ts`
(`createAccountWithFamily`, `ensureOwnFamily`, `acceptInvitationAsNewUser`), never by inserting `user` rows elsewhere.
Family role checks use `familyRoles` from `auth.ts`; a user can be in several families, so check membership of the
row's family, not only the session's active family.

### Database

- Edit `packages/db/src/schema/*`, then `mise run db:generate --name <change>`; commit the SQL and `meta/`.
  Never edit an applied migration. Column names are snake_case.
- A story version (`story_version`) never changes once stored: `db:seed` fails if a fixture's manifest differs from
  the stored one, and `db:seed` and `story:import` refuse changed asset files under an existing version too. Add a new
  version, or in a dev database delete the row and the version's `stories/<storyId>/v<n>/` objects and reseed.
- Absurd's schema is a vendored custom migration (`0001_absurd_0_5_1.sql`). Upgrade it with a new custom
  migration containing Absurd's published upgrade SQL.

### Object storage

Every key starts with its owner (D31): `families/<familyId>/` for anything holding family data, `stories/<storyId>/v<n>/`
for story assets and caches. The `storage.sweep` task deletes the files of families that no longer exist, unapproved
proofs after 30 days, and whatever the removed worker check left under `samples/`; a new kind of object gets an owner
prefix, and an expiry rule in `packages/core/src/tasks/sweep-storage.ts` if it shouldn't live as long as its owner.

### Images

All generation goes through the `ImageProvider` service, called from tasks with `generateImage(ctx, name, request)`
(`packages/core/src/generations.ts`): it submits (a step), suspends until the `generation.done:<id>` event, and
records the outcome in the `generation` table. `FakeImageProvider` (deterministic SVG per key, emits the event
itself) is the default everywhere; there is no GPU in orbs or CI. `IMAGE_PROVIDER=openai` edits with OpenAI (D30, the primary for
part generation; README, "Generating story parts"), and `IMAGE_PROVIDER=modal` uses FLUX 3 Klein on Modal, which calls
back `/api/webhooks/modal`; the README's "Image generation on Modal" has the runbook. Don't run real providers unless
asked, and keep it to a few dollars: OpenAI bills every edit, Modal spends GPU money.

### Formatting

oxfmt (`.oxfmtrc.json`, D53) formats every tracked TS, TSX, JS, JSON, CSS, Markdown, YAML, and TOML file; run
`mise run format` before committing. Its `ignorePatterns` list the tracked files other tools write (the lockfile,
TanStack's `routeTree.gen.ts`, drizzle-kit's migrations, the story directories under `fixtures/stories`, and the
portrait `parts.json`): change their generator, not the file. A file a script writes that oxfmt would rewrite
differently goes on that list too. It also sorts imports (side-effect imports stay put) and Tailwind classes
(in `className` and `cn`/`cva`/`clsx` calls). Code blocks in Markdown stay as written. A Markdown table with a row wider than
120 columns gets `<!-- oxfmt-ignore -->` on the line before it: aligning it would pad every cell to its column's
widest one, which more than doubled this file. Python under `modal/` and
`fixtures/art-sources` isn't formatted. Upgrading oxfmt (0.x, so output can change between versions) goes in its own
commit with the files it reformats; add a purely mechanical commit like that to `.git-blame-ignore-revs` after it
lands, so `git blame` (configured by `.agents/setup`) and GitHub skip it.

### Dependencies

Pin exact versions. Choose the latest stable release that is at least 3 days old; `minimumReleaseAge` in
`pnpm-workspace.yaml` enforces it, so don't add exclusions. Install with `mise run install` (frozen lockfile).
Tools pinned in `mise.toml` follow the same rule.

### Environment

`.env` (copied from `.env.example`) is loaded by mise for every task and **overrides** variables already set in the
shell. Leave `BETTER_AUTH_URL` out of `.env`: `dev:web` derives it from `$PUBLIC_URL` (the Amp portal) or `$PORT`,
and trusts `http://localhost:$PORT` too, so curl and Playwright on localhost work next to the portal.

### Deploying

Production is the Railway project in README "Deploying". Change its services and variables in `.railway/railway.ts`
(`railway config plan`, then `apply`), never in the dashboard or with `railway.json`/`railway.toml` (deprecated).
A push to `main` deploys (below); deploy any other way (`railway config apply`, `railway up`, "Run workflow") only
when asked, and never run `db:seed` or enable `/__dev` against it.

- For production shell access, follow [README "Agent SSH access from an Amp orb"](README.md#agent-ssh-access-from-an-amp-orb): use the bot's personal SSH key from `RAILWAY_SSH_PRIVATE_KEY` and the verified service-instance target. Materialize the key only at runtime, remove it afterward, and keep host-key verification enabled.
- SSH and Railway API credentials have separate permissions; do not use an available API token as evidence of what the SSH key permits. A connection test does not authorize an import, migration, deploy, settings change, or production data write; obtain approval for the operation being performed.

### Commits and pushing

Work lands as commits on `main`, without pull requests. Pushing deploys to production once CI passes, so judge a
change by what it could do to the live site and its data, not by its size.

Sid gives standing approval, for this repository only, to commit and push routine, low-risk work to `main` once it
is verified as above (`mise run check` alone is enough for docs-only and other small changes that can't affect a
running app): bug fixes, small features, UI and copy changes, tests, docs, and refactors that keep behaviour.
Don't ask again for those; say what you pushed in your report, then watch CI and the deploy (`deploy:check`) and fix
or revert a failure you caused.

Stop and ask Sid for review before pushing when a change is a one-way door or a mistake would be costly to undo:

- a migration that drops, rewrites, or backfills existing data, or anything else that destroys production data or
  files;
- auth, sessions, roles and permissions, or access to children's and families' data and photos;
- a stored format or commitment others depend on (book format, story versions, object keys, approved proofs and
  their PDFs), or a public interface such as URLs, webhooks, or emails sent to real people;
- new recurring vendor costs or real-provider spend beyond a few dollars, new dependencies of consequence, or
  changes to Railway services and variables;
- a large or cross-cutting change, a change to a decision in `docs/decisions.md`, or one your checks couldn't cover.

These are prompts for judgment, not automatic blockers: an additive migration or a fix inside one of these areas
that your tests cover can ship like any other change; ask when you're unsure. This approval covers committing and
pushing code here and the deploy that follows; it doesn't approve other external actions (production database
writes, `railway config apply`, spending, messaging people), which still need a request in the thread.
