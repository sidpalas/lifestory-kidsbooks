// The picker's portrait of a look (packages/core looks/portrait.ts) as a PNG:
// GET /api/portrait?face=face:adult-1&skin=skin:s3&hair=hair:curly&hairColour=hair-colour:black&glasses=glasses:none
// Signed-in users only. The image is a pure function of the look, so browsers may cache it.
import { Auth, Look, lookPortrait } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { serverRuntime } from "~/server/runtime";

const decodeLook = Schema.decodeUnknownEffect(Look);

export const Route = createFileRoute("/api/portrait")({
  server: {
    handlers: {
      GET: ({ request }) =>
        serverRuntime().runPromise(
          Effect.gen(function* () {
            yield* Auth.use((auth) => auth.requireUser(request.headers));
            const look = yield* decodeLook(Object.fromEntries(new URL(request.url).searchParams));
            const png = yield* lookPortrait(look);
            return new Response(new Uint8Array(png), {
              headers: {
                "content-type": "image/png",
                "cache-control": "private, max-age=86400",
                "x-content-type-options": "nosniff",
              },
            });
          }).pipe(
            Effect.catchTag("NotAuthenticated", () => Effect.succeed(new Response("Unauthorized", { status: 401 }))),
            Effect.catchTag("SchemaError", () => Effect.succeed(new Response("Not a look", { status: 400 }))),
          ),
        ),
    },
  },
});
