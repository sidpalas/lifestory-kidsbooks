import { schema } from "@lifestory/db";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { Database } from "../database.ts";
import { defineTask, step } from "../jobs.ts";
import { type ListedObject, ObjectStorage } from "../storage.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a proof nobody approved stays, row and PDF (D31). An approved proof stays as long as its family. */
export const PROOF_TTL_MS = 30 * DAY_MS;
/** How long a book that was never ordered stays, with its photos and sheets (D57). */
export const DRAFT_TTL_MS = DAY_MS;
/** How long an opted-in book keeps its photos for review after the order, at most (D56). */
export const REVIEW_PHOTO_TTL_MS = 30 * DAY_MS;

export interface LiveBook {
  readonly status: string;
  readonly photoReview: boolean;
  readonly orderedAt: Date | null;
}

const FAMILY_KEY = /^families\/([^/]+)\//;
const STORY_KEY = /^stories\/([^/]+)\//;
// families/<familyId>/proofs/<proofId>.pdf, as written by the render task.
const PROOF_KEY = /^families\/[^/]+\/proofs\/([^/]+)\.pdf$/;
// families/<familyId>/books/<bookId>/..., and the photos under it (D56).
const BOOK_KEY = /^families\/[^/]+\/books\/([^/]+)\/(photos\/)?/;

/** Whether a book's photos are past keeping (D56): kept while a draft, and while an opted-in book awaits review. */
const photosExpired = (book: LiveBook, now: number) => {
  if (book.status === "draft") return false;
  if (!book.photoReview || book.status === "approved" || book.status === "refused") return true;
  return book.orderedAt !== null && book.orderedAt.getTime() < now - REVIEW_PHOTO_TTL_MS;
};

/**
 * The keys the sweep deletes (D31): every `samples/` file the removed worker check left, everything under
 * `families/<id>/` of a family that no longer exists, proof PDFs whose proof row is gone, and everything under
 * `stories/<id>/` of a story that no longer exists (the parts stories D56 removed), once a day old, since an import
 * writes a new story's files before its row. Anything else, including keys it doesn't recognise, stays.
 * A book's files go with the book, and its photos as soon as nothing may read them (D56): after the order, or for a
 * book opted in to photo review, after the operator's decision or 30 days after the order.
 */
export const expiredKeys = (
  objects: ReadonlyArray<ListedObject>,
  live: {
    readonly families: ReadonlySet<string>;
    readonly proofs: ReadonlySet<string>;
    readonly stories: ReadonlySet<string>;
    readonly books: ReadonlyMap<string, LiveBook>;
  },
  now = Date.now(),
) =>
  objects
    .filter(({ key, lastModified }) => {
      if (key.startsWith("samples/")) return true;
      const storyId = STORY_KEY.exec(key)?.[1];
      if (storyId !== undefined) return !live.stories.has(storyId) && lastModified.getTime() < now - DAY_MS;
      const familyId = FAMILY_KEY.exec(key)?.[1];
      if (familyId === undefined) return false;
      if (!live.families.has(familyId)) return true;
      const bookKey = BOOK_KEY.exec(key);
      if (bookKey) {
        const book = live.books.get(bookKey[1]!);
        return !book || (bookKey[2] !== undefined && photosExpired(book, now));
      }
      const proofId = PROOF_KEY.exec(key)?.[1];
      return proofId !== undefined && !live.proofs.has(proofId);
    })
    .map(({ key }) => key);

/**
 * Deletes expired objects (D31). Object keys sit under their owner's prefix, so the bucket listing is the inventory:
 * a family's files go even when no row points at them anymore. Idempotent: a rerun lists again and finds less.
 * Rows go before their objects (expired proofs, leftover samples), so a crash in between leaves objects the next run still
 * finds. A proof row is written before its render task starts, so a PDF without a row is one whose proof expired.
 */
