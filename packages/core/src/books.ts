// A family's personalized books (D56). A book pins one story version and stores who fills each role (name, title,
// pronouns, age) and the family's text edits; each figure on a page is drawn from the book's character sheet by a task, and a page shows the stock
// figure until its own is drawn.
import { schema } from "@lifestory/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import {
  ageLabel,
  type CastMember,
  composePage,
  decodeStoryManifest,
  pageText,
  type StoryManifest,
} from "./book-format/index.ts";
import { resolveText, tokenIssues } from "./book-format/text.ts";
import type { BookRole, BookSummary, BookView } from "./contracts.ts";
import { CastPerson } from "./contracts.ts";
import { Database } from "./database.ts";
import { BookExists, InvalidInput, NotFound } from "./errors.ts";
import { requireFamilyAccess } from "./families.ts";
import { createProof, proofSummaries, releaseDeletedProof } from "./proofs.ts";
import { readableStoryVersion } from "./stories.ts";

/** Every role filled, by a person of an age the role accepts, and no role the story lacks. */
const decodePerson = Schema.decodeUnknownEffect(CastPerson);

const checkCast = Effect.fn("books.checkCast")(function* (
  manifest: StoryManifest,
  cast: Readonly<Record<string, CastPerson>>,
) {
  for (const slot of manifest.characterSlots) {
    const person = cast[slot.slotId];
    if (!person) return yield* new InvalidInput({ message: `Say who plays ${slot.label.toLowerCase()}.` });
    if (!slot.ages.includes(person.age)) {
      return yield* new InvalidInput({
        message: `${person.name} can't play ${slot.label.toLowerCase()}: the role is for ${slot.ages.map((age) => ageLabel(age).toLowerCase()).join(" or ")}.`,
      });
    }
  }
  for (const slotId of Object.keys(cast)) {
    if (!manifest.characterSlots.some((slot) => slot.slotId === slotId))
      return yield* new InvalidInput({ message: `The story has no role "${slotId}".` });
  }
});

const castMember = (person: CastPerson): CastMember => ({
  name: person.name,
  ...(person.title ? { title: person.title } : {}),
  pronouns: person.pronouns,
});

/**
 * The people in the family's books, newest first and each once (by name, title, pronouns and age), so a parent making
 * another book can pick them instead of typing them again.
 */
export const listCastPeople = Effect.fn("books.listCastPeople")(function* (userId: string, familyId: string) {
  yield* requireFamilyAccess(userId, familyId, "read");
  const rows = yield* Database.query((db) =>
    db
      .select({
        name: schema.bookCast.name,
        title: schema.bookCast.title,
        pronouns: schema.bookCast.pronouns,
        age: schema.bookCast.age,
      })
      .from(schema.bookCast)
      .innerJoin(schema.book, eq(schema.book.id, schema.bookCast.bookId))
      .where(eq(schema.book.familyId, familyId))
      .orderBy(desc(schema.book.createdAt)),
  );
  const seen = new Set<string>();
  const people: Array<CastPerson> = [];
  for (const row of rows) {
    const person = yield* decodePerson(row).pipe(Effect.orDie);
    const key = JSON.stringify(person);
    if (seen.has(key)) continue;
    seen.add(key);
    people.push(person);
  }
  return people;
});

