import {
  activeFamily,
  approveProof,
  Auth,
  createBook,
  deleteBook,
  deleteProof,
  getBook,
  listBooks,
  listBookProofs,
  listCastPeople,
  listPublishedStories,
  requestBookProof,
  saveTextEdit,
  setBookCast,
} from "@lifestory/core";
// Personalized books. The domain logic and every family role check are in @lifestory/core (books.ts); these adapt
// requests to it.
import {
  BookExists,
  BookSummary,
  BookView,
  CastPerson,
  Forbidden,
  InvalidInput,
  NotAuthenticated,
  JobError,
  NotFound,
  ProofSummary,
  ResultSchema,
  StoryListing,
} from "@lifestory/core/contracts";
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
    /** The people in the family's books, to pick for another book. */
    people: Schema.Array(CastPerson),
    books: Schema.Array(BookSummary),
    stories: Schema.Array(StoryListing),
  }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden]),
);

/** The active family's books, the people in them, and the stories it can make a book of. */
export const getFamilyLibrary = createServerFn({ method: "GET" }).handler(() =>
  runEffect(
    FamilyLibraryResult,
    Effect.gen(function* () {
      const { user, family } = yield* currentFamily;
      const [people, { books, canEdit }, stories] = yield* Effect.all([
        listCastPeople(user.id, family.id),
        listBooks(user.id, family.id),
        listPublishedStories(user.id),
      ]);
      return { family: { id: family.id, name: family.name }, canEdit, people, books, stories };
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
        cast: Schema.Record(Schema.String, CastPerson),
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
  Schema.Struct({ view: BookView, canEdit: Schema.Boolean }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden]),
);

/** A book composed for BookPage. */
export const getBookFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      BookResult,
      Effect.gen(function* () {
        const user = yield* currentUser;
        return yield* getBook(user.id, data.bookId);
      }),
    ),
  );

export const EditBookResult = ResultSchema(Done, Schema.Union([NotAuthenticated, NotFound, Forbidden, InvalidInput]));

export const setBookCastFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String, slotId: Schema.String, person: CastPerson })),
  )
  .handler(({ data }) =>
    runEffect(
      EditBookResult,
      currentUser.pipe(
        Effect.flatMap((user) => setBookCast(user.id, data)),
        done,
      ),
    ),
  );

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
    runEffect(
      EditBookResult,
      currentUser.pipe(
        Effect.flatMap((user) => saveTextEdit(user.id, data)),
        done,
      ),
    ),
  );

/** Deletes a book and its proofs (books.ts, deleteBook). */
export const deleteBookFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      EditBookResult,
      currentUser.pipe(
        Effect.flatMap((user) => deleteBook(user.id, data.bookId)),
        done,
      ),
    ),
  );

export const BookProofsResult = ResultSchema(
  Schema.Struct({ canRequest: Schema.Boolean, proofs: Schema.Array(ProofSummary) }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden]),
);

export const listBookProofsFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String })))
  .handler(({ data }) =>
    runEffect(BookProofsResult, currentUser.pipe(Effect.flatMap((user) => listBookProofs(user.id, data.bookId)))),
  );

export const RequestBookProofResult = ResultSchema(
  Schema.Struct({ id: Schema.String }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden, InvalidInput, JobError]),
);

/** Starts a PDF proof of the book with its cast and text as they are now (D27). */
export const requestBookProofFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      RequestBookProofResult,
      currentUser.pipe(Effect.flatMap((user) => requestBookProof(user.id, data.bookId))),
    ),
  );

export const ApproveProofResult = ResultSchema(
  Done,
  Schema.Union([NotAuthenticated, NotFound, Forbidden, InvalidInput]),
);

/** Approves a ready proof of a book for print, recording who and when. */
export const approveProofFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ proofId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      ApproveProofResult,
      currentUser.pipe(
        Effect.flatMap((user) => approveProof(user.id, data.proofId)),
        done,
      ),
    ),
  );

export const DeleteProofResult = ResultSchema(Done, Schema.Union([NotAuthenticated, NotFound, Forbidden]));

/** Deletes a proof, approved or not, with its PDF (D32). */
export const deleteProofFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ proofId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      DeleteProofResult,
      currentUser.pipe(
        Effect.flatMap((user) => deleteProof(user.id, data.proofId)),
        done,
      ),
    ),
  );
