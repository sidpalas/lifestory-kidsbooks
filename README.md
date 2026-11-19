# lifestory-kidsbooks

Custom picture books for families. Human authors and illustrators write the stories and draw the art;
AI adds the family's own members as characters in the illustrations. See [docs/brief.md](docs/brief.md).

This is a demo codebase: an open-source, realistic product used to test background coding agents.

**Status:** foundation only. You can sign in as a seeded user, see stories read from Postgres, open the sample
story "The Moon Picnic" with its pages rendered at print size, its characters composed from placeholder variant
parts, and change each character's look (face, skin, hair, hair colour, glasses) in a picker, and run a
worker job that writes a file to object storage. Families and invites work: the operator invites a new family,
an owner invites a parent or a view-only member, and a user in several families switches between them
(emails go to `/__dev/mailbox` in development). Milestone 1 is planned in [docs/plan.md](docs/plan.md);
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
seed refuses to run with `NODE_ENV=production`. The operator account comes from
`node packages/core/src/operator-create.ts --email <email>`, run once in the web image (D21; see "Railway" below).
Until an email provider is added, invitation and set-password links appear only in the web service's log (D23).
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

Development, tests, and CI use the fake image provider, which needs no GPU. Real images come from FLUX 3 Image Klein
running on [Modal](https://modal.com) (`modal/flux_klein.py`): the app submits a job, the workflow suspends, and Modal
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
