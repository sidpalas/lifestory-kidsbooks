# Worker image: the Absurd worker, run from TypeScript source (Node strips types). It also renders PDF proofs with
# headless Chromium (D12, D27), so it carries Playwright's headless shell and the system libraries and fonts it needs.
# Build from the repository root:  docker build -f apps/worker/Dockerfile -t lifestory-worker .
# Apply migrations before each release by running the same image with `node packages/db/src/migrate.ts`
# (Railway: the pre-deploy command of both services; the migration takes a lock, so they can run together).
# Configuration comes from the environment; see .env.example and README "Deploying".
# Node and pnpm versions match mise.toml.

FROM node:26.13.1-trixie-slim
RUN npm install --global pnpm@12.0.0 && npm cache clean --force
ENV CI=true NODE_ENV=production
WORKDIR /app
# Every workspace manifest, so the frozen lockfile matches.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --prod --filter "@lifestory/worker..." && pnpm store prune
# The browser matching the locked playwright-core, in a path the unprivileged user can read.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN cd packages/core && node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/*
COPY packages/core/src packages/core/src
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY apps/worker/src apps/worker/src
USER node
CMD ["node", "apps/worker/src/main.ts"]
