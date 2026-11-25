// Serves objects from storage to signed-in users. Story assets (stories/<storyId>/v<n>/...) follow the story's
// read rule; a family's files (families/<familyId>/..., such as PDF proofs) are for that family's members, and a
// book's sheets and pages for the operator reviewing it (photos only on an opted-in book, D57).
// `?w=<width>` (one of SCREEN_WIDTHS) asks for an image's WebP screen copy, read under the original's rule.
import { createHash } from "node:crypto";

import {
  Auth,
  canReadFamilyFile,
  canReadStoryAsset,
  isScreenCopyKey,
  ObjectStorage,
  operatorCanReadBookFile,
  SCREEN_WIDTHS,
  screenCopy,
} from "@lifestory/core";
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
            const w = new URL(request.url).searchParams.get("w");
            const width = w === null || isScreenCopyKey(key) ? null : Number(w);
            if (width !== null && !SCREEN_WIDTHS.includes(width)) return new Response("Bad width", { status: 400 });
            const user = yield* Auth.use((auth) => auth.requireUser(request.headers));
            const allowed = key.startsWith("stories/")
              ? yield* canReadStoryAsset(user.id, key)
              : key.startsWith("families/") &&
                ((yield* canReadFamilyFile(user.id, key)) || (yield* operatorCanReadBookFile(user, key)));
            if (!allowed) return new Response("Not found", { status: 404 });
            const object =
              width === null ? yield* ObjectStorage.use((storage) => storage.get(key)) : yield* screenCopy(key, width);
            const etag = `"${createHash("sha256").update(object.body).digest("base64url").slice(0, 27)}"`;
            const headers = {
              etag,
              // A story version's files never change (stored versions are frozen, draft uploads are named by their
              // content), so the browser keeps them. A family's files are checked again after an hour, and an
              // unchanged one answers 304. Private either way: the CDN never stores what needs a sign-in.
              "cache-control": key.startsWith("stories/")
                ? "private, max-age=31536000, immutable"
                : "private, max-age=3600",
            };
            if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
            return new Response(new Uint8Array(object.body), {
              headers: {
                ...headers,
                "content-type": object.contentType,
                // Stored SVGs could carry scripts; opened directly, they run sandboxed with no access to the app.
                "content-security-policy": "sandbox",
                "x-content-type-options": "nosniff",
                // A proof downloads as a file named after it rather than opening in the app's tab.
                ...(key.endsWith(".pdf")
                  ? { "content-disposition": `attachment; filename="${key.split("/").pop()}"` }
                  : {}),
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
