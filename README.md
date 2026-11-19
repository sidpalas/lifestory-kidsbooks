# lifestory-kidsbooks

Custom picture books for families. Human authors and illustrators write the stories and draw the art, including a
range of looks for each character; parents pick how each family member looks from options the illustrator approved,
and can edit the text. No photos are uploaded and no AI runs when a family makes a book. See
[docs/brief.md](docs/brief.md).

This is a demo codebase: an open-source, realistic product used to test background coding agents.

**Status:** milestone 1 (invite-only vertical slice) is complete:

1. The operator invites a new family; the invitee sets a password and owns a one-person family. An owner invites a
   parent or a view-only member (emails go to `/__dev/mailbox` in development).
2. Family members become characters in a picker: an age, a curated look, then one feature at a time with a live
   portrait.
3. The seeded sample story "The Moon Picnic" (book format v2, placeholder art, approved variant parts per role).
4. A family makes a personalized book of it; every page is composed from the approved parts, and a look change shows
   on every page at once.
5. The editor shows a page as it will print and edits its text.
6. The worker renders a print-ready PDF proof with headless Chromium; the parent downloads it and approves it for
   print.

`apps/web/e2e/milestone1.spec.ts` walks all six in order. Plan: [docs/plan.md](docs/plan.md); decisions:
[docs/decisions.md](docs/decisions.md).

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
mise exec -- pnpm exec playwright install chromium   # the worker's PDF proofs and the end-to-end test
mise run stack                                       # Postgres + SeaweedFS, migrate, seed, web app + worker
```

`mise tasks` lists every command.

Then open http://localhost:3000/__dev/log-me-in/parent@lifestory.dev?returnTo=/ to sign in as the seeded parent.
Other seeded accounts are listed in [AGENTS.md](AGENTS.md).

In an Amp orb, `.agents/setup` does all of the above except starting the app; run `amp orb services ensure`.

## Checks

```sh
mise run check      # typecheck, lint, unit tests
mise run test:e2e   # Playwright; needs the stack's Postgres and SeaweedFS running, migrated and seeded
mise run test:e2e -- milestone1   # only the walk through the whole milestone 1 slice
```

`test:e2e` starts its own worker, and a web app unless one is already on :3000. Set `E2E_SCREENSHOTS=<dir>` to keep
screenshots of the picker and the editor and the downloaded proof PDF.

CI (`.github/workflows/ci.yml`) runs the same mise tasks.

## Deploying

The app ships as two images, built from the repository root, that need only Postgres and an S3-compatible
bucket. They read the variables in `.env.example`; production also sets `BETTER_AUTH_URL` to its public origin.

- `apps/web/Dockerfile`: the web app on `$PORT`. Before each release, run `node packages/db/src/migrate.ts`
  in the same image to apply migrations (idempotent; it takes a lock, so the worker image can run it at the same time).
- `apps/worker/Dockerfile`: the Absurd worker, with Chromium for PDF proofs. Set `PRINT_APP_URL` to the web app's
  origin as the worker reaches it (on Railway, its private domain).

Production images never serve the `/__dev` routes (they are compiled out of `vite build`), and the development
seed refuses to run with `NODE_ENV=production`. The operator account comes from
`node packages/core/src/operator-create.ts --email <email>`, run once in the web image (D21; see "Railway" below).
Until an email provider is added, invitation and set-password links appear only in the web service's log (D23).
`GET /api/health` reads Postgres and returns `{"status":"ok","migrations":<n>}`.

### Railway

The Railway project `lifestory-kidsbooks` (environment `production`) runs `web`, `worker`, and `postgres`, with the
`lifestory-data` bucket. It's live at https://lifestory.devopsdirective.com, the web service's custom domain; always
use it. `BETTER_AUTH_URL` is `https://${{RAILWAY_PUBLIC_DOMAIN}}`, which resolves to the custom domain, so sign-in from
the service's `*.up.railway.app` domain fails with `INVALID_ORIGIN`. `.railway/railway.ts`
declares the services, their GitHub source, Dockerfiles, pre-deploy migration, the web app's healthcheck, and every
variable ([Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)).

