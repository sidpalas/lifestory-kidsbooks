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
| `mise run check` | `typecheck`, `lint`, and `test` in parallel | ~10 s |
| `mise run typecheck` | `tsc` (TypeScript 7) over every package | ~6–10 s |
| `mise run lint` | oxlint, warnings fail | <1–3 s |
| `mise run test` | Vitest unit tests (`packages/*/test`, `apps/*/test`) | ~1–5 s |
| `mise run test:e2e` | Playwright end-to-end tests (17); `milestone1.spec.ts` walks the whole milestone 1 slice, `mise run test:e2e -- milestone1` runs only it. Needs Postgres and SeaweedFS migrated and seeded (`.agents/setup` does that, but doesn't start the app). Reuses a web app on :3000 if one is running (the `web` service), otherwise starts one; always starts its own worker | ~1.8 min for all, ~45 s for `milestone1` alone (measured 2026-11-19 without the `web` service). `CI=1` always starts fresh and fails if :3000 is taken: with services running, add `E2E_PORT=3100` |
| `.agents/setup` | Orb setup; idempotent | ~5 s warm; a fresh orb also downloads images, Node, and Chromium |
| `mise run db:migrate` | Apply Drizzle migrations; idempotent | ~1 s |
| `mise run db:seed` | Seed users, family, sample story; idempotent | ~1 s |
| `mise run operator:create -- --email <email>` | Create or promote the operator with a one-person family (D21). Prompts for the password; reads two lines from stdin when piped. In production images (no mise): `node packages/core/src/operator-create.ts --email <email>` | ~1 s |
| `mise run db:generate --name <change>` | Generate a migration after editing `packages/db/src/schema` | ~2 s |
| `mise run dev` | Web app (`dev:web`) and worker (`dev:worker`) in the foreground | ~2 s to ready |
| `mise run stack` | Outside orbs: compose up, migrate, seed, then `dev` | ~15 s to ready |
| `mise run install` | `pnpm install --frozen-lockfile` | ~3 s |

## Orb size

Measured 2026-11-18 on `a1.small` (2 vCPU, 4 GB, no swap): with the `web` and `worker` services and an
agent-browser session open, the orb uses ~2 GB. A `CI=1 mise run test:e2e` run on its own fits: it peaks at
~1.8 GB used with no services running and ~3 GB next to the running services. The pressure comes from running it
at the same time as `mise run typecheck` (or `mise run check`) on top of the services and agent-browser: that peaks at
~3.4 GB, leaving ~0.5 GB. Run e2e and typecheck one after the other, not in parallel.

- **`a1.small`**: docs, small edits, unit tests (`mise run check`), and e2e runs (including `CI=1`) run one at a
  time. Close agent-browser (`agent-browser close`) before running e2e.
- **`a1.medium`** (4 vCPU, 8 GB): anything that runs the full stack plus browsers at once: feature work with UI
  verification while running checks in parallel, PDF proof rendering (milestone 1).
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
  the stored one. Add a new version, or in a dev database delete the row and reseed.
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
itself) is the default everywhere; there is no GPU in orbs or CI. `IMAGE_PROVIDER=modal` uses FLUX 3 Klein on Modal,
which calls back `/api/webhooks/modal`; the README's "Image generation on Modal" has the runbook. Don't deploy or run
the Modal app unless asked: it spends GPU money.

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
