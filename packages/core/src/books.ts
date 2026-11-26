// A family's personalized books (D56). A book pins one story version and stores who fills each role (name, title,
// pronouns, age) and the family's text edits; each figure on a page is drawn from the book's character sheet by a task, and a page shows the stock
// figure until its own is drawn.
import { schema } from "@lifestory/db";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import {
  type Age,
  ageLabel,
  takesTitle,
  type CastMember,
  composePage,
  coverThumbnail,
  decodeStoryManifest,
  pageText,
  type StoryManifest,
} from "./book-format/index.ts";
import { agreementIssues, resolveText, tokenIssues } from "./book-format/text.ts";
import { AppConfig } from "./config.ts";
import type { BookFlow, BookRole, BookSummary, BookView, ProofContent } from "./contracts.ts";
import { CastPerson, type FamilyPerson, PhotoCheckResult, type PhotoPose, photoPoses } from "./contracts.ts";
import { Database } from "./database.ts";
import { BookExists, InvalidInput, NotFound } from "./errors.ts";
import { requireFamilyAccess } from "./families.ts";
import { createProof, proofSummaries, releaseDeletedProof } from "./proofs.ts";
import { isOperatorSql, readableStoryVersion } from "./stories.ts";

/** A person with the title only an adult has (`takesTitle`), so a child's never shows, prints or is stored. */
const withTitleRule = (person: CastPerson): CastPerson =>
  takesTitle(person.age) || person.title === null ? person : { ...person, title: null };
/** A stored person; a title saved for a child before the rule is dropped on read. */
const decodePerson = (row: unknown) => Schema.decodeUnknownEffect(CastPerson)(row).pipe(Effect.map(withTitleRule));

/** Every role filled, by a person of an age the role accepts, and no role the story lacks. */

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

/** A name or title as people match it: trimmed, single-spaced, any case. */
const norm = (text: string | null | undefined) => text?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
/** Who a cast entry is when it isn't linked to a person (D61): name, title, pronouns and age, as typed. */
const personKey = (person: { name: string; title: string | null; pronouns: string; age: string }) =>
  JSON.stringify([
    norm(person.name),
    takesTitle(person.age as Age) ? norm(person.title) : "",
    person.pronouns,
    person.age,
  ]);

/** The family's people (D61), by name, each with the ordered books they're in, for the People page. */
export const listFamilyPeople = Effect.fn("books.listFamilyPeople")(function* (userId: string, familyId: string) {
  yield* requireFamilyAccess(userId, familyId, "read");
  const [rows, books] = yield* Effect.all([
    Database.query((db) =>
      db
        .select()
        .from(schema.familyPerson)
        .where(eq(schema.familyPerson.familyId, familyId))
        .orderBy(asc(schema.familyPerson.name)),
    ),
    Database.query((db) =>
      db
        .select({ personId: schema.bookCast.personId, id: schema.book.id, title: schema.book.title })
        .from(schema.bookCast)
        .innerJoin(schema.book, eq(schema.book.id, schema.bookCast.bookId))
        .where(
          and(eq(schema.book.familyId, familyId), ne(schema.book.status, "draft"), isNotNull(schema.bookCast.personId)),
        )
        .orderBy(asc(schema.book.createdAt)),
    ),
  ]);
  return yield* Effect.forEach(rows, (row) =>
    decodePerson({ ...row, personId: row.id }).pipe(
      Effect.orDie,
      Effect.map((person): FamilyPerson => ({
        id: row.id,
        person,
        archived: row.archivedAt !== null,
        books: books
          .filter(
            (book, i) =>
              book.personId === row.id && books.findIndex((b) => b.personId === row.id && b.id === book.id) === i,
          )
          .map(({ id, title }) => ({ id, title })),
      })),
    ),
  );
});

/** The people "Someone from your other books" offers: the family's people that aren't archived (D61). */
export const listCastPeople = Effect.fn("books.listCastPeople")(function* (userId: string, familyId: string) {
  const people = yield* listFamilyPeople(userId, familyId);
  return people.filter((entry) => !entry.archived).map((entry) => entry.person);
});

/** A person, for a role that edits the family's books; NotFound for anyone outside the family. */
const editablePerson = Effect.fn("books.editablePerson")(function* (userId: string, personId: string) {
  const [row] = yield* Database.query((db) =>
    db.select().from(schema.familyPerson).where(eq(schema.familyPerson.id, personId)),
  );
  if (!row) return yield* new NotFound({ entity: "person", id: personId });
  yield* requireFamilyAccess(userId, row.familyId, "edit");
  return row;
});

