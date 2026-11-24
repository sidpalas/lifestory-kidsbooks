// What a family owns (docs/plan.md, "Data model"): its personalized books. A book pins one story version and stores
// who fills each role, by name, title, pronouns and age, and the family's text edits (D56; no separate family members
// since Sid, 2026-11-24).
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

/** Who fills each of the story's roles in a book: the person as the text names them, and their age for the sheet. */
export const bookCast = pgTable(
  "book_cast",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => book.id, { onDelete: "cascade" }),
    slotId: text("slot_id").notNull(),
    name: text("name").notNull(),
    /** What the children call them ("Dad", "Nana"), for the `{{slot.title}}` text token; null to use the name. */
    title: text("title"),
    /** One of the book format's pronoun sets ("she/her", "he/him", "they/them"). */
    pronouns: text("pronouns").notNull(),
    /** One of the seven age buckets (packages/core book-format/ages.ts), one the role accepts. */
    age: text("age").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.bookId, t.slotId] })],
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
