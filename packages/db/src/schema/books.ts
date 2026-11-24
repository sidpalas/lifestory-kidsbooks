// What a family owns (docs/plan.md, "Data model"): its personalized books. A book pins one story version and stores
// who fills each role, by name, title, pronouns and age, and the family's text edits (D56; no separate family members
// since Sid, 2026-11-24).
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";
import { storyVersion } from "./stories.ts";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Where a book is in its life (D57): a draft gathers photos and sheets, "Make my book" orders it, `book.make` draws
 * every page, the parent changes up to 3 pages and sends it for review, and the operator approves or refuses it.
 */
export const bookStatus = pgEnum("book_status", [
  "draft",
  "ordered",
  "making",
  "changes",
  "in_review",
  "approved",
  "refused",
]);

/** Where a draft's character sheets and cover are (D56): waiting for photos, being drawn, ready, or failed. */
export const likenessStatus = pgEnum("likeness_status", ["waiting", "drawing", "ready", "failed"]);

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
    status: bookStatus("status").notNull().default("draft"),
    /** The parent let our team see the photos while reviewing the book (D56); off by default. */
    photoReview: boolean("photo_review").notNull().default(false),
    likenessStatus: likenessStatus("likeness_status").notNull().default("waiting"),
    /** Change rounds asked for on the sheets so far (D56: at most two). */
    likenessRound: integer("likeness_round").notNull().default(0),
    /** The cover's drawn figure layers, one per figure of the first page, bottom to top; null before the first sheets. */
    cover: jsonb("cover").$type<ReadonlyArray<string>>(),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    /** The operator's decision (D57): who, when, and the note sent with a refusal. */
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    ...timestamps,
  },
  (t) => [index("book_family_idx").on(t.familyId), index("book_status_idx").on(t.status)],
);

/** Whether a photo passed the check (D56); a refused photo is deleted at once. */
export const photoCheckStatus = pgEnum("photo_check_status", ["checking", "passed", "refused"]);

/**
 * One role's likeness in a book (D56): the photo while it's kept, what the check found, the hair as the parent
 * described it, and the current character sheet, which every page is drawn from.
 */
export const bookLikeness = pgTable(
  "book_likeness",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => book.id, { onDelete: "cascade" }),
    slotId: text("slot_id").notNull(),
    /** `families/<familyId>/books/<bookId>/photos/<slotId>/<uploadId>`; null once deleted. */
    photoKey: text("photo_key"),
    uploadId: text("upload_id"),
    photoDeletedAt: timestamp("photo_deleted_at", { withTimezone: true }),
    checkStatus: photoCheckStatus("check_status"),
    /** The check's report and verdict (refusals and warnings), as `PhotoCheckResult`. */
    check: jsonb("check"),
    /** Hair chips: colour, length, texture. */
    hair: jsonb("hair").$type<{ colour: string; length: string; texture: string }>(),
    sheetKey: text("sheet_key"),
    /** Each round's note on this character, oldest first. */
    notes: jsonb("notes").$type<ReadonlyArray<{ round: number; note: string }>>().notNull().default([]),
    consentId: text("consent_id").references(() => consent.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.bookId, t.slotId] })],
);

/** A page of a made book: the version of its figures the parent chose, and the change they asked for (D57). */
export const bookPage = pgTable(
  "book_page",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => book.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    /** The version drawn last; 1 is `book.make`'s, 2 a change, more an operator's redo. */
    latestVersion: integer("latest_version").notNull().default(1),
    chosenVersion: integer("chosen_version").notNull().default(1),
    /** Whether the latest version is drawn yet. */
    ready: boolean("ready").notNull().default(false),
    changeNote: text("change_note"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.bookId, t.pageId] })],
);

/** One drawn figure layer of one version of a page (`page.figure`), with the checks' measurements. */
export const bookPageArt = pgTable(
  "book_page_art",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => book.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    version: integer("version").notNull(),
    /** The figure's place among the page's figures, bottom to top. */
    figure: integer("figure").notNull(),
    slotId: text("slot_id").notNull(),
    objectKey: text("object_key").notNull(),
    generationId: text("generation_id"),
    /** Overlap of the drawn figure with the bald one, after any rescale. */
    iou: doublePrecision("iou").notNull(),
    rescaled: boolean("rescaled").notNull(),
    /** Share of the drawn figure's pixels the keep zone clipped away; the review queue flags high ones. */
    clippedShare: doublePrecision("clipped_share").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.bookId, t.pageId, t.version, t.figure] })],
);

/** "Make my book" (D57): the order, with the price as shown. No payment provider yet; paid by hand while invite-only. */
export const bookOrder = pgTable("book_order", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .unique()
    .references(() => book.id, { onDelete: "cascade" }),
  placedBy: text("placed_by").references(() => user.id, { onDelete: "set null" }),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("placed"),
  ...timestamps,
});

/**
 * What a parent agreed to at the photo step (D58): the statements, the policy version, and the optional photo review.
 * Stays as long as the account, after the book is gone.
 */
export const consent = pgTable(
  "consent",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    familyId: text("family_id").references(() => organization.id, { onDelete: "set null" }),
    bookId: text("book_id").references(() => book.id, { onDelete: "set null" }),
    statements: jsonb("statements").$type<ReadonlyArray<string>>().notNull(),
    photoReview: boolean("photo_review").notNull(),
    policyVersion: text("policy_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consent_user_idx").on(t.userId)],
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
