// A photo book's steps (D56, D57, D58), as the parent and the operator take them. Each is one transaction plus, where
// drawing follows, a spawned task; the tasks are in tasks/photo-books.ts. The family's role checks are the same as
// for every book; the operator reads and decides family books only through `reviewBook` and `decideBook` here.
import { schema } from "@lifestory/db";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import { Auth, type SessionUser } from "./auth.ts";
import { bookFlow, loadBook } from "./books.ts";
import { AppConfig } from "./config.ts";
import { consentStatements, type Hair, MAX_LIKENESS_ROUNDS, MAX_PAGE_CHANGES, policyVersion } from "./contracts.ts";
import { Database } from "./database.ts";
import { Forbidden, InvalidInput, NotFound } from "./errors.ts";
import { requireFamilyAccess } from "./families.ts";
import { figureRules } from "./figure.ts";
import { Jobs } from "./jobs.ts";
import { Mailer } from "./mailer.ts";
import { releaseUpload, reserveUpload } from "./photo-uploads.ts";
import { ObjectStorage } from "./storage.ts";
import {
  checkPhoto,
  deleteBookPhotos,
  drawPage,
  makeBook,
  photoObjectKey,
  releaseBook,
  reviseLikeness,
} from "./tasks/photo-books.ts";

/** The longest photo the server takes; the browser resizes to at most 1536 px first (D56). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The order's price (D57): none yet; payment is settled by hand while the app is invite-only. */
const ORDER_PRICE = { priceCents: 0, currency: "USD" } as const;

const editableBook = Effect.fn("bookFlow.editable")(function* (userId: string, bookId: string) {
  const book = yield* loadBook(bookId);
  yield* requireFamilyAccess(userId, book.familyId, "edit");
  return book;
});

const requireStatus = (book: { readonly status: string }, statuses: ReadonlyArray<string>, message: string) =>
  statuses.includes(book.status) ? Effect.void : Effect.fail(new InvalidInput({ message }));

/** The parent's consent at the photo step (D58): the required statements, and the optional photo review (D56). */
export const recordConsent = Effect.fn("bookFlow.consent")(function* (
  userId: string,
  input: { readonly bookId: string; readonly statements: ReadonlyArray<string> },
) {
  const book = yield* editableBook(userId, input.bookId);
  yield* requireStatus(book, ["draft"], "This book is already ordered.");
  const { dataRetention } = yield* AppConfig;
  const missing = consentStatements(dataRetention).filter((s) => s.required && !input.statements.includes(s.id));
  if (missing.length > 0) return yield* new InvalidInput({ message: "Tick each statement to go on." });
  const statements = consentStatements(dataRetention)
    .filter((s) => input.statements.includes(s.id))
    .map((s) => s.id);
  const photoReview = statements.includes("photo-review");
  const id = `consent_${crypto.randomUUID()}`;
  yield* Database.query((db) =>
    db.transaction(async (tx) => {
      await tx.insert(schema.consent).values({
        id,
        userId,
        familyId: book.familyId,
        bookId: book.id,
        statements,
        photoReview,
        policyVersion: policyVersion(dataRetention),
      });
      await tx.update(schema.book).set({ photoReview }).where(eq(schema.book.id, book.id));
      await tx.update(schema.bookLikeness).set({ consentId: id }).where(eq(schema.bookLikeness.bookId, book.id));
    }),
  );
  return { id };
});

/**
 * Withdraws the photo review opt-in (D56): possible until the operator approves, and it deletes any photo the order
 * kept at once. Recorded as a new consent row without the statement.
 */
export const withdrawPhotoReview = Effect.fn("bookFlow.withdrawPhotoReview")(function* (
  userId: string,
  bookId: string,
) {
  const book = yield* editableBook(userId, bookId);
  if (!book.photoReview) return;
  const { dataRetention } = yield* AppConfig;
  yield* requireStatus(
    book,
    ["draft", "ordered", "making", "changes", "in_review"],
    "The book is already decided, so its photos are gone.",
  );
  yield* Database.query((db) =>
    db.transaction(async (tx) => {
      await tx.insert(schema.consent).values({
        id: `consent_${crypto.randomUUID()}`,
        userId,
        familyId: book.familyId,
        bookId,
        statements: consentStatements(dataRetention)
          .filter((s) => s.required)
          .map((s) => s.id),
        photoReview: false,
        policyVersion: policyVersion(dataRetention),
      });
      await tx.update(schema.book).set({ photoReview: false }).where(eq(schema.book.id, bookId));
    }),
  );
  if (book.status !== "draft") yield* deleteBookPhotos(book.familyId, bookId).pipe(Effect.orDie);
});