/** The family's books, newest first, for any member. */
export const listBooks = Effect.fn("books.list")(function* (userId: string, familyId: string) {
  const access = yield* requireFamilyAccess(userId, familyId, "read");
  const rows = yield* Database.query((db) =>
    db
      .select({
        id: schema.book.id,
        title: schema.book.title,
        storySlug: schema.story.slug,
        storyTitle: schema.story.title,
        version: schema.storyVersion.version,
        name: schema.bookCast.name,
      })
      .from(schema.book)
      .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.book.storyVersionId))
      .innerJoin(schema.story, eq(schema.story.id, schema.storyVersion.storyId))
      .leftJoin(schema.bookCast, eq(schema.bookCast.bookId, schema.book.id))
      .where(eq(schema.book.familyId, familyId))
      .orderBy(asc(schema.book.createdAt), asc(schema.bookCast.slotId)),
  );
  const books = new Map<
    string,
    { id: string; title: string; storySlug: string; storyTitle: string; version: number; names: Array<string> }
  >();
  for (const row of rows) {
    const { name: _, ...summary } = row;
    const book = books.get(row.id) ?? { ...summary, names: [] };
    if (row.name) book.names.push(row.name);
    books.set(row.id, book);
  }
  const summaries: ReadonlyArray<BookSummary> = [...books.values()]
    .toReversed()
    .map(({ names, ...book }) => ({ ...book, cast: names.join(", ") }));
  return { books: summaries, canEdit: access.canEdit };
});

/**
 * Starts a family's book of the newest version of a story the user may read, with a person in every role.
 * Fails with InvalidInput when a role is empty or its person is another age than the role, and with BookExists
 * when the family has a book of the story, of any version, that isn't in `existing`: a person makes another copy only
 * after seeing every one the family has. Checked under a lock per family and story, so a double click or a second tab
 * makes one book, not two. Existing books are never changed.
 */
