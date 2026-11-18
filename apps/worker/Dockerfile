# Worker image: the Absurd worker, run from TypeScript source (Node strips types).
# Build from the repository root:  docker build -f apps/worker/Dockerfile -t lifestory-worker .
# It needs a migrated database; see apps/web/Dockerfile for the migration command.
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
COPY packages/core/src packages/core/src
COPY packages/db/src packages/db/src
COPY apps/worker/src apps/worker/src
USER node
CMD ["node", "apps/worker/src/main.ts"]
