// Characters and personalized books. The domain logic and every family role check are in @lifestory/core
// (characters.ts, books.ts); these adapt requests to it.
import {
  BookExists,
  BookSummary,
  BookView,
  Character,
  CharacterInput,
  Forbidden,
  InvalidInput,
  LookOverride,
  NotAuthenticated,
  JobError,
  NotFound,
  ProofSummary,
  ResultSchema,
  StorySummary,
} from "@lifestory/core/contracts";
import {
  activeFamily,
  approveProof,
  Auth,
  createBook,
  createCharacter,
  deleteBook,
  deleteProof,
  getBook,
  getCharacter,
  listBooks,
  listBookProofs,
  listCharacters,
  listPublishedStories,
  requestBookProof,
  saveTextEdit,
  setBookCast,
  setBookLook,
  setLookOverride,
  updateCharacter,
} from "@lifestory/core";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { runEffect } from "./runtime.ts";

const currentUser = Auth.use((auth) => auth.requireUser(getRequest().headers));
const Done = Schema.Struct({ ok: Schema.Boolean });
const done = Effect.as({ ok: true });

/** The family a page works in: the session's active family (D3), or NotFound for a user in none. */
const currentFamily = Effect.gen(function* () {
  const user = yield* currentUser;
  const { active } = yield* activeFamily(user);
  if (!active) return yield* new NotFound({ entity: "family", id: "active" });
  return { user, family: active };
});

export const FamilyLibraryResult = ResultSchema(
  Schema.Struct({
    family: Schema.Struct({ id: Schema.String, name: Schema.String }),
    canEdit: Schema.Boolean,
    characters: Schema.Array(Character),
    books: Schema.Array(BookSummary),
    stories: Schema.Array(StorySummary),
  }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden]),
);

/** The active family's characters, books, and the stories it can make a book of. */
export const getFamilyLibrary = createServerFn({ method: "GET" }).handler(() =>
  runEffect(
    FamilyLibraryResult,
    Effect.gen(function* () {
      const { user, family } = yield* currentFamily;
      const [{ characters, canEdit }, { books }, stories] = yield* Effect.all([
        listCharacters(user.id, family.id),
        listBooks(user.id, family.id),
        listPublishedStories(),
      ]);
      return { family: { id: family.id, name: family.name }, canEdit, characters, books, stories };
    }),
  ),
);

export const CharacterResult = ResultSchema(
  Schema.Struct({ character: Character, canEdit: Schema.Boolean }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden]),
);

export const getCharacterFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ characterId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      CharacterResult,
      currentUser.pipe(Effect.flatMap((user) => getCharacter(user.id, data.characterId))),
    ),
  );

export const SaveCharacterResult = ResultSchema(Schema.Struct({ id: Schema.String }), Schema.Union([NotAuthenticated, NotFound, Forbidden]));

/** Creates a character in the active family, or with `characterId` changes that one. */
export const saveCharacterFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ characterId: Schema.optional(Schema.String), character: CharacterInput })))
  .handler(({ data }) =>
    runEffect(
      SaveCharacterResult,
      Effect.gen(function* () {
        if (data.characterId) {
          const user = yield* currentUser;
          return yield* updateCharacter(user.id, data.characterId, data.character);
        }
        const { user, family } = yield* currentFamily;
        return yield* createCharacter(user.id, family.id, data.character);
      }),
    ),
  );

export const CreateBookResult = ResultSchema(
  Schema.Struct({ id: Schema.String }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden, InvalidInput, BookExists]),
);

export const createBookFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        slug: Schema.String,
        cast: Schema.Record(Schema.String, Schema.String),
        looks: Schema.optional(Schema.Record(Schema.String, LookOverride)),
        /** The family's books of this story the person saw and chose to make another copy next to. */
        existing: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  )
  .handler(({ data }) =>
    runEffect(
      CreateBookResult,
      Effect.gen(function* () {
        const { user, family } = yield* currentFamily;
        return yield* createBook(user.id, family.id, data);
      }),
    ),
  );

