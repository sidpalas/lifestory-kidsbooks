// Uploads one role's photo to a draft book (D56): POST multipart with `file` and `slotId`. The browser has already resized it and dropped its metadata. Answers { uploadId } and starts the check, or
// { error } with a status: 429, with Retry-After when waiting helps, past the account's upload limits (D59). The custom
// header makes a cross-site form unable to send this.
import { Auth, uploadPhoto } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { serverRuntime } from "~/server/runtime";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "x-content-type-options": "nosniff" } });

export const Route = createFileRoute("/api/books/$bookId/photos")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        serverRuntime().runPromise(
          Effect.gen(function* () {
            if (request.headers.get("x-lifestory-upload") !== "1") return json({ error: "Missing upload header" }, 400);
            const user = yield* Auth.use((auth) => auth.requireUser(request.headers));
            const form = yield* Effect.promise(() => request.formData());
            const file = form.get("file");
            const slotId = form.get("slotId");
            if (!(file instanceof File) || typeof slotId !== "string")
              return json({ error: "Send a photo and a role" }, 400);
            const body = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
            return json(
              yield* uploadPhoto(user.id, {
                bookId: params.bookId,
                slotId,
                fileName: file.name,
                contentType: file.type,
                body,
              }),
            );
          }).pipe(
            Effect.catchTags({
              NotAuthenticated: () => Effect.succeed(json({ error: "Sign in first" }, 401)),
              Forbidden: (error) => Effect.succeed(json({ error: error.message }, 403)),
              NotFound: () => Effect.succeed(json({ error: "No such book or role" }, 404)),
              InvalidInput: (error) => Effect.succeed(json({ error: error.message }, 400)),
              UploadLimitReached: (error) => {
                const response = json({ error: error.message }, 429);
                if (error.retryAfterSeconds !== null)
                  response.headers.set("retry-after", String(error.retryAfterSeconds));
                return Effect.succeed(response);
              },
              JobError: (error) => Effect.succeed(json({ error: error.message }, 500)),
            }),
          ),
        ),
    },
  },
});