export const sweepStorage = defineTask({
  name: "storage.sweep",
  params: Schema.Struct({}),
  run: (_params, ctx) =>
    step(
      ctx,
      "sweep",
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        const now = Date.now();
        yield* Database.query((db) =>
          db
            .delete(schema.proof)
            .where(and(isNull(schema.proof.approvedAt), lt(schema.proof.createdAt, new Date(now - PROOF_TTL_MS)))),
        );
        // A draft never ordered goes whole after 24 h (D57); its files follow below, as a missing book's.
        yield* Database.query((db) =>
          db
            .delete(schema.book)
            .where(and(eq(schema.book.status, "draft"), lt(schema.book.createdAt, new Date(now - DRAFT_TTL_MS)))),
        );
        const objects = [
          ...(yield* storage.list("samples/")),
          ...(yield* storage.list("families/")),
          ...(yield* storage.list("stories/")),
        ];
        const familyIds = [...new Set(objects.flatMap(({ key }) => FAMILY_KEY.exec(key)?.[1] ?? []))];
        const proofIds = [...new Set(objects.flatMap(({ key }) => PROOF_KEY.exec(key)?.[1] ?? []))];
        const storyIds = [...new Set(objects.flatMap(({ key }) => STORY_KEY.exec(key)?.[1] ?? []))];
        const bookIds = [...new Set(objects.flatMap(({ key }) => BOOK_KEY.exec(key)?.[1] ?? []))];
        const [families, proofs, stories, books] = yield* Effect.all([
          familyIds.length === 0
            ? Effect.succeed([])
            : Database.query((db) =>
                db
                  .select({ id: schema.organization.id })
                  .from(schema.organization)
                  .where(inArray(schema.organization.id, familyIds)),
              ),
          proofIds.length === 0
            ? Effect.succeed([])
            : Database.query((db) =>
                db.select({ id: schema.proof.id }).from(schema.proof).where(inArray(schema.proof.id, proofIds)),
              ),
          storyIds.length === 0
            ? Effect.succeed([])
            : Database.query((db) =>
                db.select({ id: schema.story.id }).from(schema.story).where(inArray(schema.story.id, storyIds)),
              ),
          bookIds.length === 0
            ? Effect.succeed([])
            : Database.query((db) =>
                db
                  .select({
                    id: schema.book.id,
                    status: schema.book.status,
                    photoReview: schema.book.photoReview,
                    orderedAt: schema.book.orderedAt,
                  })
                  .from(schema.book)
                  .where(inArray(schema.book.id, bookIds)),
              ),
        ]);
        const keys = expiredKeys(
          objects,
          {
            families: new Set(families.map((row) => row.id)),
            proofs: new Set(proofs.map((row) => row.id)),
            stories: new Set(stories.map((row) => row.id)),
            books: new Map(books.map(({ id, ...book }) => [id, book])),
          },
          now,
        );
        const samples = keys.filter((key) => key.startsWith("samples/"));
        if (samples.length > 0) {
          yield* Database.query((db) =>
            db.delete(schema.generation).where(inArray(schema.generation.objectKey, samples)),
          );
        }
        yield* Effect.forEach(keys, storage.delete, { concurrency: 8, discard: true });
        const photosGone = [
          ...new Set(
            keys.flatMap((key) => {
              const match = BOOK_KEY.exec(key);
              return match?.[2] ? [match[1]!] : [];
            }),
          ),
        ];
        if (photosGone.length > 0)
          yield* Database.query((db) =>
            db
              .update(schema.bookLikeness)
              .set({ photoKey: null, photoDeletedAt: new Date(now) })
              .where(and(inArray(schema.bookLikeness.bookId, photosGone), isNotNull(schema.bookLikeness.photoKey))),
          );
        if (photosGone.length > 0)
          yield* Database.query((db) =>
            db
              .update(schema.bookPosePhoto)
              .set({ photoKey: null, photoDeletedAt: new Date(now) })
              .where(and(inArray(schema.bookPosePhoto.bookId, photosGone), isNotNull(schema.bookPosePhoto.photoKey))),
          );
        return { deleted: keys.length };
      }),
    ),
});
