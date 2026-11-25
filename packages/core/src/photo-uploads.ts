// Photo upload limits per account (D59): photos cost a check, and a passing one on a book whose roles all have photos
// draws every sheet and the cover again, so an account can store only so many. Every stored upload counts (a
// replacement, a photo the check refuses, one replaced before its check ran); a request refused before storing
// anything (wrong type, too large, no consent, a limit) doesn't. Uploads are recorded in `photo_upload` under a lock
// per account, so concurrent uploads can't pass a limit together.
import { schema } from "@lifestory/db";
import { and, count, eq, gt, min, sql } from "drizzle-orm";
import { Effect } from "effect";

import { Database } from "./database.ts";
import { UploadLimitReached } from "./errors.ts";

const MINUTE_MS = 60 * 1000;

export interface PhotoUploadLimits {
  readonly burst: { readonly count: number; readonly windowMs: number };
  readonly allowance: number;
  readonly perQualifyingBook: number;
}

/** The limits Sid chose (D59). */
export const photoUploadLimits: PhotoUploadLimits = {
  /** At most this many uploads in any `burst.windowMs`: a three-role book with every pose photo and a few retakes. */
  burst: { count: 20, windowMs: 10 * MINUTE_MS },
  /** Uploads an account has before any book qualifies: three or four books' worth, with retakes. */
  allowance: 40,
  /** Uploads each qualifying book adds to the allowance. */
  perQualifyingBook: 40,
};

export interface UploadUsage {
  /** Uploads ever recorded for the account. */
  readonly total: number;
  /** Uploads inside the burst window, and when the oldest of them was made. */
  readonly recent: number;
  readonly oldestRecentAt: Date | null;
  /** The account's books that raise its allowance. */
  readonly qualifyingBooks: number;
}

/** Whether one more upload fits, or the refusal to show. The allowance wins: waiting doesn't help with it. */
export const uploadRefusal = (
  usage: UploadUsage,
  now: Date,
  limits: PhotoUploadLimits = photoUploadLimits,
): UploadLimitReached | null => {
  const allowance = limits.allowance + usage.qualifyingBooks * limits.perQualifyingBook;
  if (usage.total >= allowance)
    return new UploadLimitReached({
      message:
        `You've used all ${allowance} photo uploads this account has. Each book we approve adds ` +
        `${limits.perQualifyingBook} more; if you need them sooner, write to us at the address our emails come from.`,
      retryAfterSeconds: null,
    });
  if (usage.recent >= limits.burst.count) {
    const freeAt = (usage.oldestRecentAt ?? now).getTime() + limits.burst.windowMs;
    const seconds = Math.max(1, Math.ceil((freeAt - now.getTime()) / 1000));
    const minutes = Math.ceil(seconds / 60);
    return new UploadLimitReached({
      message:
        `You've added ${limits.burst.count} photos in the last ${limits.burst.windowMs / MINUTE_MS} minutes. ` +
        `Try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.`,
      retryAfterSeconds: seconds,
    });
  }
  return null;
};

/**
 * Records an upload for the account, or fails with UploadLimitReached. Call it after the request's own checks and
 * before storing the photo; `releaseUpload` takes the record back if storing fails.
 */
export const reserveUpload = Effect.fn("photoUploads.reserve")(function* (
  userId: string,
  upload: { readonly id: string; readonly bookId: string },
) {
  const refusal = yield* Database.query((db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`photo_upload:${userId}`}, 0))`);
      const [{ now }] = (await tx.execute<{ now: Date }>(sql`select now() as now`)).rows as [{ now: Date | string }];
      const at = new Date(now);
      const since = new Date(at.getTime() - photoUploadLimits.burst.windowMs);
      const [totals] = await tx
        .select({ total: count() })
        .from(schema.photoUpload)
        .where(eq(schema.photoUpload.userId, userId));
      const [recent] = await tx
        .select({ recent: count(), oldest: min(schema.photoUpload.createdAt) })
        .from(schema.photoUpload)
        .where(and(eq(schema.photoUpload.userId, userId), gt(schema.photoUpload.createdAt, since)));
      // A book the account ordered and the operator approved, not a placed order, which is unpaid (D59).
      const [books] = await tx
        .select({ qualifying: count() })
        .from(schema.bookOrder)
        .innerJoin(schema.book, eq(schema.book.id, schema.bookOrder.bookId))
        .where(and(eq(schema.bookOrder.placedBy, userId), eq(schema.book.status, "approved")));
      const refused = uploadRefusal(
        {
          total: totals!.total,
          recent: recent!.recent,
          oldestRecentAt: recent!.oldest ? new Date(recent!.oldest) : null,
          qualifyingBooks: books!.qualifying,
        },
        at,
      );
      if (!refused)
        await tx.insert(schema.photoUpload).values({ id: upload.id, userId, bookId: upload.bookId, createdAt: at });
      return refused;
    }),
  );
  if (refusal) return yield* refusal;
});

/** Takes back an upload whose photo was never stored. */
export const releaseUpload = (id: string) =>
  Database.query((db) => db.delete(schema.photoUpload).where(eq(schema.photoUpload.id, id)));