/**
 * Changes a person's name, title, pronouns or age for the books made after (D61). Their look comes from each book's
 * photo and their newest book's corrections, so it isn't edited here; books already made keep their own copy.
 */
export const updatePerson = Effect.fn("books.updatePerson")(function* (
  userId: string,
  input: { readonly personId: string; readonly person: CastPerson },
) {
  yield* editablePerson(userId, input.personId);
  const { name, title, pronouns, age } = withTitleRule(input.person);
  yield* Database.query((db) =>
    db
      .update(schema.familyPerson)
      .set({ name, title, pronouns, age })
      .where(eq(schema.familyPerson.id, input.personId)),
  );
});

/** Archives a person, so new books don't offer them, or restores them (D61). Their books don't change. */
export const setPersonArchived = Effect.fn("books.setPersonArchived")(function* (
  userId: string,
  input: { readonly personId: string; readonly archived: boolean },
) {
  yield* editablePerson(userId, input.personId);
  yield* Database.query((db) =>
    db
      .update(schema.familyPerson)
      .set({ archivedAt: input.archived ? new Date() : null })
      .where(eq(schema.familyPerson.id, input.personId)),
  );
});

/**
 * Links each role of an ordered book to the family's person it is, and makes that person look like this book (D61):
 * the person it was picked as, even after edits; for someone typed as new, the person with the same name, title,
 * pronouns and age, else a new one. Drafts are skipped, so a draft never adds anyone. `ordered` (the order itself) also brings back
 * an archived person: the parent reused them on purpose. Idempotent.
 */
