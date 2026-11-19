// One row per image provider job (docs/plan.md, "Data model"). The ID derives from the request key, so a
// retried workflow step finds the same row; the Modal callback looks it up before resuming the workflow.
import { jsonb, numeric, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const generationStatus = pgEnum("generation_status", ["submitted", "succeeded", "failed"]);

export const generation = pgTable("generation", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  /** The provider's own job ID (Modal's function call ID); null for the fake provider. */
  externalId: text("external_id"),
  request: jsonb("request").notNull(),
  status: generationStatus("status").notNull().default("submitted"),
  /** The Absurd event that resumes the waiting workflow. */
  eventName: text("event_name").notNull(),
  /** Where the provider writes the image. */
  objectKey: text("object_key").notNull(),
  error: text("error"),
  /** What the provider reported using (OpenAI's token counts), when it reports anything. */
  usage: jsonb("usage"),
  /** What the job cost in US dollars, computed from `usage` and the model's prices; null when unknown (Modal). */
  costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
