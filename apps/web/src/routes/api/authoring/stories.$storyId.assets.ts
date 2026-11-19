// Uploads a file to a story draft (D37): POST multipart with `file` and `folder` ("fonts", "pages/<pageId>", or
// "pages/<pageId>/<slotId>"). Answers { asset }, the path to put in the draft's manifest, or { error } with a status.
// The custom header makes a cross-site form unable to send this (it needs a CORS preflight, which is refused).
import { Auth, uploadDraftAsset } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { serverRuntime } from "~/server/runtime";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "x-content-type-options": "nosniff" } });

export const Route = createFileRoute("/api/authoring/stories/$storyId/assets")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        serverRuntime().runPromise(
          Effect.gen(function* () {
            if (request.headers.get("x-lifestory-upload") !== "1") return json({ error: "Missing upload header" }, 400);
            const user = yield* Auth.use((auth) => auth.requireUser(request.headers));
            const form = yield* Effect.promise(() => request.formData());
            const file = form.get("file");
            const folder = form.get("folder");
            if (!(file instanceof File) || typeof folder !== "string") return json({ error: "Send a file and a folder" }, 400);
            const body = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
            return json(yield* uploadDraftAsset(user, params.storyId, { folder, fileName: file.name, body }));
          }).pipe(
            Effect.catchTags({
              NotAuthenticated: () => Effect.succeed(json({ error: "Sign in first" }, 401)),
              Forbidden: (error) => Effect.succeed(json({ error: error.message }, 403)),
              NotFound: () => Effect.succeed(json({ error: "No draft of this story" }, 404)),
              InvalidInput: (error) => Effect.succeed(json({ error: error.message }, 400)),
            }),
          ),
        ),
    },
  },
});
