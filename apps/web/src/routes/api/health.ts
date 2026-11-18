// Readiness check for container hosts and deploy verification: reads Postgres and
// reports how many migrations are applied. Public, and returns no user data.
import { countAppliedMigrations } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { serverRuntime } from "~/server/runtime";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        serverRuntime().runPromise(
          countAppliedMigrations.pipe(Effect.map((migrations) => Response.json({ status: "ok", migrations }))),
        ),
    },
  },
});