/**
 * Stores a role's photo and starts its check (D56). The parent consents first; a new photo replaces the role's
 * earlier one, whose object is deleted, and the sheets are drawn again once every role's photo passes. Each stored
 * photo counts toward the account's upload limits (D59).
 */
export const uploadPhoto = Effect.fn("bookFlow.uploadPhoto")(function* (
  userId: string,
  input: {
    readonly bookId: string;
    readonly slotId: string;
    readonly fileName: string;
    readonly contentType: string;
    readonly body: Uint8Array;
    readonly hair: Hair;
  },
) {
  const book = yield* editableBook(userId, input.bookId);
  yield* requireStatus(book, ["draft"], "This book is already ordered, so its photos can't change.");
  if (!book.manifest.characterSlots.some((slot) => slot.slotId === input.slotId))
    return yield* new NotFound({ entity: "role", id: input.slotId });
  if (!PHOTO_TYPES.has(input.contentType))
    return yield* new InvalidInput({ message: "Upload a JPEG, PNG or WebP photo." });
  if (input.body.byteLength > MAX_PHOTO_BYTES) return yield* new InvalidInput({ message: "The photo is too large." });
  const [consent] = yield* Database.query((db) =>
    db
      .select({ id: schema.consent.id })
      .from(schema.consent)
      .where(eq(schema.consent.bookId, book.id))
      .orderBy(sql`${schema.consent.createdAt} desc`)
      .limit(1),
  );
  if (!consent) return yield* new InvalidInput({ message: "Agree to how photos are used before uploading." });

  const uploadId = `up_${crypto.randomUUID()}`;
  yield* reserveUpload(userId, { id: uploadId, bookId: book.id });
  const key = photoObjectKey(book.familyId, book.id, input.slotId, uploadId);
  const storage = yield* ObjectStorage;
  yield* storage.put(key, input.body, input.contentType).pipe(
    Effect.orDie,
    Effect.onError(() => releaseUpload(uploadId)),
  );
  const [previous] = yield* Database.query((db) =>
    db
      .select({ photoKey: schema.bookLikeness.photoKey })
      .from(schema.bookLikeness)
      .where(and(eq(schema.bookLikeness.bookId, book.id), eq(schema.bookLikeness.slotId, input.slotId))),
  );
  const values = {
    photoKey: key,
    uploadId,
    photoDeletedAt: null,
    checkStatus: "checking" as const,
    check: null,
    hair: input.hair,
    consentId: consent.id,
  };
  yield* Database.query((db) =>
    db.transaction(async (tx) => {
      await tx
        .insert(schema.bookLikeness)
        .values({ bookId: book.id, slotId: input.slotId, ...values })
        .onConflictDoUpdate({ target: [schema.bookLikeness.bookId, schema.bookLikeness.slotId], set: values });
      // New photos mean new sheets: the preview starts again from round 0.
      await tx
        .update(schema.book)
        .set({ likenessStatus: "waiting", likenessRound: 0, cover: null })
        .where(eq(schema.book.id, book.id));
      await tx.update(schema.bookLikeness).set({ notes: [] }).where(eq(schema.bookLikeness.bookId, book.id));
    }),
  );
  if (previous?.photoKey) yield* storage.delete(previous.photoKey).pipe(Effect.ignore);
  yield* Jobs.use((jobs) =>
    jobs.spawn(
      checkPhoto,
      { bookId: book.id, slotId: input.slotId, uploadId, fileName: input.fileName },
      { idempotencyKey: `photo.check:${uploadId}` },
    ),
  );
  return { uploadId };
});

