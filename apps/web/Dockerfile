# Web app image: TanStack Start served by srvx (apps/web/server.ts).
# Build from the repository root:  docker build -f apps/web/Dockerfile -t lifestory-web .
# Serves on $PORT (default 3000). Apply migrations before each release by running the same
# image with `node packages/db/src/migrate.ts` (Railway: the web service's pre-deploy command).
# Configuration comes from the environment; see .env.example and README "Deploying".
# Node and pnpm versions match mise.toml.

FROM node:26.13.1-trixie-slim AS base
RUN npm install --global pnpm@12.0.0 && npm cache clean --force
ENV CI=true
WORKDIR /app
# Every workspace manifest, so the frozen lockfile matches.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter "@lifestory/web..."
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter @lifestory/web build

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter "@lifestory/web..." && pnpm store prune
# Shared packages run from TypeScript source (Node strips types); migrations ship as SQL.
COPY packages/core/src packages/core/src
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY apps/web/server.ts apps/web/
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.ts"]