export const BookResult = ResultSchema(
  Schema.Struct({ view: BookView, canEdit: Schema.Boolean, characters: Schema.Array(Character) }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden]),
);

/** A book composed for BookPage, with the family's characters to recast its roles. */
export const getBookFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      BookResult,
      Effect.gen(function* () {
        const user = yield* currentUser;
        const { view, canEdit } = yield* getBook(user.id, data.bookId);
        const { characters } = yield* listCharacters(user.id, view.book.familyId);
        return { view, canEdit, characters };
      }),
    ),
  );

export const EditBookResult = ResultSchema(Done, Schema.Union([NotAuthenticated, NotFound, Forbidden, InvalidInput]));

export const setBookCastFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String, slotId: Schema.String, characterId: Schema.String })))
  .handler(({ data }) =>
    runEffect(EditBookResult, currentUser.pipe(Effect.flatMap((user) => setBookCast(user.id, data)), done)),
  );

export const setLookOverrideFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String, slotId: Schema.String, override: LookOverride })))
  .handler(({ data }) =>
    runEffect(EditBookResult, currentUser.pipe(Effect.flatMap((user) => setLookOverride(user.id, data)), done)),
  );

/** How this book draws a role's character instead of their saved look (D46); `{}` goes back to the saved look. */
export const setBookLookFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String, slotId: Schema.String, changes: LookOverride })))
  .handler(({ data }) => runEffect(EditBookResult, currentUser.pipe(Effect.flatMap((user) => setBookLook(user.id, data)), done)));

export const saveTextEditFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        bookId: Schema.String,
        pageId: Schema.String,
        blockIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        content: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000))),
      }),
    ),
  )
  .handler(({ data }) =>
    runEffect(EditBookResult, currentUser.pipe(Effect.flatMap((user) => saveTextEdit(user.id, data)), done)),
  );

/** Deletes a book and its proofs (books.ts, deleteBook). */
export const deleteBookFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String })))
  .handler(({ data }) => runEffect(EditBookResult, currentUser.pipe(Effect.flatMap((user) => deleteBook(user.id, data.bookId)), done)));

export const BookProofsResult = ResultSchema(
  Schema.Struct({ canRequest: Schema.Boolean, proofs: Schema.Array(ProofSummary) }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden]),
);

export const listBookProofsFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String })))
  .handler(({ data }) => runEffect(BookProofsResult, currentUser.pipe(Effect.flatMap((user) => listBookProofs(user.id, data.bookId)))));

export const RequestBookProofResult = ResultSchema(
  Schema.Struct({ id: Schema.String }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden, InvalidInput, JobError]),
);

/** Starts a PDF proof of the book with its cast and text as they are now (D27). */
export const requestBookProofFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String })))
  .handler(({ data }) => runEffect(RequestBookProofResult, currentUser.pipe(Effect.flatMap((user) => requestBookProof(user.id, data.bookId)))));

export const ApproveProofResult = ResultSchema(Done, Schema.Union([NotAuthenticated, NotFound, Forbidden, InvalidInput]));

/** Approves a ready proof of a book for print, recording who and when. */
export const approveProofFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ proofId: Schema.String })))
  .handler(({ data }) => runEffect(ApproveProofResult, currentUser.pipe(Effect.flatMap((user) => approveProof(user.id, data.proofId)), done)));

export const DeleteProofResult = ResultSchema(Done, Schema.Union([NotAuthenticated, NotFound, Forbidden, InvalidInput]));

/** Deletes a draft proof (rendering, failed, or unapproved) with its PDF; an approved one stays (D32). */
export const deleteProofFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ proofId: Schema.String })))
  .handler(({ data }) => runEffect(DeleteProofResult, currentUser.pipe(Effect.flatMap((user) => deleteProof(user.id, data.proofId)), done)));