/** A round of changes to the sheets (D56): at most one note per role, at most two rounds. */
export const askLikenessChanges = Effect.fn("bookFlow.askLikenessChanges")(function* (
  userId: string,
  input: { readonly bookId: string; readonly notes: Readonly<Record<string, string>> },
) {
  const book = yield* editableBook(userId, input.bookId);
  yield* requireStatus(book, ["draft"], "This book is already ordered.");
  if (book.likenessStatus !== "ready")
    return yield* new InvalidInput({ message: "Wait for the characters to be drawn first." });
  if (book.likenessRound >= MAX_LIKENESS_ROUNDS)
    return yield* new InvalidInput({ message: `You've used both rounds of changes.` });
  const notes = Object.entries(input.notes)
    .map(([slotId, note]) => [slotId, note.trim().slice(0, 300)] as const)
    .filter(([, note]) => note.length > 0);
  if (notes.length === 0) return yield* new InvalidInput({ message: "Write what to change for at least one person." });
  const round = book.likenessRound + 1;
  yield* Database.query((db) =>
    db.transaction(async (tx) => {
      for (const [slotId, note] of notes)
        await tx
          .update(schema.bookLikeness)
          .set({ notes: sql`${schema.bookLikeness.notes} || ${JSON.stringify([{ round, note }])}::jsonb` })
          .where(and(eq(schema.bookLikeness.bookId, book.id), eq(schema.bookLikeness.slotId, slotId)));
      await tx
        .update(schema.book)
        .set({ likenessRound: round, likenessStatus: "drawing" })
        .where(eq(schema.book.id, book.id));
    }),
  );
  yield* Jobs.use((jobs) =>
    jobs.spawn(reviseLikeness, { bookId: book.id, round }, { idempotencyKey: `likeness.revise:${book.id}:${round}` }),
  );
  return { round };
});

/** "Make my book" (D57): the order. Every sheet must be drawn; the order row records the price as shown. */
export const orderBook = Effect.fn("bookFlow.order")(function* (userId: string, bookId: string) {
  const book = yield* editableBook(userId, bookId);
  if (book.status !== "draft") return { ordered: false };
  if (book.likenessStatus !== "ready")
    return yield* new InvalidInput({ message: "Wait for the characters to be drawn first." });
  const ordered = yield* Database.query((db) =>
    db.transaction(async (tx) => {
      const [moved] = await tx
        .update(schema.book)
        .set({ status: "ordered", orderedAt: new Date() })
        .where(and(eq(schema.book.id, bookId), eq(schema.book.status, "draft")))
        .returning({ id: schema.book.id });
      if (!moved) return false;
      await tx
        .insert(schema.bookOrder)
        .values({ id: `order_${crypto.randomUUID()}`, bookId, placedBy: userId, ...ORDER_PRICE });
      return true;
    }),
  );
  if (ordered) yield* Jobs.use((jobs) => jobs.spawn(makeBook, { bookId }, { idempotencyKey: `book.make:${bookId}` }));
  return { ordered };
});

/**
 * A parent's change to one page (D57): redraws its figures from the approved sheet with the note, as version 2.
 * At most 3 pages per book, once each; the parent then keeps either version.
 */
export const requestPageChange = Effect.fn("bookFlow.pageChange")(function* (
  userId: string,
  input: { readonly bookId: string; readonly pageId: string; readonly note: string },
) {
  const book = yield* editableBook(userId, input.bookId);
  yield* requireStatus(book, ["changes"], "Pages can be changed once the book is drawn, before it's sent for review.");
  const note = input.note.trim().slice(0, 300);
  if (note.length === 0) return yield* new InvalidInput({ message: "Say what to change on the page." });
  const pages = yield* Database.query((db) =>
    db.select().from(schema.bookPage).where(eq(schema.bookPage.bookId, book.id)),
  );
  const page = pages.find((candidate) => candidate.pageId === input.pageId);
  if (!page) return yield* new NotFound({ entity: "page", id: input.pageId });
  if (page.latestVersion > 1) return yield* new InvalidInput({ message: "This page was changed already." });
  if (pages.filter((candidate) => candidate.latestVersion > 1).length >= MAX_PAGE_CHANGES)
    return yield* new InvalidInput({ message: `You've changed ${MAX_PAGE_CHANGES} pages, the most a book allows.` });
  yield* spawnPageVersion(book.id, input.pageId, 2, note);
});

const spawnPageVersion = (bookId: string, pageId: string, version: number, note: string) =>
  Effect.gen(function* () {
    yield* Database.query((db) =>
      db
        .update(schema.bookPage)
        .set({ latestVersion: version, ready: false, changeNote: note })
        .where(and(eq(schema.bookPage.bookId, bookId), eq(schema.bookPage.pageId, pageId))),
    );
    yield* Jobs.use((jobs) =>
      jobs.spawn(
        drawPage,
        { bookId, pageId, version, note },
        { idempotencyKey: `page.figure:${bookId}:${pageId}:v${version}` },
      ),
    );
  });

