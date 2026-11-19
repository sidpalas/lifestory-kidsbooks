// Serves objects from storage to signed-in users. Story assets (stories/<storyId>/v<n>/...) follow the story's
// read rule; a family's files (families/<familyId>/..., such as PDF proofs) are for that family's members.
import { Auth, canReadFamilyFile, canReadStoryAsset, ObjectStorage } from "@lifestory/core";
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
            const user = yield* Auth.use((auth) => auth.requireUser(request.headers));
            const allowed = key.startsWith("stories/")
              ? yield* canReadStoryAsset(user.id, key)
              : key.startsWith("families/")
                ? yield* canReadFamilyFile(user.id, key)
                : key.startsWith("samples/");
            if (!allowed) return new Response("Not found", { status: 404 });
            const object = yield* ObjectStorage.use((storage) => storage.get(key));
            return new Response(new Uint8Array(object.body), {
              headers: {
                "content-type": object.contentType,
                "cache-control": "private, max-age=3600",
                // Stored SVGs could carry scripts; opened directly, they run sandboxed with no access to the app.
                "content-security-policy": "sandbox",
                "x-content-type-options": "nosniff",
                // A proof downloads as a file named after it rather than opening in the app's tab.
                ...(key.endsWith(".pdf") ? { "content-disposition": `attachment; filename="${key.split("/").pop()}"` } : {}),
              },
            });
          }).pipe(
            Effect.catchTag("NotAuthenticated", () => Effect.succeed(new Response("Unauthorized", { status: 401 }))),
            Effect.catchTag("StorageError", () => Effect.succeed(new Response("Not found", { status: 404 }))),
          ),
        ),
    },
  },
});
