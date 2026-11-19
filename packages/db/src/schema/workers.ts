// One row per worker process, refreshed every 30 s, so /api/health can say whether a worker runs and which
// commit it runs (the post-deploy check compares it with the deployed commit). Rows older than a day are deleted.
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const workerHeartbeat = pgTable("worker_heartbeat", {
  /** Random per process start. */
  id: text("id").primaryKey(),
  /** The commit the process runs (`APP_VERSION`), if the host provides it. */
  version: text("version"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  /** Postgres's clock, not the worker's, so web and worker agree on freshness. */
  beatAt: timestamp("beat_at", { withTimezone: true }).notNull().defaultNow(),
});