/** Keeps the original drawing of a changed page, or uses the new one (D57). */
export const choosePageVersion = Effect.fn("bookFlow.chooseVersion")(function* (
  userId: string,
  input: { readonly bookId: string; readonly pageId: string; readonly version: number },
) {
  const book = yield* editableBook(userId, input.bookId);
  yield* requireStatus(book, ["changes"], "The book is in review, so its pages are settled.");
  const [art] = yield* Database.query((db) =>
    db
      .select({ version: schema.bookPageArt.version })
      .from(schema.bookPageArt)
      .where(
        and(
          eq(schema.bookPageArt.bookId, book.id),
          eq(schema.bookPageArt.pageId, input.pageId),
          eq(schema.bookPageArt.version, input.version),
        ),
      )
      .limit(1),
  );
  if (!art) return yield* new NotFound({ entity: "page version", id: `${input.pageId}/v${input.version}` });
  yield* Database.query((db) =>
    db
      .update(schema.bookPage)
      .set({ chosenVersion: input.version })
      .where(and(eq(schema.bookPage.bookId, book.id), eq(schema.bookPage.pageId, input.pageId))),
  );
});

/** Sends the book for our review (D57): every page drawn, and a proof approved. */
export const sendForReview = Effect.fn("bookFlow.sendForReview")(function* (userId: string, bookId: string) {
  const book = yield* editableBook(userId, bookId);
  yield* requireStatus(book, ["changes"], "This book isn't waiting for page changes.");
  const pending = yield* Database.query((db) =>
    db
      .select({ pageId: schema.bookPage.pageId })
      .from(schema.bookPage)
      .where(and(eq(schema.bookPage.bookId, bookId), eq(schema.bookPage.ready, false))),
  );
  if (pending.length > 0) return yield* new InvalidInput({ message: "Wait for every page to be drawn first." });
  const approved = yield* Database.query((db) =>
    db
      .select({ id: schema.proof.id })
      .from(schema.proof)
      .where(and(eq(schema.proof.bookId, bookId), isNotNull(schema.proof.approvedAt)))
      .limit(1),
  );
  if (approved.length === 0)
    return yield* new InvalidInput({ message: "Approve a proof first: it's the file we review and print." });
  yield* Database.query((db) =>
    db
      .update(schema.book)
      .set({ status: "in_review" })
      .where(and(eq(schema.book.id, bookId), eq(schema.book.status, "changes"))),
  );
});

// ---- The operator's review (D57) ---------------------------------------------------

const requireOperator = (user: Pick<SessionUser, "role">) =>
  user.role === "admin" ? Effect.void : Effect.fail(new Forbidden({ message: "Only the operator reviews books." }));

/** Books waiting for the operator, oldest first, with a flag for pages the keep-zone clip cut into. */
export const listReviewQueue = Effect.fn("bookFlow.reviewQueue")(function* (operator: SessionUser) {
  yield* requireOperator(operator);
  const books = yield* Database.query((db) =>
    db
      .select({
        id: schema.book.id,
        title: schema.book.title,
        familyName: schema.organization.name,
        photoReview: schema.book.photoReview,
        orderedAt: schema.book.orderedAt,
        updatedAt: schema.book.updatedAt,
      })
      .from(schema.book)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.book.familyId))
      .where(eq(schema.book.status, "in_review"))
      .orderBy(asc(schema.book.updatedAt)),
  );
  const flagged =
    books.length === 0
      ? []
      : yield* Database.query((db) =>
          db
            .selectDistinct({ bookId: schema.bookPageArt.bookId })
            .from(schema.bookPageArt)
            .where(
              and(
                inArray(
                  schema.bookPageArt.bookId,
                  books.map((book) => book.id),
                ),
                sql`${schema.bookPageArt.clippedShare} > ${figureRules.flagClippedShare}`,
              ),
            ),
        );
  return books.map((book) => ({
    id: book.id,
    title: book.title,
    familyName: book.familyName,
    photoReview: book.photoReview,
    sentAt: book.updatedAt.toISOString(),
    flagged: flagged.some((row) => row.bookId === book.id),
  }));
});

/**
 * The operator's only read of a family's book (D57): the sheets, every page with the parent's notes, the approved
 * proof, and the photos only on a book whose parent opted in to photo review. A future `review_access` row goes here.
 */