export const syncBookPeople = Effect.fn("books.syncPeople")(function* (
  bookId: string,
  options: { readonly ordered: boolean },
) {
  yield* Database.query((db) =>
    db.transaction(async (tx) => {
      const [book] = await tx
        .select({ familyId: schema.book.familyId, status: schema.book.status })
        .from(schema.book)
        .where(eq(schema.book.id, bookId));
      if (!book || book.status === "draft") return;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`people:${book.familyId}`}, 0))`);
      const cast = await tx.select().from(schema.bookCast).where(eq(schema.bookCast.bookId, bookId));
      const people = await tx.select().from(schema.familyPerson).where(eq(schema.familyPerson.familyId, book.familyId));
      for (const row of cast) {
        const values = {
          name: row.name.trim(),
          title: takesTitle(row.age as Age) ? row.title : null,
          pronouns: row.pronouns,
          age: row.age,
          look: row.look,
          ...(options.ordered ? { archivedAt: null } : {}),
        };
        // Picked from People (D61) stays that person whatever the parent edited; typed as someone new matches
        // only an exact name, title, pronouns and age, which is how reusing an archived person brings them back.
        const match = row.personId
          ? people.find((person) => person.id === row.personId)
          : people.find((person) => personKey(person) === personKey(row));
        let personId: string;
        if (match) {
          personId = match.id;
          await tx.update(schema.familyPerson).set(values).where(eq(schema.familyPerson.id, personId));
          Object.assign(match, values);
        } else {
          personId = `person_${crypto.randomUUID()}`;
          const [created] = await tx
            .insert(schema.familyPerson)
            .values({ id: personId, familyId: book.familyId, ...values })
            .returning();
          people.push(created!);
        }
        if (row.personId !== personId)
          await tx
            .update(schema.bookCast)
            .set({ personId })
            .where(and(eq(schema.bookCast.bookId, bookId), eq(schema.bookCast.slotId, row.slotId)));
      }
    }),
  );
});

/** The family's books, newest first, for any member. */
export const listBooks = Effect.fn("books.list")(function* (userId: string, familyId: string) {
  const access = yield* requireFamilyAccess(userId, familyId, "read");
  const rows = yield* Database.query((db) =>
    db
      .select({
        id: schema.book.id,
        title: schema.book.title,
        storyId: schema.story.id,
        storyVersionId: schema.book.storyVersionId,
        storySlug: schema.story.slug,
        storyTitle: schema.story.title,
        version: schema.storyVersion.version,
        status: schema.book.status,
        name: schema.bookCast.name,
      })
      .from(schema.book)
      .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.book.storyVersionId))
      .innerJoin(schema.story, eq(schema.story.id, schema.storyVersion.storyId))
      .leftJoin(schema.bookCast, eq(schema.bookCast.bookId, schema.book.id))
      // Drafts are hidden until ordered (D57): the story page's button reopens one.
      .where(and(eq(schema.book.familyId, familyId), ne(schema.book.status, "draft")))
      .orderBy(asc(schema.book.createdAt), asc(schema.bookCast.slotId)),
  );
  const books = new Map<
    string,
    {
      id: string;
      title: string;
      storyId: string;
      storyVersionId: string;
      storySlug: string;
      storyTitle: string;
      version: number;
      status: string;
      names: Array<string>;
    }
  >();
  for (const row of rows) {
    const { name: _, ...summary } = row;
    const book = books.get(row.id) ?? { ...summary, names: [] };
    if (row.name) book.names.push(row.name);
    books.set(row.id, book);
  }
  // Each listed version's manifest once, and the chosen version's figures of the family's drawn pages.
  const versionIds = [...new Set([...books.values()].map((book) => book.storyVersionId))];
  const [versions, art] = yield* Effect.all([
    versionIds.length === 0
      ? Effect.succeed([])
      : Database.query((db) =>
          db
            .select({ id: schema.storyVersion.id, manifest: schema.storyVersion.manifest })
            .from(schema.storyVersion)
            .where(inArray(schema.storyVersion.id, versionIds)),
        ),
    Database.query((db) =>
      db
        .select({
          bookId: schema.bookPageArt.bookId,
          pageId: schema.bookPageArt.pageId,
          figure: schema.bookPageArt.figure,
          objectKey: schema.bookPageArt.objectKey,
        })
        .from(schema.bookPageArt)
        .innerJoin(
          schema.bookPage,
          and(
            eq(schema.bookPage.bookId, schema.bookPageArt.bookId),
            eq(schema.bookPage.pageId, schema.bookPageArt.pageId),
            eq(schema.bookPage.chosenVersion, schema.bookPageArt.version),
          ),
        )
        .innerJoin(schema.book, eq(schema.book.id, schema.bookPageArt.bookId))
        .where(and(eq(schema.book.familyId, familyId), ne(schema.book.status, "draft"))),
    ),
  ]);
  const manifests = new Map<string, StoryManifest>();
  for (const row of versions) manifests.set(row.id, yield* decodeStoryManifest(row.manifest).pipe(Effect.orDie));
  const summaries: ReadonlyArray<BookSummary> = [...books.values()]
    .toReversed()
    .map(({ names, storyId, storyVersionId, ...book }) => {
      const manifest = manifests.get(storyVersionId)!;
      const story = { storyId, version: book.version };
      // The cover page as drawn for the book, else the stock figures (D56).
      const pageId = coverThumbnail(story, manifest)?.pageId;
      const drawn = art.filter((row) => row.bookId === book.id && row.pageId === pageId);
      const cover = coverThumbnail(story, manifest, (_figure, index) =>
        drawn.length > 0 ? drawn.find((row) => row.figure === index)?.objectKey : undefined,
      );
      return { ...book, cast: names.join(", "), cover };
    });
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
      // Checked here, not only when reading the story, so a story archived (D49) or made operator-only (D60)
      // meanwhile gets no new book.
      const [current] = await tx
        .select({
          status: schema.story.status,
          hidden: sql<boolean>`${schema.story.operatorOnly} and ${schema.story.authorId} <> ${userId} and not ${isOperatorSql(userId)}`,
        })
        .from(schema.story)
        .where(eq(schema.story.id, story.id));
      if (current?.hidden) return "hidden" as const;
      if (current?.status === "archived") return "archived" as const;
      const books = await tx
        .select({ id: schema.book.id, status: schema.book.status })
        .from(schema.book)
        .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.book.storyVersionId))
        .where(and(eq(schema.book.familyId, familyId), eq(schema.storyVersion.storyId, story.id)))
        .orderBy(desc(schema.book.createdAt));
      // A draft of the story is reopened with this cast, not doubled (drafts are hidden from lists, D57).
      const draft = books.find((book) => book.status === "draft");
      if (draft) {
        await tx.delete(schema.bookCast).where(eq(schema.bookCast.bookId, draft.id));
        await tx.insert(schema.bookCast).values(
          Object.entries(input.cast).map(([slotId, person]) => ({
            bookId: draft.id,
            slotId,
            ...withTitleRule(person),
          })),
        );
        return { draft: draft.id };
      }
      const bookIds = books.map((book) => book.id);
      if (bookIds.some((bookId) => !input.existing?.includes(bookId))) return bookIds;
      await tx.insert(schema.book).values({ id, familyId, storyVersionId, title: story.title });
      await tx
        .insert(schema.bookCast)
        .values(
          Object.entries(input.cast).map(([slotId, person]) => ({ bookId: id, slotId, ...withTitleRule(person) })),
        );
      return null;
    }),
  );
  if (unseen !== null && typeof unseen === "object" && "draft" in unseen) return { id: unseen.draft };
  if (unseen === "hidden") return yield* new NotFound({ entity: "story", id: input.slug });
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

export const loadBook = Effect.fn("books.load")(function* (bookId: string) {
  const [row] = yield* Database.query((db) =>
    db
      .select({
        id: schema.book.id,
        familyId: schema.book.familyId,
        title: schema.book.title,
        status: schema.book.status,
        photoReview: schema.book.photoReview,
        likenessStatus: schema.book.likenessStatus,
        orderedAt: schema.book.orderedAt,
        reviewNote: schema.book.reviewNote,
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

  const flow = yield* bookFlow(book);
  const story = { storyId: book.storyId, version: book.version };
  const pages = manifest.pages.map((page) => ({
    pageId: page.pageId,
    layers: chosenLayers(flow, page.pageId) ?? composePage(story, page),
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
    flow,
  };
  return { view, canEdit };
});

/**
 * What a proof of the book would show now (D27): the cast, the family's text edits, and each drawn page's layers in
 * the chosen version. A new proof copies it; a proof whose content differs is out of date (`sameProofContent`).
 */
export const bookProofContent = Effect.fn("books.proofContent")(function* (
  book: Effect.Success<ReturnType<typeof loadBook>>,
  flow: BookFlow,
) {
  const [castRows, edits] = yield* Effect.all([
    Database.query((db) => db.select().from(schema.bookCast).where(eq(schema.bookCast.bookId, book.id))),
    Database.query((db) =>
      db
        .select({
          pageId: schema.bookTextEdit.pageId,
          blockIndex: schema.bookTextEdit.blockIndex,
          content: schema.bookTextEdit.content,
        })
        .from(schema.bookTextEdit)
        .where(eq(schema.bookTextEdit.bookId, book.id)),
    ),
  ]);
  const cast: Record<string, CastMember> = {};
  for (const slot of book.manifest.characterSlots) {
    const row = castRows.find((candidate) => candidate.slotId === slot.slotId);
    if (row) cast[slot.slotId] = castMember(yield* decodePerson(row).pipe(Effect.orDie));
  }
  const art = Object.fromEntries(
    flow.pages.flatMap((page) => {
      const layers = chosenLayers(flow, page.pageId);
      return layers ? [[page.pageId, layers] as const] : [];
    }),
  );
  return { cast, textEdits: edits, art } satisfies ProofContent;
});

/** A drawn page's layers in the version the parent chose, if the page is drawn. */
const chosenLayers = (flow: BookFlow, pageId: string) => {
  const page = flow.pages.find((candidate) => candidate.pageId === pageId);
  return page?.versions.find((version) => version.version === page.chosenVersion)?.layers;
};

/**
 * A book's photo-book state (D56, D57): likenesses and each drawn page's versions composed for BookPage.
 * Shared with the operator's review, which sees the same, photos included only on an opted-in book.
 */
export const bookFlow = Effect.fn("books.flow")(function* (book: Effect.Success<ReturnType<typeof loadBook>>) {
  const [likenessRows, poseRows, pageRows, artRows, consents] = yield* Effect.all([
    Database.query((db) => db.select().from(schema.bookLikeness).where(eq(schema.bookLikeness.bookId, book.id))),
    Database.query((db) => db.select().from(schema.bookPosePhoto).where(eq(schema.bookPosePhoto.bookId, book.id))),
    Database.query((db) => db.select().from(schema.bookPage).where(eq(schema.bookPage.bookId, book.id))),
    Database.query((db) => db.select().from(schema.bookPageArt).where(eq(schema.bookPageArt.bookId, book.id))),
    Database.query((db) =>
      db.select({ id: schema.consent.id }).from(schema.consent).where(eq(schema.consent.bookId, book.id)),
    ),
  ]);
  const story = { storyId: book.storyId, version: book.version };
  const likenesses: Array<BookFlow["likenesses"][number]> = [];
  for (const slot of book.manifest.characterSlots) {
    const row = likenessRows.find((candidate) => candidate.slotId === slot.slotId);
    likenesses.push({
      slotId: slot.slotId,
      checkStatus: row?.checkStatus ?? null,
      check: row?.check ? yield* Schema.decodeUnknownEffect(PhotoCheckResult)(row.check).pipe(Effect.orDie) : null,
      photoKey: row?.photoKey ?? null,
      sheetKey: row?.sheetKey ?? null,
      expressionsKey: row?.expressionsKey ?? null,
      draws: row?.draws ?? 0,
      drawing: row?.drawing ?? false,
      notes: row?.notes ?? [],
      poses: yield* Effect.forEach(
        photoPoses.flatMap((pose) =>
          poseRows.filter((candidate) => candidate.slotId === slot.slotId && candidate.pose === pose.id),
        ),
        (pose) =>
          Effect.gen(function* () {
            return {
              pose: pose.pose as PhotoPose,
              checkStatus: pose.checkStatus,
              check: pose.check
                ? yield* Schema.decodeUnknownEffect(PhotoCheckResult)(pose.check).pipe(Effect.orDie)
                : null,
              photoKey: pose.photoKey,
            };
          }),
      ),
    });
  }
  const pages = book.manifest.pages.flatMap((page) => {
    const row = pageRows.find((candidate) => candidate.pageId === page.pageId);
    if (!row) return [];
    const art = artRows.filter((candidate) => candidate.pageId === page.pageId);
    const versions = [...new Set(art.map((a) => a.version))]
      .toSorted((a, b) => a - b)
      .map((version) => {
        const figures = art.filter((a) => a.version === version);
        return {
          version,
          layers: composePage(story, page, (_figure, index) => figures.find((a) => a.figure === index)?.objectKey),
          clippedShare: Math.max(0, ...figures.map((a) => a.clippedShare)),
        };
      });
    return [
      {
        pageId: page.pageId,
        latestVersion: row.latestVersion,
        chosenVersion: row.chosenVersion,
        ready: row.ready,
        changeNote: row.changeNote,
        reviewNote: row.reviewNote,
        versions,
      },
    ];
  });
  const { dataRetention } = yield* AppConfig;
  const flow: BookFlow = {
    status: book.status,
    retention: dataRetention,
    photoReview: book.photoReview,
    consented: consents.length > 0,
    likenessStatus: book.likenessStatus,
    likenesses,
    pages,
    reviewNote: book.reviewNote,
  };
  return flow;
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
  const person = withTitleRule(input.person);
  cast[input.slotId] = person;
  yield* checkCast(book.manifest, cast);
  yield* Database.query((db) =>
    db
      .insert(schema.bookCast)
      .values({ bookId: input.bookId, slotId: input.slotId, ...person })
      .onConflictDoUpdate({ target: [schema.bookCast.bookId, schema.bookCast.slotId], set: person }),
  );
  // An ordered book's people follow its cast (D61); a draft's wait for the order.
  yield* syncBookPeople(input.bookId, { ordered: false });
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
  const issues = [
    ...tokenIssues(content, new Set(book.manifest.characterSlots.map((slot) => slot.slotId))),
    ...agreementIssues(content),
  ];
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
  if (view.flow.status !== "changes")
    return yield* new InvalidInput({
      message: "A proof can be made once every page is drawn, until the book is sent for review.",
    });
  return yield* createProof({
    familyId: book.familyId,
    bookId,
    storyVersionId: book.storyVersionId,
    content: yield* bookProofContent(book, view.flow),
    requestedBy: userId,
  });
});

/** A book's proofs, newest first, for any member of its family. */
export const listBookProofs = Effect.fn("books.listProofs")(function* (userId: string, bookId: string) {
  const { book, canEdit } = yield* bookFor(userId, bookId, "read");
  const current = yield* bookProofContent(book, yield* bookFlow(book));
  const proofs = yield* proofSummaries(eq(schema.proof.bookId, bookId), book.manifest, current);
  // Proofs are made, approved and deleted only while the parent reads the drawn book; from sending it for review on,
  // the list is a record.
  return { canRequest: canEdit && book.status === "changes", proofs };
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
