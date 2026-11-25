// A photo book's steps (D56, D57): the domain logic and every role check are in @lifestory/core (book-flow.ts); these
// adapt requests to it. The photo itself goes through the server route /api/books/$bookId/photos.
import {
  Auth,
  choosePageVersion,
  decideBook,
  drawSheet,
  listReviewQueue,
  orderBook,
  recordConsent,
  requestPageChange,
  reviewBook,
  sendForReview,
  setLook,
  withdrawPhotoReview,
} from "@lifestory/core";
import {
  BookFlow,
  CastMember,
  Forbidden,
  InvalidInput,
  JobError,
  LookChoices,
  NotAuthenticated,
  NotFound,
  ResultSchema,
  StoryManifest,
  TextStyleName,
} from "@lifestory/core/contracts";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";

import { runEffect } from "./runtime.ts";

const currentUser = Auth.use((auth) => auth.requireUser(getRequest().headers));
const Done = Schema.Struct({ ok: Schema.Boolean });
const Failures = Schema.Union([NotAuthenticated, NotFound, Forbidden, InvalidInput, JobError]);

export const FlowStepResult = ResultSchema(Done, Failures);

const BookId = Schema.Struct({ bookId: Schema.String });
const Note = Schema.String.check(Schema.isMaxLength(1000));

/** Runs one step as the signed-in user and answers `{ ok: true }`. */
const respond = (run: (user: Effect.Success<typeof currentUser>) => Effect.Effect<unknown, any, any>) =>
  runEffect(FlowStepResult, currentUser.pipe(Effect.flatMap(run), Effect.as({ ok: true })));

export const recordConsentFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String, statements: Schema.Array(Schema.String) })),
  )
  .handler(({ data }) => respond((user) => recordConsent(user.id, data)));

export const withdrawPhotoReviewFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(BookId))
  .handler(({ data }) => respond((user) => withdrawPhotoReview(user.id, data.bookId)));

export const setLookFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String, slotId: Schema.String, look: LookChoices })),
  )
  .handler(({ data }) => respond((user) => setLook(user.id, data)));

export const drawSheetFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ bookId: Schema.String, slotId: Schema.String, note: Schema.optionalKey(Note) }),
    ),
  )
  .handler(({ data }) => respond((user) => drawSheet(user.id, data)));

export const orderBookFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(BookId))
  .handler(({ data }) => respond((user) => orderBook(user.id, data.bookId)));

export const requestPageChangeFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String, pageId: Schema.String, note: Note })))
  .handler(({ data }) => respond((user) => requestPageChange(user.id, data)));

export const choosePageVersionFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String, pageId: Schema.String, version: Schema.Int })),
  )
  .handler(({ data }) => respond((user) => choosePageVersion(user.id, data)));

export const sendForReviewFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ bookId: Schema.String, proofId: Schema.String })))
  .handler(({ data }) => respond((user) => sendForReview(user.id, data)));

// ---- The operator (D57) -------------------------------------------------------------

export const ReviewQueueResult = ResultSchema(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      familyName: Schema.String,
      photoReview: Schema.Boolean,
      sentAt: Schema.String,
      flagged: Schema.Boolean,
    }),
  ),
  Schema.Union([NotAuthenticated, Forbidden]),
);

export const listReviewQueueFn = createServerFn({ method: "GET" }).handler(() =>
  runEffect(ReviewQueueResult, currentUser.pipe(Effect.flatMap(listReviewQueue))),
);

export const ReviewBookResult = ResultSchema(
  Schema.Struct({
    flow: BookFlow,
    familyId: Schema.String,
    title: Schema.String,
    storyId: Schema.String,
    version: Schema.Number,
    manifest: StoryManifest,
    familyName: Schema.String,
    proofKey: Schema.NullOr(Schema.String),
    proofCurrent: Schema.Boolean,
    /** Who plays each role, as the shown pages name them. */
    cast: Schema.Record(Schema.String, CastMember),
    /** Each page as the approved proof prints it: drawing and text, with the story's wording of an edited paragraph. */
    pages: Schema.Array(
      Schema.Struct({
        pageId: Schema.String,
        layers: Schema.Array(
          Schema.Struct({
            key: Schema.String,
            rect: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]),
          }),
        ),
        text: Schema.Array(
          Schema.Struct({ style: TextStyleName, text: Schema.String, original: Schema.NullOr(Schema.String) }),
        ),
      }),
    ),
  }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden]),
);

export const reviewBookFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(BookId))
  .handler(({ data }) =>
    runEffect(ReviewBookResult, currentUser.pipe(Effect.flatMap((user) => reviewBook(user, data.bookId)))),
  );

export const decideBookFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        bookId: Schema.String,
        decision: Schema.Literals(["approve", "refuse"]),
        note: Note,
        pageNotes: Schema.optionalKey(Schema.Array(Schema.Struct({ pageId: Schema.String, note: Note }))),
      }),
    ),
  )
  .handler(({ data }) => respond((user) => decideBook(user, data)));