export const reviewBook = Effect.fn("bookFlow.review")(function* (operator: SessionUser, bookId: string) {
  yield* requireOperator(operator);
  const book = yield* loadBook(bookId);
  const flow = yield* bookFlow(book);
  const [proof] = yield* Database.query((db) =>
    db
      .select({ id: schema.proof.id, objectKey: schema.proof.objectKey })
      .from(schema.proof)
      .where(and(eq(schema.proof.bookId, bookId), isNotNull(schema.proof.approvedAt)))
      .orderBy(sql`${schema.proof.approvedAt} desc`)
      .limit(1),
  );
  return {
    flow: {
      ...flow,
      likenesses: flow.likenesses.map((likeness) => ({
        ...likeness,
        photoKey: book.photoReview ? likeness.photoKey : null,
      })),
    },
    familyId: book.familyId,
    title: book.title,
    storyId: book.storyId,
    version: book.version,
    manifest: book.manifest,
    proofKey: proof?.objectKey ?? null,
  };
});

/** Whether the operator may read a book's file: sheets and pages always, photos only on an opted-in book. */
export const operatorCanReadBookFile = Effect.fn("bookFlow.operatorCanRead")(function* (
  user: Pick<SessionUser, "role">,
  key: string,
) {
  const match = /^families\/[^/]+\/books\/([^/]+)\/(likeness|pages|photos)\//.exec(key);
  if (user.role !== "admin" || !match || key.includes("..")) return false;
  if (match[2] !== "photos") return true;
  const [row] = yield* Database.query((db) =>
    db.select({ photoReview: schema.book.photoReview }).from(schema.book).where(eq(schema.book.id, match[1]!)),
  );
  return row?.photoReview === true;
});

/** The operator redraws a page (D57), as the next version, which becomes the chosen one when drawn. */
export const redoPage = Effect.fn("bookFlow.redoPage")(function* (
  operator: SessionUser,
  input: { readonly bookId: string; readonly pageId: string; readonly note: string },
) {
  yield* requireOperator(operator);
  const book = yield* loadBook(input.bookId);
  yield* requireStatus(book, ["in_review"], "Only a book in review can be redone.");
  const [page] = yield* Database.query((db) =>
    db
      .select()
      .from(schema.bookPage)
      .where(and(eq(schema.bookPage.bookId, book.id), eq(schema.bookPage.pageId, input.pageId))),
  );
  if (!page) return yield* new NotFound({ entity: "page", id: input.pageId });
  const version = page.latestVersion + 1;
  yield* spawnPageVersion(book.id, input.pageId, version, input.note.trim() || "Redraw this page.");
  yield* Database.query((db) =>
    db
      .update(schema.bookPage)
      .set({ chosenVersion: version })
      .where(and(eq(schema.bookPage.bookId, book.id), eq(schema.bookPage.pageId, input.pageId))),
  );
});

/**
 * The operator approves the book for print, or refuses it with a note emailed to the family (D57). Either way
 * `book.release` deletes any photos kept for review.
 */
export const decideBook = Effect.fn("bookFlow.decide")(function* (
  operator: SessionUser,
  input: { readonly bookId: string; readonly decision: "approve" | "refuse"; readonly note: string },
) {
  yield* requireOperator(operator);
  const book = yield* loadBook(input.bookId);
  yield* requireStatus(book, ["in_review"], "This book isn't waiting for review.");
  const note = input.note.trim();
  if (input.decision === "refuse" && note.length === 0)
    return yield* new InvalidInput({ message: "Say why, for the family." });
  const status = input.decision === "approve" ? ("approved" as const) : ("refused" as const);
  yield* Database.query((db) =>
    db
      .update(schema.book)
      .set({ status, reviewedBy: operator.id, reviewedAt: new Date(), reviewNote: note || null })
      .where(and(eq(schema.book.id, book.id), eq(schema.book.status, "in_review"))),
  );
  yield* Jobs.use((jobs) =>
    jobs.spawn(releaseBook, { bookId: book.id }, { idempotencyKey: `book.release:${book.id}` }),
  );
  if (status === "refused") {
    const owners = yield* Database.query((db) =>
      db
        .select({ email: schema.user.email })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(and(eq(schema.member.organizationId, book.familyId), eq(schema.member.role, "owner"))),
    );
    const link = yield* Auth.use((auth) => Effect.succeed(auth.appUrl(`/books/${book.id}`)));
    yield* Effect.forEach(owners, ({ email }) =>
      Mailer.use((mailer) =>
        mailer.send({
          to: email,
          subject: `About your book ${book.title}`,
          text: `We reviewed ${book.title} and can't print it as it is:\n\n${note}\n\nReply to this email with any questions.`,
          link,
        }),
      ),
    );
  }
});