Both services deploy every push to `main` by themselves, once its GitHub checks pass (Railway's "wait for CI"; a push
whose CI run was cancelled by a newer push is skipped, and the newer one deploys). Each runs the migration before it
starts, so whichever service releases first migrates the database and the other finds nothing to do. To change the
configuration, use the CLI (`npm install -g @railway/cli`, 5.74 or newer) with a project token in `RAILWAY_TOKEN`, or
after `railway login` and `railway link`. `railway config` evaluates the file with the `railway` SDK from the root
devDependencies (`mise run install`):

```sh
railway config plan                    # preview config changes in .railway/railway.ts
railway config apply                   # apply them
railway deployment list --service web  # deployments, newest first
curl https://lifestory.devopsdirective.com/api/health
```

`railway up --service <web|worker> --ci` still deploys the local working tree (minus `.gitignore`d files) by hand,
for example to redeploy without a push; the next push to `main` replaces it.
`BETTER_AUTH_SECRET` is set once on `web` (the worker references it) and stays out of the config file:
`railway variables --service web --set "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"`. Railway buckets use
virtual-hosted-style URLs, hence `S3_FORCE_PATH_STYLE=false`.

Create the operator account once, after the first deploy (D21). Open a shell in the web container under your own
Railway login; the command prompts for the password without echoing it, so it needs that interactive terminal:

```sh
railway ssh --service web
node packages/core/src/operator-create.ts --email <email> --name "<name>"   # inside the container, in /app
```

It creates the `admin` account and its one-person family, or promotes an existing user; running it again changes
nothing. Locally, `mise run operator:create -- --email <email>` runs the same script with `.env` loaded.

To switch to the real image model, change `IMAGE_PROVIDER` from `fake` to `modal` in `.railway/railway.ts`,
add the Modal variables from "Image generation on Modal" below, then apply and redeploy both services.

## Image generation on Modal

Image generation is authoring tooling for illustrators (D26); no family's data reaches it. Development, tests, and CI
use the fake image provider, which needs no GPU. OpenAI `gpt-image-2.6-sunburst` was chosen as the primary provider
(D30) and comes with the illustrator tooling in a later milestone; until then the one real provider is the fallback,
FLUX 3 Image Klein running on [Modal](https://modal.com) (`modal/flux_klein.py`): the app submits a job, the workflow suspends, and Modal
calls back `/api/webhooks/modal` when the image is in object storage. Each cold job costs about US$0.09 of A100 time,
and a warm one about US$0.014. The GPU scales to zero 60 s after the last job (docs/decisions.md D25).

**One-time setup**

1. Accept the FLUX Kommunity License at https://huggingface.co/black-forest-labs/flux-3-image-klein with a Hugging Face
   account, and create a read-only token for it.
2. Install the Modal CLI (`uv tool install modal`), then `modal token new` (or set `MODAL_TOKEN_ID` and
   `MODAL_TOKEN_SECRET`). The workspace needs a payment method on file for GPUs.
3. Create the two secrets the function reads:

   ```sh
   modal secret create huggingface HF_TOKEN=hf_...
   modal secret create lifestory-modal MODAL_CALLBACK_SECRET="$(openssl rand -hex 32)"   # keep this value
   ```

4. Download the weights (about 40 GB, two minutes, CPU only) onto the Modal Volume:
   `modal run modal/flux_klein.py::download_weights`.

**Deploy, and redeploy after changing `modal/flux_klein.py`**

```sh
modal deploy modal/flux_klein.py   # prints the submit endpoint URL
```

**Try the model without the app**

```sh
modal run modal/flux_klein.py --prompt "a watercolor fox reading under a tree" --out fox.png
```

**Point the app at it.** Set these on the web app and the worker, and restart both:

```sh
IMAGE_PROVIDER=modal
MODAL_ENDPOINT_URL=https://<workspace>--lifestory-flux-klein-submit.modal.run   # from modal deploy
MODAL_CALLBACK_SECRET=<the value in the lifestory-modal secret>
PUBLIC_APP_URL=https://<the app's public origin>                                 # Modal calls back here
S3_PUBLIC_ENDPOINT=https://<storage as Modal reaches it>                         # if not S3_ENDPOINT
```

The app needs a public URL for the callback, and Modal must reach object storage through the presigned URLs. With
SeaweedFS on a laptop, expose both through a tunnel. Signed callbacks that arrive twice are harmless. "Write a sample
file" on the home page runs one real generation. Logs: `modal app logs lifestory-flux-klein`; runs:
https://modal.com/apps (app `lifestory-flux-klein`).
