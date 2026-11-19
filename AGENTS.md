# AGENTS.md

Lifestory: parents personalize human-written picture books with their own family as characters.
Read [docs/brief.md](docs/brief.md) (the product brief), [docs/decisions.md](docs/decisions.md)
(decisions and what would reopen them) and [docs/plan.md](docs/plan.md) (milestone 1 plan)
before changing anything structural. Decisions change only with new evidence: report the
evidence and a proposal, don't switch on your own.

## Layout

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
`pnpm` are already on `PATH`. Run `mise run check` and `mise run test:e2e` before handing work back.
Times measured on an `a1.small` orb.

| Command | What | Time |
| --- | --- | --- |
| `mise run check` | `typecheck`, `lint`, and `test` in parallel | ~18–24 s |
| `mise run typecheck` | `tsc` (TypeScript 7) over every package | ~15 s |
| `mise run lint` | oxlint, warnings fail | <1–3 s |
| `mise run test` | Vitest unit tests (`packages/*/test`, `apps/*/test`); most of it is importing modules | ~12 s |
| `mise run verify -- <command>` | Drive the real app and keep evidence (`docs/features`): `picker` ~20 s, `proof` ~30 s, `looks` ~25 s in dev; `--config image` first builds both images, minutes on `a1.small` (`--no-build` reuses them) | see each |
| `mise run test:e2e` | Playwright end-to-end tests (25; one worker under 6 GB of memory); `milestone1.spec.ts` walks the whole milestone 1 slice, `parts.spec.ts` generates a part through the worker with the fake provider, `art-import.spec.ts` imports a PSD and a flat page (D42; with `IMAGE_PROVIDER=openai` it runs on real edits, ~US$0.47), `mise run test:e2e -- milestone1` runs only it. Needs Postgres and SeaweedFS migrated and seeded (`.agents/setup` does that, but doesn't start the app). Reuses a web app on :3000 if one is running (the `web` service), otherwise starts one; always starts its own worker | ~2.8–3.6 min for all on `a1.small` (`CI=1`, cold Vite cache), ~45 s for `milestone1` alone, ~70 s with `E2E_PORT=3100` next to the services (measured 2026-11-19). `CI=1` always starts fresh and fails if :3000 is taken: with services running, add `E2E_PORT=3100` |
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

Measured 2026-11-19, full `CI=1 mise run test:e2e` runs (21 tests, one Playwright worker, cold Vite cache, ~3 min).
Memory in GiB (1 GiB = 1024 MiB); the per-process rows are approximate:

| | Before | After |
| --- | --- | --- |
| Peak (anon + shmem + kernel in the cap) | 3 GiB: killed ~70 s in | **2.14–2.59 GiB** over 7 runs (0.4–0.86 GiB to spare) |
| Same run next to the `web` and `worker` services (`mise run test:e2e`, reuses `web`) | — | **2.46–2.58 GiB** over 2 runs (~0.4 GiB to spare), 21 passed |
| Web dev server (`vite dev`) | 1.21 | 0.76 |
| SeaweedFS | 0.29–0.34 | 0.17 |
| Playwright runner + its test worker | 0.50 | 0.40 |
| Test browser / worker's print Chromium / worker | — | ~0.47 / ~0.33–0.41 / ~0.37 |

What took the memory, and what keeps it down now (don't undo these without measuring):
- **Vite pre-bundling inside the dev server**: its dependency scan followed server functions into `@lifestory/core`
  and pre-bundled playwright-core, sharp, pg, and the S3 SDK for the browser, on the first page view, inside the
  server, which kept ~0.5 GB for good. `vite.config.ts` excludes `@lifestory/core` from `optimizeDeps`, and `dev:web`
  runs `vite optimize` in its own short-lived process first.
- **Contexts the specs never closed** (`browser.newContext()` lives as long as the test browser, i.e. the whole run):
  `milestone1.spec.ts` and `authoring.spec.ts` close theirs. Close any context you open.
- **`@lifestory/core` in the Playwright runner** (~0.2 GB, held for the run because the runner imports every spec to
  list tests): specs that need it `await import("@lifestory/core")` inside the test.
- **SeaweedFS**: `GOMEMLIMIT` in `compose.yaml`.
- Not the cause: sharp's cache and concurrency (turning both off changed a 4-layer recolour by <10 MB) and Postgres
  (~0.05 GB).

`playwright.config.ts` runs one test worker on machines under 6 GB; two workers' proof renders don't fit.

- **`a1.small`**: docs, edits, `mise run check`, and the whole e2e suite (`CI=1` included, also next to the running
  services) in one run. Run e2e and `mise run check` one after the other, not in parallel, and close agent-browser
  (`agent-browser close`) before running e2e: neither was measured alongside it.
- **`a1.medium`** (4 vCPU, 8 GB): anything that runs the full stack plus browsers and checks at once, such as UI
  verification while e2e or typecheck runs.
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
  over a `Map` you can inspect. Provide it with `FakeImageProvider`; example: `packages/core/test/sample-file.test.ts`.

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
for story assets and caches, `samples/<taskID>` for the sample task. The `storage.sweep` task deletes samples after
7 days and the files of families that no longer exist; a new kind of object gets an owner prefix, and an expiry rule
in `packages/core/src/tasks/sweep-storage.ts` if it shouldn't live as long as its owner.

### Images

All generation goes through the `ImageProvider` service, called from tasks with `generateImage(ctx, name, request)`
(`packages/core/src/generations.ts`): it submits (a step), suspends until the `generation.done:<id>` event, and
records the outcome in the `generation` table. `FakeImageProvider` (deterministic SVG per key, emits the event
itself) is the default everywhere; there is no GPU in orbs or CI. `IMAGE_PROVIDER=openai` edits with OpenAI (D30, the primary for
part generation; README, "Generating story parts"), and `IMAGE_PROVIDER=modal` uses FLUX 3 Klein on Modal, which calls
back `/api/webhooks/modal`; the README's "Image generation on Modal" has the runbook. Don't run real providers unless
asked, and keep it to a few dollars: OpenAI bills every edit, Modal spends GPU money.

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
Deploy only when asked, and never run `db:seed` or enable `/__dev` against it.

### Commits

Never push to `main` without the operator's explicit approval in the thread.
