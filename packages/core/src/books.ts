// A family's personalized books (plan.md, "Data model" and "Composing pages"). A book pins one story version and
// stores only who fills each role, overrides for options that version can't draw, and text edits. Pages are composed
// from those and the characters' current looks every time they're shown, so a look change applies to every page of
// every book at once, and nothing is rendered or invalidated (D26: no AI, no GPU when a book is made).
import { schema } from "@lifestory/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { type CastMember, castLook, LookOverride, type StoryManifest, withLookChanges } from "./book-format/index.ts";
import { resolveText, tokenIssues } from "./book-format/text.ts";
import type { BookRole, BookSummary, BookView, Character } from "./contracts.ts";
import { Character as CharacterSchema } from "./contracts.ts";
import { Database } from "./database.ts";
import { BookExists, InvalidInput, NotFound } from "./errors.ts";
import { requireFamilyAccess } from "./families.ts";
import { composeIllustration } from "./looks/compose.ts";
import { ageLabel, type Look } from "./looks/vocabulary.ts";
import { resolveIllustration } from "./pages.ts";
import { createProof, proofSummaries, releaseDeletedProof } from "./proofs.ts";
import { readableStoryVersion, withStoredAdditions } from "./stories.ts";

const decodeCharacter = Schema.decodeUnknownEffect(CharacterSchema);
const decodeOverride = Schema.decodeUnknownEffect(LookOverride);
/** No row value for no changes, so "drawn as saved" has one representation. */
const lookChangesOrNull = (changes: LookOverride | undefined) =>
  changes && Object.keys(changes).length > 0 ? changes : null;

const familyCharacters = (familyId: string, ids: ReadonlyArray<string>) =>
  ids.length === 0
    ? Effect.succeed([] as ReadonlyArray<Character>)
    : Database.query((db) =>
        db
          .select({
            id: schema.character.id,
            familyId: schema.character.familyId,
            name: schema.character.name,
            title: schema.character.title,
            pronouns: schema.character.pronouns,
            look: schema.character.look,
          })
          .from(schema.character)
          .where(and(eq(schema.character.familyId, familyId), inArray(schema.character.id, [...ids]))),
      ).pipe(Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeCharacter(row).pipe(Effect.orDie))));

/**
 * Fails with InvalidInput when `changes` asks for an option the story can't draw for the role (D46): a per-book look
 * offers only what the story draws, so it never needs a stand-in.
 */
const checkLookChanges = (manifest: StoryManifest, slotId: string, look: Look, changes: LookOverride) => {
  const missing = castLook(manifest, slotId, withLookChanges(look, changes)).unsupported.filter(
    (axis) => axis in changes,
  );
  return missing.length > 0
    ? Effect.fail(new InvalidInput({ message: `This story can't draw that ${missing.join(", ")} yet.` }))
    : Effect.void;
};

/** Every role filled by a character of the book's family, of the role's age, with look changes the story draws. */
const checkCast = Effect.fn("books.checkCast")(function* (
  manifest: StoryManifest,
  familyId: string,
  cast: Readonly<Record<string, string>>,
  looks: Readonly<Record<string, LookOverride>> = {},
) {
  const characters = yield* familyCharacters(familyId, Object.values(cast));
  for (const slot of manifest.characterSlots) {
    const character = characters.find((candidate) => candidate.id === cast[slot.slotId]);
    if (!character) return yield* new InvalidInput({ message: `Choose who plays ${slot.label.toLowerCase()}.` });
    if (castLook(manifest, slot.slotId, character.look).wrongAge) {
      return yield* new InvalidInput({
        message: `${character.name} can't play ${slot.label.toLowerCase()}: the role is for ${slot.ages.map((age) => ageLabel(age).toLowerCase()).join(", ")}.`,
      });
    }
    yield* checkLookChanges(manifest, slot.slotId, character.look, looks[slot.slotId] ?? {});
  }
  for (const slotId of Object.keys(cast)) {
    if (!manifest.characterSlots.some((slot) => slot.slotId === slotId))
      return yield* new InvalidInput({ message: `The story has no role "${slotId}".` });
  }
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
        name: schema.character.name,
      })
      .from(schema.book)
      .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.book.storyVersionId))
      .innerJoin(schema.story, eq(schema.story.id, schema.storyVersion.storyId))
      .leftJoin(schema.bookCast, eq(schema.bookCast.bookId, schema.book.id))
      .leftJoin(schema.character, eq(schema.character.id, schema.bookCast.characterId))
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
 * Starts a family's book of the newest version of a story the user may read, with a character in every role.
 * Fails with InvalidInput when a role is empty or its character is another age than the role, and with BookExists
 * when the family has a book of the story, of any version, that isn't in `existing`: a person makes another copy only
 * after seeing every one the family has. Checked under a lock per family and story, so a double click or a second tab
 * makes one book, not two. Existing books are never changed.
 */