export const createBook = Effect.fn("books.create")(function* (
  userId: string,
  familyId: string,
  input: {
    readonly slug: string;
    readonly cast: Readonly<Record<string, CastPerson>>;
    /** The family's books of this story the person saw and chose to make another copy next to. */
    readonly existing?: ReadonlyArray<string>;
  },
) {
  yield* requireFamilyAccess(userId, familyId, "edit");
  const { story, storyVersionId, manifest } = yield* readableStoryVersion(userId, input.slug);
  yield* checkCast(manifest, input.cast);
  const id = `book_${crypto.randomUUID()}`;
  const unseen = yield* Database.query((db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`book:${familyId}:${story.id}`}, 0))`);
      // Checked here, not only when reading the story, so a story archived meanwhile gets no new book (D49).
      const [current] = await tx
        .select({ status: schema.story.status })
        .from(schema.story)
        .where(eq(schema.story.id, story.id));
      if (current?.status === "archived") return "archived" as const;
      const books = await tx
        .select({ id: schema.book.id })
        .from(schema.book)
        .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.book.storyVersionId))
        .where(and(eq(schema.book.familyId, familyId), eq(schema.storyVersion.storyId, story.id)))
        .orderBy(desc(schema.book.createdAt));
      const bookIds = books.map((book) => book.id);
      if (bookIds.some((bookId) => !input.existing?.includes(bookId))) return bookIds;
      await tx.insert(schema.book).values({ id, familyId, storyVersionId, title: story.title });
      await tx
        .insert(schema.bookCast)
        .values(Object.entries(input.cast).map(([slotId, person]) => ({ bookId: id, slotId, ...person })));
      return null;
    }),
  );
  if (unseen === "archived")
    return yield* new InvalidInput({ message: `${story.title} is archived, so no new books are made of it.` });
  if (unseen) {
    return yield* new BookExists({
      message: `Your family already has ${unseen.length === 1 ? "a book" : `${unseen.length} books`} of ${story.title}, so no new one was made.`,
      bookIds: unseen,
    });
  }
  return { id };
});

const loadBook = Effect.fn("books.load")(function* (bookId: string) {
  const [row] = yield* Database.query((db) =>
    db
      .select({
        id: schema.book.id,
        familyId: schema.book.familyId,
        title: schema.book.title,
        storyId: schema.story.id,
        storyVersionId: schema.book.storyVersionId,
        slug: schema.story.slug,
        storyTitle: schema.story.title,
        authorName: schema.user.name,
        version: schema.storyVersion.version,
        manifest: schema.storyVersion.manifest,
      })
      .from(schema.book)
      .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.book.storyVersionId))
      .innerJoin(schema.story, eq(schema.story.id, schema.storyVersion.storyId))
      .innerJoin(schema.user, eq(schema.user.id, schema.story.authorId))
      .where(eq(schema.book.id, bookId)),
  );
  if (!row) return yield* new NotFound({ entity: "book", id: bookId });
  const manifest: StoryManifest = yield* decodeStoryManifest(row.manifest).pipe(Effect.orDie);
  return { ...row, manifest };
});

/** A book the user may read (`access` "read") or edit, with its manifest. Non-members get NotFound. */
const bookFor = Effect.fn("books.bookFor")(function* (userId: string, bookId: string, access: "read" | "edit") {
  const book = yield* loadBook(bookId);
  const { canEdit } = yield* requireFamilyAccess(userId, book.familyId, access);
  return { book, canEdit };
});

/**
 * Everything BookPage needs for every page of a book: each page's illustration, with the stock figures until the
 * book's own are drawn (D56), and each text block with the family's edit applied.
 */
export const getBook = Effect.fn("books.get")(function* (userId: string, bookId: string) {
  const { book, canEdit } = yield* bookFor(userId, bookId, "read");
  const { manifest } = book;
  const [castRows, edits] = yield* Effect.all([
    Database.query((db) => db.select().from(schema.bookCast).where(eq(schema.bookCast.bookId, bookId))),
    Database.query((db) => db.select().from(schema.bookTextEdit).where(eq(schema.bookTextEdit.bookId, bookId))),
  ]);

  const roles: Array<BookRole> = [];
  for (const slot of manifest.characterSlots) {
    const row = castRows.find((candidate) => candidate.slotId === slot.slotId);
    if (!row) continue;
    const person = yield* decodePerson(row).pipe(Effect.orDie);
    roles.push({ slotId: slot.slotId, person, member: castMember(person) });
  }
  const cast: Record<string, CastMember> = Object.fromEntries(roles.map((role) => [role.slotId, role.member]));

  const pages = manifest.pages.map((page) => ({
    pageId: page.pageId,
    layers: composePage({ storyId: book.storyId, version: book.version }, page),
    text: pageText(page).map((block, blockIndex) => {
      const edited =
        edits.find((edit) => edit.pageId === page.pageId && edit.blockIndex === blockIndex)?.content ?? null;
      return { style: block.style, original: block.content, edited, text: resolveText(edited ?? block.content, cast) };
    }),
  }));
  const view: BookView = {
    book: { id: book.id, familyId: book.familyId, title: book.title },
    story: { id: book.storyId, slug: book.slug, title: book.storyTitle, authorName: book.authorName },
    version: book.version,
    manifest,
    roles,
    cast,
    pages,
  };
  return { view, canEdit };
});

/** Changes who plays a role: their name, title, pronouns or age. */
export const setBookCast = Effect.fn("books.setCast")(function* (
  userId: string,
  input: { readonly bookId: string; readonly slotId: string; readonly person: CastPerson },
) {
  const { book } = yield* bookFor(userId, input.bookId, "edit");
  const rows = yield* Database.query((db) =>
    db.select().from(schema.bookCast).where(eq(schema.bookCast.bookId, input.bookId)),
  );
  const cast: Record<string, CastPerson> = {};
  for (const row of rows) cast[row.slotId] = yield* decodePerson(row).pipe(Effect.orDie);
  cast[input.slotId] = input.person;
  yield* checkCast(book.manifest, cast);
  yield* Database.query((db) =>
    db
      .insert(schema.bookCast)
      .values({ bookId: input.bookId, slotId: input.slotId, ...input.person })
      .onConflictDoUpdate({ target: [schema.bookCast.bookId, schema.bookCast.slotId], set: input.person }),
  );
});

/**
 * Replaces one text block of a page with the family's wording, or with `content` null restores the story's. Tokens
 * such as {{hero.name}} still work; unknown ones fail with InvalidInput so the page never prints a raw token.
 */
export const saveTextEdit = Effect.fn("books.saveTextEdit")(function* (
  userId: string,
  input: {
    readonly bookId: string;
    readonly pageId: string;
    readonly blockIndex: number;
    readonly content: string | null;
  },
) {
  const { book } = yield* bookFor(userId, input.bookId, "edit");
  const page = book.manifest.pages.find((candidate) => candidate.pageId === input.pageId);
  const block = page && pageText(page)[input.blockIndex];
  if (!page || !block) return yield* new NotFound({ entity: "text block", id: `${input.pageId}/${input.blockIndex}` });
  const key = and(
    eq(schema.bookTextEdit.bookId, input.bookId),
    eq(schema.bookTextEdit.pageId, input.pageId),
    eq(schema.bookTextEdit.blockIndex, input.blockIndex),
  );
  const content = input.content?.trim() ?? null;
  if (content === null || content === block.content) {
    yield* Database.query((db) => db.delete(schema.bookTextEdit).where(key));
    return;
  }
  if (content.length === 0) return yield* new InvalidInput({ message: "A text block can't be empty." });
  const issues = tokenIssues(content, new Set(book.manifest.characterSlots.map((slot) => slot.slotId)));
  if (issues.length > 0) return yield* new InvalidInput({ message: issues.join("; ") });
  yield* Database.query((db) =>
    db
      .insert(schema.bookTextEdit)
      .values({ bookId: input.bookId, pageId: input.pageId, blockIndex: input.blockIndex, content })
      .onConflictDoUpdate({
        target: [schema.bookTextEdit.bookId, schema.bookTextEdit.pageId, schema.bookTextEdit.blockIndex],
        set: { content },
      }),
  );
});

/**
 * Starts a PDF proof of the book as it stands: the cast as drawn now and the family's text edits, copied into the
 * proof (D27), so later changes don't alter it. Fails with InvalidInput while a role can't be drawn.
 */
export const requestBookProof = Effect.fn("books.requestProof")(function* (userId: string, bookId: string) {
  const { book } = yield* bookFor(userId, bookId, "edit");
  const { view } = yield* getBook(userId, bookId);
  if (view.roles.length < view.manifest.characterSlots.length)
    return yield* new InvalidInput({ message: "Every role needs someone in it before the book can be printed." });
  const edits = yield* Database.query((db) =>
    db
      .select({
        pageId: schema.bookTextEdit.pageId,
        blockIndex: schema.bookTextEdit.blockIndex,
        content: schema.bookTextEdit.content,
      })
      .from(schema.bookTextEdit)
      .where(eq(schema.bookTextEdit.bookId, bookId)),
  );
  return yield* createProof({
    familyId: book.familyId,
    bookId,
    storyVersionId: book.storyVersionId,
    content: { cast: view.cast, textEdits: edits },
    requestedBy: userId,
  });
});

/** A book's proofs, newest first, for any member of its family. */
export const listBookProofs = Effect.fn("books.listProofs")(function* (userId: string, bookId: string) {
  const { book, canEdit } = yield* bookFor(userId, bookId, "read");
  const proofs = yield* proofSummaries(eq(schema.proof.bookId, bookId), book.manifest);
  return { canRequest: canEdit, proofs };
});

/**
 * Deletes a book for a role that edits books: its cast, text edits, and proofs, approved or not (all cascaded), then
 * cancels the proofs' renders and deletes their PDFs. No print orders exist yet to keep an approved proof for (D32).
 * A proof requested while the book is deleted goes with it too; the `storage.sweep` task deletes any PDF left behind,
 * and none is served without its proof.
 */
export const deleteBook = Effect.fn("books.delete")(function* (userId: string, bookId: string) {
  yield* bookFor(userId, bookId, "edit");
  const proofs = yield* Database.query((db) =>
    db.transaction(async (tx) => {
      const deleted = await tx
        .delete(schema.proof)
        .where(eq(schema.proof.bookId, bookId))
        .returning({ id: schema.proof.id, familyId: schema.proof.familyId, taskId: schema.proof.taskId });
      await tx.delete(schema.book).where(eq(schema.book.id, bookId));
      return deleted;
    }),
  );
  yield* Effect.forEach(proofs, releaseDeletedProof, { discard: true });
});
