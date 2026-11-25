import { Effect, Schema } from "effect";

import { storyAssetKey } from "../book-format/index.ts";
import { SCREEN_WIDTHS } from "../contracts.ts";
import { defineTask, Jobs, step } from "../jobs.ts";
import { isScreenCopyKey, screenCopy } from "../screen-images.ts";
import { ObjectStorage } from "../storage.ts";

/**
 * Makes the WebP screen copies of stored art at every screen width, on the worker, so a page's first view loads them
 * ready-made instead of the web server resizing print originals. Each key is its own step, and making a copy that
 * exists already only reads it, so a rerun repeats nothing.
 */
export const makeScreenCopies = defineTask({
  name: "images.screenCopies",
  params: Schema.Struct({ keys: Schema.Array(Schema.String) }),
  run: ({ keys }, ctx) =>
    Effect.forEach(
      keys,
      (key) =>
        step(
          ctx,
          `copy:${key}`,
          Effect.forEach(SCREEN_WIDTHS, (width) => screenCopy(key, width), { discard: true }).pipe(
            Effect.orDie,
            Effect.as(null),
          ),
        ),
      { discard: true },
    ).pipe(Effect.as({ keys: keys.length })),
});

/** Spawns the screen copies of the PNG, JPEG, and WebP art among `keys`; `idempotencyKey` keeps a retry to one task. */
export const spawnScreenCopies = (keys: ReadonlyArray<string>, idempotencyKey: string) => {
  const art = keys.filter((key) => /\.(png|jpe?g|webp)$/i.test(key) && !isScreenCopyKey(key));
  return art.length === 0
    ? Effect.void
    : Jobs.use((jobs) => jobs.spawn(makeScreenCopies, { keys: art }, { idempotencyKey })).pipe(Effect.asVoid);
};

/** Spawns the screen copies of every image a story version has stored. */
export const spawnStoryScreenCopies = Effect.fn("screenImages.spawnStory")(function* (
  storyId: string,
  version: number,
) {
  const objects = yield* ObjectStorage.use((storage) => storage.list(storyAssetKey(storyId, version, "")));
  yield* spawnScreenCopies(
    objects.map((object) => object.key),
    `screen-copies:${storyId}:v${version}`,
  );
});

/**
 * The art shown on screen among a book's files: its drawn page figures and cover figures, not the photos, the page
 * references the model saw, or its raw drawings before fitting.
 */
const SHOWN_BOOK_ART = /^families\/[^/]+\/books\/[^/]+\/(pages|likeness\/cover)\/.+\/\d+(-a\d+)?\.png$/;

/**
 * Backfill for art stored before screen copies (`node packages/core/src/tasks/screen-copies.ts`): spawns the task once
 * per story version and per book, for the art pages show. Rerunning is harmless: the same idempotency keys spawn
 * nothing new, and a task finds copies already made. A new width in SCREEN_WIDTHS changes the keys, so a rerun
 * then makes the copies at that width.
 */
if (import.meta.main) {
  const { makeServerRuntime } = await import("../runtime.ts");
  const runtime = makeServerRuntime();
  try {
    const owners = await runtime.runPromise(
      ObjectStorage.use((storage) =>
        Effect.all([storage.list("stories/"), storage.list("families/")]).pipe(
          Effect.map(([stories, families]) => {
            const byOwner = new Map<string, Array<string>>();
            for (const { key } of stories) {
              const owner = /^stories\/[^/]+\/v\d+\//.exec(key)?.[0];
              if (owner && key.slice(owner.length).startsWith("pages/"))
                byOwner.set(owner, [...(byOwner.get(owner) ?? []), key]);
            }
            for (const { key } of families) {
              const owner = /^families\/[^/]+\/books\/[^/]+\//.exec(key)?.[0];
              if (owner && SHOWN_BOOK_ART.test(key)) byOwner.set(owner, [...(byOwner.get(owner) ?? []), key]);
            }
            return byOwner;
          }),
        ),
      ),
    );
    for (const [owner, keys] of owners) {
      await runtime.runPromise(spawnScreenCopies(keys, `screen-copies-backfill:${SCREEN_WIDTHS.join("-")}:${owner}`));
      console.log(`${owner}: ${keys.length} files`);
    }
    console.log(`checked ${owners.size} story versions and books; spawned tasks for their PNG, JPEG, and WebP art`);
  } finally {
    await runtime.dispose();
  }
}
