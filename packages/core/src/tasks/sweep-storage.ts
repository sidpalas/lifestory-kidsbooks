import { schema } from "@lifestory/db";
import { inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { Database } from "../database.ts";
import { defineTask, step } from "../jobs.ts";
import { type ListedObject, ObjectStorage } from "../storage.ts";

/** How long a sample file stays (D31). */
export const SAMPLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const FAMILY_KEY = /^families\/([^/]+)\//;

/**
 * The keys the sweep deletes (D31): samples older than `SAMPLE_TTL_MS`, and everything under `families/<id>/` of a
 * family that no longer exists. Anything else, including keys it doesn't recognise, stays.
 */
export const expiredKeys = (objects: ReadonlyArray<ListedObject>, liveFamilies: ReadonlySet<string>, now: number) =>
  objects
    .filter(({ key, lastModified }) => {
      if (key.startsWith("samples/")) return now - lastModified.getTime() > SAMPLE_TTL_MS;
      const familyId = FAMILY_KEY.exec(key)?.[1];
      return familyId !== undefined && !liveFamilies.has(familyId);
    })
    .map(({ key }) => key);

/**
 * Deletes expired objects (D31). Object keys sit under their owner's prefix, so the bucket listing is the inventory:
 * a family's files go even when no row points at them anymore. Idempotent: a rerun lists again and finds less.
 * Sample rows go before their objects, so a crash in between leaves objects the next run still finds.
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
        const objects = [...(yield* storage.list("samples/")), ...(yield* storage.list("families/"))];
        const familyIds = [...new Set(objects.flatMap(({ key }) => FAMILY_KEY.exec(key)?.[1] ?? []))];
        const live =
          familyIds.length === 0
            ? []
            : yield* Database.query((db) =>
                db
                  .select({ id: schema.organization.id })
                  .from(schema.organization)
                  .where(inArray(schema.organization.id, familyIds)),
              );
        const keys = expiredKeys(objects, new Set(live.map((row) => row.id)), Date.now());
        const samples = keys.filter((key) => key.startsWith("samples/"));
        if (samples.length > 0) {
          yield* Database.query((db) => db.delete(schema.generation).where(inArray(schema.generation.objectKey, samples)));
        }
        yield* Effect.forEach(keys, storage.delete, { concurrency: 8, discard: true });
        return { deleted: keys.length };
      }),
    ),
});