export const createBook = Effect.fn("books.create")(function* (
  userId: string,
  familyId: string,
  input: {
    readonly slug: string;
    readonly cast: Readonly<Record<string, string>>;
    /** Per role, how this book draws its character differently from their saved look (D46). */
    readonly looks?: Readonly<Record<string, LookOverride>>;
    /** The family's books of this story the person saw and chose to make another copy next to. */
    readonly existing?: ReadonlyArray<string>;
  },
) {
  yield* requireFamilyAccess(userId, familyId, "edit");
  const { story, storyVersionId, manifest } = yield* readableStoryVersion(userId, input.slug);
  yield* checkCast(manifest, familyId, input.cast, input.looks);
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
      await tx.insert(schema.bookCast).values(
        Object.entries(input.cast).map(([slotId, characterId]) => ({
          bookId: id,
          slotId,
          characterId,
          lookChanges: lookChangesOrNull(input.looks?.[slotId]),
        })),
      );
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
  // A book follows its version's additions as they're published (D41): an option the version gains draws at once.
  const { manifest, additionRevision } = yield* withStoredAdditions(row.storyVersionId, row.manifest);
  return { ...row, manifest, additionRevision };
});

/** A book the user may read (`access` "read") or edit, with its manifest. Non-members get NotFound. */
const bookFor = Effect.fn("books.bookFor")(function* (userId: string, bookId: string, access: "read" | "edit") {
  const book = yield* loadBook(bookId);
  const { canEdit } = yield* requireFamilyAccess(userId, book.familyId, access);
  return { book, canEdit };
});

/**
 * Everything BookPage needs for every page of a book: the cast's current looks (with this book's overrides) composed
 * from the story version's approved parts, and each text block with the family's edit applied. A role whose
 * character this version can't draw is left out of the pictures until the parent picks an override; its name and
 * pronouns still fill the text.
 */
