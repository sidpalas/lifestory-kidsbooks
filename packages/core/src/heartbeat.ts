// Worker liveness for /api/health and the post-deploy check: each worker process upserts a row every
// HEARTBEAT_INTERVAL_MS with the commit it runs; health lists the workers that beat recently.
import { schema } from "@lifestory/db";
import { desc, gt, lt, sql } from "drizzle-orm";
import { Effect } from "effect";
import { AppConfig } from "./config.ts";
import { Database } from "./database.ts";

export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Three missed beats and a worker no longer counts as running. */
const LIVE_WITHIN = sql`interval '90 seconds'`;

/** Records that worker process `id` is alive, and forgets processes silent for a day. */
export const beatWorker = Effect.fn("worker.beat")(function* (id: string) {
  const { version } = yield* AppConfig;
  yield* Database.query(async (db) => {
    await db
      .insert(schema.workerHeartbeat)
      .values({ id, version })
      .onConflictDoUpdate({ target: schema.workerHeartbeat.id, set: { beatAt: sql`now()` } });
    await db.delete(schema.workerHeartbeat).where(lt(schema.workerHeartbeat.beatAt, sql`now() - interval '1 day'`));
  });
});

/** Workers that beat within the last 90 seconds, most recent first. */
export const liveWorkers = Database.query((db) =>
  db
    .select({
      version: schema.workerHeartbeat.version,
      startedAt: schema.workerHeartbeat.startedAt,
      lastBeatSecondsAgo: sql<number>`extract(epoch from now() - ${schema.workerHeartbeat.beatAt})::int`,
    })
    .from(schema.workerHeartbeat)
    .where(gt(schema.workerHeartbeat.beatAt, sql`now() - ${LIVE_WITHIN}`))
    .orderBy(desc(schema.workerHeartbeat.beatAt)),
);
