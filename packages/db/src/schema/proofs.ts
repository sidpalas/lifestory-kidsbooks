// A print-ready PDF proof (docs/plan.md, "Editor and print"; D27). It belongs to a family and records what it
// shows: the story version, the cast, and the family's text edits at the moment it was requested, so the PDF never
// changes after it's made and a print order can later reference it. The parent approves a book's proof for print.
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";
import { book } from "./books.ts";
import { storyVersion } from "./stories.ts";

export const proofStatus = pgEnum("proof_status", ["rendering", "ready"]);

export const proof = pgTable(
  "proof",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The book it was made from; null for a proof of a story preview. A proof outlives its book. */
    bookId: text("book_id").references(() => book.id, { onDelete: "set null" }),
    storyVersionId: text("story_version_id")
      .notNull()
      .references(() => storyVersion.id, { onDelete: "restrict" }),
    /** ProofContent (packages/core/src/proofs.ts): the cast and text edits the PDF shows. */
    content: jsonb("content").notNull(),
    status: proofStatus("status").notNull().default("rendering"),
    /** The Absurd task rendering it; a failed task means a failed proof. */
    taskId: text("task_id"),
    /** Where the PDF is, once ready. */
    objectKey: text("object_key"),
    pageCount: integer("page_count"),
    bytes: integer("bytes"),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    /**
     * When a parent approved the PDF for print, and who; null until then. Only a ready proof of a book can be approved,
     * once, and an approved proof is kept as long as its family (D31); an unapproved one expires.
     */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("proof_family_idx").on(t.familyId, t.storyVersionId), index("proof_book_idx").on(t.bookId)],
);
