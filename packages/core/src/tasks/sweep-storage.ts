import { schema } from "@lifestory/db";
import { and, inArray, isNull, lt } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { Database } from "../database.ts";
import { defineTask, step } from "../jobs.ts";
import { type ListedObject, ObjectStorage } from "../storage.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a sample file stays (D31). */
export const SAMPLE_TTL_MS = 7 * DAY_MS;

/** How long a proof nobody approved stays, row and PDF (D31). An approved proof stays as long as its family. */
export const PROOF_TTL_MS = 30 * DAY_MS;

const FAMILY_KEY = /^families\/([^/]+)\//;
// families/<familyId>/proofs/<proofId>.pdf, as written by the render task.
const PROOF_KEY = /^families\/[^/]+\/proofs\/([^/]+)\.pdf$/;

/**
 * The keys the sweep deletes (D31): samples older than `SAMPLE_TTL_MS`, everything under `families/<id>/` of a
 * family that no longer exists, and proof PDFs whose proof row is gone (`liveProofs` holds the IDs that have one).
 * Anything else, including keys it doesn't recognise, stays.
 */
export const expiredKeys = (
  objects: ReadonlyArray<ListedObject>,
  live: { readonly families: ReadonlySet<string>; readonly proofs: ReadonlySet<string> },
  now: number,
) =>
  objects
    .filter(({ key, lastModified }) => {
      if (key.startsWith("samples/")) return now - lastModified.getTime() > SAMPLE_TTL_MS;
      const familyId = FAMILY_KEY.exec(key)?.[1];
      if (familyId === undefined) return false;
      if (!live.families.has(familyId)) return true;
      const proofId = PROOF_KEY.exec(key)?.[1];
      return proofId !== undefined && !live.proofs.has(proofId);
    })
    .map(({ key }) => key);

/**
 * Deletes expired objects (D31). Object keys sit under their owner's prefix, so the bucket listing is the inventory:
 * a family's files go even when no row points at them anymore. Idempotent: a rerun lists again and finds less.
 * Rows go before their objects (expired proofs, old samples), so a crash in between leaves objects the next run still
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
          db.delete(schema.proof).where(and(isNull(schema.proof.approvedAt), lt(schema.proof.createdAt, new Date(now - PROOF_TTL_MS)))),
        );
        const objects = [...(yield* storage.list("samples/")), ...(yield* storage.list("families/"))];
        const familyIds = [...new Set(objects.flatMap(({ key }) => FAMILY_KEY.exec(key)?.[1] ?? []))];
        const proofIds = [...new Set(objects.flatMap(({ key }) => PROOF_KEY.exec(key)?.[1] ?? []))];
        const [families, proofs] = yield* Effect.all([
          familyIds.length === 0
            ? Effect.succeed([])
            : Database.query((db) =>
                db.select({ id: schema.organization.id }).from(schema.organization).where(inArray(schema.organization.id, familyIds)),
              ),
          proofIds.length === 0
            ? Effect.succeed([])
            : Database.query((db) => db.select({ id: schema.proof.id }).from(schema.proof).where(inArray(schema.proof.id, proofIds))),
        ]);
        const keys = expiredKeys(
          objects,
          { families: new Set(families.map((row) => row.id)), proofs: new Set(proofs.map((row) => row.id)) },
          now,
        );
        const samples = keys.filter((key) => key.startsWith("samples/"));
        if (samples.length > 0) {
          yield* Database.query((db) => db.delete(schema.generation).where(inArray(schema.generation.objectKey, samples)));
        }
        yield* Effect.forEach(keys, storage.delete, { concurrency: 8, discard: true });
        return { deleted: keys.length };
      }),
    ),
});
