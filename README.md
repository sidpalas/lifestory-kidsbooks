# lifestory-kidsbooks

Custom picture books for families. Human authors and illustrators write the stories and draw the art;
AI adds the family's own members as characters in the illustrations. See [docs/brief.md](docs/brief.md).

This is a demo codebase: an open-source, realistic product used to test background coding agents.

**Status:** foundation only. You can sign in as a seeded user, see stories read from Postgres, and run a
worker job that writes a file to object storage. Milestone 1 is planned in [docs/plan.md](docs/plan.md);
decisions are in [docs/decisions.md](docs/decisions.md).

## Stack

TypeScript everywhere, in a pnpm monorepo:

- `apps/web`: TanStack Start (React, Tailwind, shadcn/ui), Better Auth
- `apps/worker`: [Absurd](https://github.com/earendil-works/absurd) durable workflows on Postgres
- `packages/core`: Effect v4 services shared by the web server and the worker
- `packages/db`: Drizzle schema and migrations
- Postgres and S3-compatible storage (SeaweedFS locally). Image generation goes through a provider
  interface; a fake provider is the default, so nothing needs a GPU.

## Setup

Requirements: [mise](https://mise.jdx.dev) (pins Node and pnpm in `mise.toml`) and Docker with Compose.

```sh
mise install                                         # Node and pnpm at the pinned versions
cp .env.example .env
mise run install                                     # pnpm install --frozen-lockfile
mise exec -- pnpm exec playwright install chromium   # only for the end-to-end test
mise run stack                                       # Postgres + SeaweedFS, migrate, seed, web app + worker
```

`mise tasks` lists every command.

Then open http://localhost:3000/__dev/log-me-in/parent@lifestory.dev?returnTo=/ to sign in as the seeded parent.
Other seeded accounts are listed in [AGENTS.md](AGENTS.md).

In an Amp orb, `.agents/setup` does all of the above except starting the app; run `amp orb services ensure`.

## Checks

```sh
mise run check      # typecheck, lint, unit tests
mise run test:e2e   # needs the stack's Postgres and SeaweedFS running, migrated and seeded
```

CI (`.github/workflows/ci.yml`) runs the same mise tasks.

## Deploying

The app ships as two images, built from the repository root, that need only Postgres and an S3-compatible
bucket. They read the variables in `.env.example`; production also sets `BETTER_AUTH_URL` to its public origin.

- `apps/web/Dockerfile`: the web app on `$PORT`. Before each release, run `node packages/db/src/migrate.ts`
  in the same image to apply migrations (idempotent).
- `apps/worker/Dockerfile`: the Absurd worker.

Production images never serve the `/__dev` routes (they are compiled out of `vite build`), and the development
seed refuses to run with `NODE_ENV=production`. The operator account comes from `operator:create` (D21).
`GET /api/health` reads Postgres and returns `{"status":"ok","migrations":<n>}`.

### Railway

The Railway project `lifestory-kidsbooks` (environment `production`) runs `web`, `worker`, and `postgres`, with the
`lifestory-data` bucket. It's live at https://web-production-73ade4c2.up.railway.app. `.railway/railway.ts`
declares the services, their Dockerfiles, the web app's pre-deploy migration and healthcheck, and every variable
([Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)). The services have no GitHub
source, so code is deployed from a checkout with the CLI (`npm install -g @railway/cli`, 5.74 or newer) and a
project token in `RAILWAY_TOKEN`, or after `railway login` and `railway link`. `railway config` evaluates the file with
the `railway` SDK from the root devDependencies (`mise run install`):

```sh
railway config plan                    # preview config changes in .railway/railway.ts
railway config apply                   # apply them
railway up --service web --ci          # build and deploy the web app; migrations run before it starts
railway up --service worker --ci       # then the worker
curl https://web-production-73ade4c2.up.railway.app/api/health
```

`railway up` uploads the working tree (minus `.gitignore`d files), so deploy from a clean checkout of `main`.
`BETTER_AUTH_SECRET` is set once on `web` (the worker references it) and stays out of the config file:
`railway variables --service web --set "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"`. Railway buckets use
virtual-hosted-style URLs, hence `S3_FORCE_PATH_STYLE=false`.

To switch to the real image model, change `IMAGE_PROVIDER` from `fake` to `modal` in `.railway/railway.ts`,
add the Modal variables described in [docs/plan.md](docs/plan.md#generation-workflow), then apply and redeploy
both services.
