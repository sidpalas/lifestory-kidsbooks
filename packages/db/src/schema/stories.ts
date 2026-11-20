// Stories are owned by their author (a user), never by a family. A family's
// personalized copy of a story is a separate record (`book`, added with
// personalization) that pins one story version (see docs/plan.md, "Data model").
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
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
// immutable once published, so a family's book can pin it. Until then it is the author's draft (D37): at most one
// per story, its manifest a StoryDraft (the format's shape; publishing runs the checks), and `revision` counts
// saves so a stale editor tab never overwrites a newer save.
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
    /** Draft-only source pages, proposed casting and extraction review. Not used when composing books. */
    casting: jsonb("casting").notNull().default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("story_version_story_version_key").on(t.storyId, t.version),
    check("story_version_version_positive", sql`${t.version} > 0`),
    uniqueIndex("story_version_one_draft").on(t.storyId).where(sql`${t.publishedAt} is null`),
  ],
);

// What an author added to a published version without a new one (D41): palettes, bases, and parts for options the
// version lacks, never a change to what it already has. Append-only and never changed, like the version: revision
// n is the nth addition, a book draws the version with all of them, and a proof records the revision it drew
// (proof.addition_revision). Files live under the version's folder, next to its own.
export const storyVersionAddition = pgTable(
  "story_version_addition",
  {
    storyVersionId: text("story_version_id")
      .notNull()
      .references(() => storyVersion.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    /** A StoryAddition (packages/core/src/book-format/additions.ts), checked against the version when added. */
    addition: jsonb("addition").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storyVersionId, t.revision] }), check("story_version_addition_revision_positive", sql`${t.revision} > 0`)],
);

// Who may author stories besides the operator (D37): a grant the operator gives an existing account. Studios
// (plan.md, "How Coming later fits") will later grant authoring through their own membership instead.
export const storyAuthor = pgTable("story_author", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
