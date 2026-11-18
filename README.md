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
