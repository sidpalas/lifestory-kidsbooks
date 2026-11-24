// What a family owns (docs/plan.md, "Data model"): its members, and its personalized books. A book pins one story
// version and stores who fills each role and the family's text edits (D56).
import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth.ts";
import { storyVersion } from "./stories.ts";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** A family member: a name, an optional title, pronouns and an age (D29). Photos belong to a book, never here (D56). */
export const character = pgTable(
  "character",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** What the children call them ("Dad", "Nana"), for the `{{slot.title}}` text token; null to use the name. */
    title: text("title"),
    /** One of the book format's pronoun sets ("she/her", "he/him", "they/them"). */
    pronouns: text("pronouns").notNull(),
    /** One of the seven age buckets (packages/core book-format/ages.ts). */
    age: text("age").notNull(),
    ...timestamps,
  },
  (t) => [index("character_family_idx").on(t.familyId)],
);

/** A family's personalized copy of one story version. */
export const book = pgTable(
  "book",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    storyVersionId: text("story_version_id")
      .notNull()
      .references(() => storyVersion.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    ...timestamps,
  },
  (t) => [index("book_family_idx").on(t.familyId)],
);

/** Who fills each of the story's roles in a book. */
export const bookCast = pgTable(
  "book_cast",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => book.id, { onDelete: "cascade" }),
    slotId: text("slot_id").notNull(),
    characterId: text("character_id")
      .notNull()
      // "no action", not "restrict": deleting a family cascades to its books and characters in one statement.
      .references(() => character.id, { onDelete: "no action" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.bookId, t.slotId] }), index("book_cast_character_idx").on(t.characterId)],
);

/** A family's replacement for one text block of one page; no row means the story's text. */
export const bookTextEdit = pgTable(
  "book_text_edit",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => book.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    blockIndex: integer("block_index").notNull(),
    content: text("content").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.bookId, t.pageId, t.blockIndex] })],
);