export const getBook = Effect.fn("books.get")(function* (userId: string, bookId: string) {
  const { book, canEdit } = yield* bookFor(userId, bookId, "read");
  const { manifest } = book;
  const [castRows, edits] = yield* Effect.all([
    Database.query((db) => db.select().from(schema.bookCast).where(eq(schema.bookCast.bookId, bookId))),
    Database.query((db) => db.select().from(schema.bookTextEdit).where(eq(schema.bookTextEdit.bookId, bookId))),
  ]);
  const characters = yield* familyCharacters(
    book.familyId,
    castRows.map((row) => row.characterId),
  );

  const roles: Array<BookRole> = [];
  for (const slot of manifest.characterSlots) {
    const row = castRows.find((candidate) => candidate.slotId === slot.slotId);
    const character = characters.find((candidate) => candidate.id === row?.characterId);
    if (!row || !character) continue;
    const override = row.lookOverride ? yield* decodeOverride(row.lookOverride).pipe(Effect.orDie) : {};
    const changes = row.lookChanges ? yield* decodeOverride(row.lookChanges).pipe(Effect.orDie) : {};
    const fill = castLook(manifest, slot.slotId, withLookChanges(character.look, changes), override);
    roles.push({
      slotId: slot.slotId,
      characterId: character.id,
      member: {
        name: character.name,
        ...(character.title ? { title: character.title } : {}),
        pronouns: character.pronouns,
        look: fill.look,
      },
      override,
      changes,
      wrongAge: fill.wrongAge,
      unsupported: [...fill.unsupported],
    });
  }
  const cast: Record<string, CastMember> = Object.fromEntries(roles.map((role) => [role.slotId, role.member]));
  const drawable = Object.fromEntries(
    roles.filter((role) => !role.wrongAge && role.unsupported.length === 0).map((role) => [role.slotId, role.member]),
  );

  const pages = yield* Effect.forEach(manifest.pages, (page) =>
    resolveIllustration(book.storyId, book.version, composeIllustration(manifest, page, drawable)).pipe(
      Effect.map((layers) => ({
        pageId: page.pageId,
        layers,
        text: page.text.map((block, blockIndex) => {
          const edited =
            edits.find((edit) => edit.pageId === page.pageId && edit.blockIndex === blockIndex)?.content ?? null;
          return {
            style: block.style,
            original: block.content,
            edited,
            text: resolveText(edited ?? block.content, cast),
          };
        }),
      })),
    ),
  );
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

/** Puts another family member in a role. Any override or look change for the previous character is dropped. */
export const setBookCast = Effect.fn("books.setCast")(function* (
  userId: string,
  input: { readonly bookId: string; readonly slotId: string; readonly characterId: string },
) {
  const { book } = yield* bookFor(userId, input.bookId, "edit");
  const rows = yield* Database.query((db) =>
    db.select().from(schema.bookCast).where(eq(schema.bookCast.bookId, input.bookId)),
  );
  const cast = {
    ...Object.fromEntries(rows.map((row) => [row.slotId, row.characterId])),
    [input.slotId]: input.characterId,
  };
  yield* checkCast(book.manifest, book.familyId, cast);
  yield* Database.query((db) =>
    db
      .insert(schema.bookCast)
      .values({ bookId: input.bookId, slotId: input.slotId, characterId: input.characterId })
      .onConflictDoUpdate({
        target: [schema.bookCast.bookId, schema.bookCast.slotId],
        set: { characterId: input.characterId, lookOverride: null, lookChanges: null },
      }),
  );
});

/**
 * Sets the options this book draws for a role in place of ones its story version can't draw (D26). Fails with
 * InvalidInput when the override still leaves the role undrawable.
 */
export const setLookOverride = Effect.fn("books.setLookOverride")(function* (
  userId: string,
  input: { readonly bookId: string; readonly slotId: string; readonly override: LookOverride },
) {
  const { book } = yield* bookFor(userId, input.bookId, "edit");
  const [row] = yield* Database.query((db) =>
    db
      .select()
      .from(schema.bookCast)
      .where(and(eq(schema.bookCast.bookId, input.bookId), eq(schema.bookCast.slotId, input.slotId))),
  );
  if (!row) return yield* new NotFound({ entity: "role", id: input.slotId });
  const [character] = yield* familyCharacters(book.familyId, [row.characterId]);
  const changes = row.lookChanges ? yield* decodeOverride(row.lookChanges).pipe(Effect.orDie) : {};
  const fill = castLook(book.manifest, input.slotId, withLookChanges(character!.look, changes), input.override);
  if (fill.wrongAge || fill.unsupported.length > 0) {
    return yield* new InvalidInput({ message: `This story still can't draw: ${fill.unsupported.join(", ")}.` });
  }
  yield* Database.query((db) =>
    db
      .update(schema.bookCast)
      .set({ lookOverride: input.override })
      .where(and(eq(schema.bookCast.bookId, input.bookId), eq(schema.bookCast.slotId, input.slotId))),
  );
});

/**
 * Sets how this book draws a role's character instead of their saved look (D46): `changes` holds the axes it draws
 * differently, and `{}` goes back to the saved look. The family member doesn't change, and other books don't either.
 */
export const setBookLook = Effect.fn("books.setLook")(function* (
  userId: string,
  input: { readonly bookId: string; readonly slotId: string; readonly changes: LookOverride },
) {
  const { book } = yield* bookFor(userId, input.bookId, "edit");
  const [row] = yield* Database.query((db) =>
    db
      .select()
      .from(schema.bookCast)
      .where(and(eq(schema.bookCast.bookId, input.bookId), eq(schema.bookCast.slotId, input.slotId))),
  );
  if (!row) return yield* new NotFound({ entity: "role", id: input.slotId });
  const [character] = yield* familyCharacters(book.familyId, [row.characterId]);
  yield* checkLookChanges(book.manifest, input.slotId, character!.look, input.changes);
  yield* Database.query((db) =>
    db
      .update(schema.bookCast)
      .set({ lookChanges: lookChangesOrNull(input.changes) })
      .where(and(eq(schema.bookCast.bookId, input.bookId), eq(schema.bookCast.slotId, input.slotId))),
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
  const block = page?.text[input.blockIndex];
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
  const undrawable = view.roles.filter((role) => role.wrongAge || role.unsupported.length > 0);
  if (undrawable.length > 0 || view.roles.length < view.manifest.characterSlots.length) {
    return yield* new InvalidInput({
      message: "Every role needs someone the story can draw before the book can be printed.",
    });
  }
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
    additionRevision: book.additionRevision,
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
 * and none is served without its proof. The family's characters stay.
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
