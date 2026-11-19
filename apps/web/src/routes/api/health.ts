// Readiness check for container hosts and deploy verification: reads Postgres and reports how many migrations
// are applied, the commit this web process runs, and the workers that beat recently (with their commits).
// Public, and returns no user data. Its status is the web app's alone: a missing worker must not fail the web
// service's own healthcheck, so the post-deploy check (apps/web/scripts/check-deploy.ts) judges `workers`.
import { AppConfig, countAppliedMigrations, liveWorkers } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { serverRuntime } from "~/server/runtime";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        serverRuntime().runPromise(
          Effect.all({ migrations: countAppliedMigrations, config: AppConfig, workers: liveWorkers }).pipe(
            Effect.map(({ migrations, config, workers }) =>
              Response.json({ status: "ok", migrations, version: config.version, workers }),
            ),
          ),
        ),
    },
  },
});
