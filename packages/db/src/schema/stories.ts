// Stories are owned by their author (a user), never by a family. A family's
// personalized copy of a story is a separate record (`book`, added with
// personalization) that pins one story version (see docs/plan.md, "Data model").
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

export const storyStatus = pgEnum("story_status", ["draft", "published", "archived"]);

export const story = pgTable(
  "story",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    status: storyStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("story_author_idx").on(t.authorId)],
);

// One authored edition of a story: its pages, text, character slots, and layered
// illustrations, as a book format manifest (packages/core/src/book-format). Assets
// live in object storage under stories/<storyId>/v<version>/. A version is
// immutable once published, so a family's book can pin it.
export const storyVersion = pgTable(
  "story_version",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => story.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    /** Validated by StoryManifest on the way in and decoded on the way out. */
    manifest: jsonb("manifest").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("story_version_story_version_key").on(t.storyId, t.version), check("story_version_version_positive", sql`${t.version} > 0`)],
);
