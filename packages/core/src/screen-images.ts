// Screen copies of story and book art. Pages show on screen at a fraction of print size, so previews load a WebP at
// the width they need instead of the 300 DPI original, which print keeps loading. A copy is made on its first request
// and stored next to its original, under the same owner prefix (D31), so the same read rules and sweep cover it.
import { Effect, Option, Semaphore } from "effect";
import sharp from "sharp";

import { ObjectStorage, type StoredObject } from "./storage.ts";

const RESIZABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

export const screenCopyKey = (key: string, width: number) => `${key}.w${width}.webp`;

/** Whether `key` is itself a screen copy, which is never copied again. */
export const isScreenCopyKey = (key: string) => /\.w\d+\.webp$/.test(key);

// Resizes run two at a time per process: a plate decodes to ~35 MB, and a page view nobody made before asks for dozens.
const resizing = Semaphore.makeUnsafe(2);

/**
 * The object at `key` no wider than `width` as WebP, made and stored on first request; never upscaled. Anything that
 * isn't PNG, JPEG, or WebP (SVG, fonts, PDFs) comes back as stored, and so does art sharp can't read.
 */
export const screenCopy = Effect.fn("screenImages.copy")(function* (key: string, width: number) {
  const storage = yield* ObjectStorage;
  const copyKey = screenCopyKey(key, width);
  const stored = storage.get(copyKey).pipe(Effect.option);
  const cached = yield* stored;
  if (Option.isSome(cached)) return cached.value;
  return yield* resizing.withPermits(1)(
    Effect.gen(function* () {
      // Another request may have made it while this one waited.
      const made = yield* stored;
      if (Option.isSome(made)) return made.value;
      const original = yield* storage.get(key);
      if (!RESIZABLE.has(original.contentType)) return original;
      const resized = yield* Effect.tryPromise(() =>
        sharp(original.body)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 80, alphaQuality: 90 })
          .toBuffer(),
      ).pipe(Effect.option);
      if (Option.isNone(resized)) return original;
      const copy: StoredObject = { body: new Uint8Array(resized.value), contentType: "image/webp" };
      yield* storage.put(copyKey, copy.body, copy.contentType);
      return copy;
    }),
  );
});
