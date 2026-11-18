// Serves objects from storage to signed-in users. Milestone 1 replaces the
// "samples/" rule with a per-family check (photos are visible only to that family).
import { Auth, ObjectStorage } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { serverRuntime } from "~/server/runtime";

export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        serverRuntime().runPromise(
          Effect.gen(function* () {
            const key = params._splat ?? "";
            yield* Auth.use((auth) => auth.requireUser(request.headers));
            if (!key.startsWith("samples/")) return new Response("Not found", { status: 404 });
            const object = yield* ObjectStorage.use((storage) => storage.get(key));
            return new Response(new Uint8Array(object.body), {
              headers: { "content-type": object.contentType, "cache-control": "private, max-age=3600" },
            });
          }).pipe(
            Effect.catchTag("NotAuthenticated", () => Effect.succeed(new Response("Unauthorized", { status: 401 }))),
            Effect.catchTag("StorageError", () => Effect.succeed(new Response("Not found", { status: 404 }))),
          ),
        ),
    },
  },
});
