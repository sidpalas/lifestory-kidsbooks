// Variant parts generated at authoring time (D26, D30; docs/plan.md, "Authoring-time part generation"): one row per
// generated option for one figure appearance (a role's base on a page), from request to the illustrator's review.
// The part's files live with its story version under `stories/<storyId>/v<n>/parts/` (D31). Approved parts go into
// the version's manifest as `Part` entries, so book composition never reads this table.
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { generation } from "./generations.ts";
import { storyVersion } from "./stories.ts";

export const partStatus = pgEnum("part_status", ["generating", "pending_review", "approved", "rejected", "failed"]);

export const storyPart = pgTable(
  "story_part",
  {
    /** Derived from the story version, appearance, option, and seed, so repeating a request finds the same part. */
    id: text("id").primaryKey(),
    storyVersionId: text("story_version_id")
      .notNull()
      .references(() => storyVersion.id, { onDelete: "cascade" }),
    /** The appearance: the figure of `slotId` on `pageId`, and its base for `age` and `face`. */
    pageId: text("page_id").notNull(),
    slotId: text("slot_id").notNull(),
    age: text("age").notNull(),
    face: text("face").notNull(),
    /** From teen up, which of the face type's two bases (D40); null below teen. */
    features: text("features"),
    axis: text("axis").notNull(),
    option: text("option").notNull(),
    /** A new seed is a new attempt at the same option. */
    seed: integer("seed").notNull(),
    /** Where the part may be, [x0, y0, x1, y1] in thousandths of the base (the head zone). */
    zone: jsonb("zone").notNull(),
    /**
     * The figure's drawn region (D56), [[x, y], ...] in thousandths of the base: every layer is clipped to it, and the
     * zone is its bounding box. Null for a part cut out within its zone alone.
     */
    region: jsonb("region"),
    /** The illustrator's guidance added to the prompt, such as "two short braids". */
    note: text("note"),
    prompt: text("prompt").notNull(),
    status: partStatus("status").notNull().default("generating"),
    taskId: text("task_id"),
    generationId: text("generation_id").references(() => generation.id, { onDelete: "set null" }),
    /**
     * The RGBA layers cut out, split by region (D26): `[{ asset, at, palette }]`, the asset relative to the story
     * version's folder, `at` in thousandths of the base. The part itself takes the axis's palette; skin the model
     * drew inside it (an ear over a glasses arm) takes the skin palette.
     */
    layers: jsonb("layers"),
    /** Review images, relative to the version's folder: the part on the lightest and darkest skin. */
    previews: jsonb("previews"),
    /** How the cut-out went: alignment shift, colour fit, re-composite error, alpha coverage. */
    metrics: jsonb("metrics"),
    error: text("error"),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewReason: text("review_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("story_part_story_version_idx").on(t.storyVersionId)],
);
