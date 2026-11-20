// Story authoring (D37): an author's stories, the draft editor, checking and publishing, and the operator's grants.
// Permission checks happen in @lifestory/core (authoring.ts). File uploads are a server route
// (routes/api/authoring/stories.$storyId.assets.ts), since they carry bytes.
import {
  ArtImportRequest,
  Casting,
  CastingStatus,
  AuthoredStory,
  DraftChanged,
  DraftView,
  Forbidden,
  InvalidInput,
  NotAuthenticated,
  Look,
  NotFound,
  PartDecision,
  PartRequest,
  ResultSchema,
  StoryDraft,
  StoryNotPublishable,
  StoryPart,
  ImportStatus,
} from "@lifestory/core/contracts";
import {
  artImportStatus,
  requestCasting,
  castingStatus,
  Auth,
  canAuthor,
  requestArtImport,
  checkDraft,
  createStory,
  getDraft,
  grantAuthor,
  listAuthoredStories,
  listAuthors,
  listDraftParts,
  draftPartPlan,
  draftUploadReview,
  previewDraft,
  requestDraftParts,
  reviewDraftPart,
  publishDraft,
  revokeAuthor,
  saveDraft,
  setStoryArchived,
  startNextVersion,
  storyVersions,
} from "@lifestory/core";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { runEffect } from "./runtime.ts";

const currentUser = Auth.use((auth) => auth.requireUser(getRequest().headers));
const StoryId = Schema.Struct({ storyId: Schema.String });
const Text = (max: number) => Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(max));

export const AuthoringHomeResult = ResultSchema(
  Schema.Struct({ canAuthor: Schema.Boolean, isOperator: Schema.Boolean, stories: Schema.Array(AuthoredStory) }),
  NotAuthenticated,
);

export const getAuthoringHome = createServerFn({ method: "GET" }).handler(() =>
  runEffect(
    AuthoringHomeResult,
    Effect.gen(function* () {
      const user = yield* currentUser;
      return {
        canAuthor: yield* canAuthor(user),
        isOperator: user.role === "admin",
        stories: yield* listAuthoredStories(user),
      };
    }),
  ),
);

export const CreateStoryResult = ResultSchema(
  Schema.Struct({ id: Schema.String, slug: Schema.String }),
  Schema.Union([NotAuthenticated, Forbidden, InvalidInput]),
);

export const createStoryFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ title: Text(120), slug: Text(60), summary: Schema.Trim.check(Schema.isMaxLength(500)) }),
    ),
  )
  .handler(({ data }) =>
    runEffect(CreateStoryResult, currentUser.pipe(Effect.flatMap((user) => createStory(user, data)))),
  );

const DraftFailures = Schema.Union([NotAuthenticated, Forbidden, NotFound]);

export const DraftResult = ResultSchema(DraftView, DraftFailures);

export const getDraftFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(StoryId))
  .handler(({ data }) =>
    runEffect(DraftResult, currentUser.pipe(Effect.flatMap((user) => getDraft(user, data.storyId)))),
  );

export const SaveDraftResult = ResultSchema(
  DraftView,
  Schema.Union([NotAuthenticated, Forbidden, NotFound, DraftChanged]),
);

export const saveDraftFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        storyId: Schema.String,
        revision: Schema.Number,
        draft: StoryDraft,
        casting: Schema.optionalKey(Casting),
        title: Text(120),
        summary: Schema.Trim.check(Schema.isMaxLength(500)),
      }),
    ),
  )
  .handler(({ data }) =>
    runEffect(SaveDraftResult, currentUser.pipe(Effect.flatMap((user) => saveDraft(user, data.storyId, data)))),
  );

export const CheckDraftResult = ResultSchema(Schema.Struct({ issues: Schema.Array(Schema.String) }), DraftFailures);

export const checkDraftFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(StoryId))
  .handler(({ data }) =>
    runEffect(CheckDraftResult, currentUser.pipe(Effect.flatMap((user) => checkDraft(user, data.storyId)))),
  );

export const PublishDraftResult = ResultSchema(
  Schema.Struct({ version: Schema.Number }),
  Schema.Union([NotAuthenticated, Forbidden, NotFound, DraftChanged, StoryNotPublishable]),
);

export const publishDraftFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ storyId: Schema.String, revision: Schema.Number })))
  .handler(({ data }) =>
    runEffect(
      PublishDraftResult,
      currentUser.pipe(Effect.flatMap((user) => publishDraft(user, data.storyId, data.revision))),
    ),
  );

export const StoryVersionsResult = ResultSchema(
  Schema.Struct({
    story: Schema.Struct({
      id: Schema.String,
      slug: Schema.String,
      title: Schema.String,
      summary: Schema.String,
      status: Schema.String,
    }),
    draftVersion: Schema.NullOr(Schema.Number),
    published: Schema.Array(Schema.Struct({ version: Schema.Number, publishedAt: Schema.String })),
  }),
  DraftFailures,
);

export const storyVersionsFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(StoryId))
  .handler(({ data }) =>
    runEffect(StoryVersionsResult, currentUser.pipe(Effect.flatMap((user) => storyVersions(user, data.storyId)))),
  );

export const StartNextVersionResult = ResultSchema(Schema.Struct({ version: Schema.Number }), DraftFailures);

export const startNextVersionFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(StoryId))
  .handler(({ data }) =>
    runEffect(StartNextVersionResult, currentUser.pipe(Effect.flatMap((user) => startNextVersion(user, data.storyId)))),
  );

export const ArchiveStoryResult = ResultSchema(
  Schema.Struct({ status: Schema.String }),
  Schema.Union([NotAuthenticated, Forbidden, NotFound, InvalidInput]),
);

/** Archives a published story (`archived` true) or restores it (D49). */
export const setStoryArchivedFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ storyId: Schema.String, archived: Schema.Boolean })))
  .handler(({ data }) =>
    runEffect(
      ArchiveStoryResult,
      currentUser.pipe(Effect.flatMap((user) => setStoryArchived(user, data.storyId, data.archived))),
    ),
  );

export const AuthorsResult = ResultSchema(
  Schema.Array(Schema.Struct({ userId: Schema.String, name: Schema.String, email: Schema.String })),
  Schema.Union([NotAuthenticated, Forbidden]),
);

export const listAuthorsFn = createServerFn({ method: "GET" }).handler(() =>
  runEffect(AuthorsResult, currentUser.pipe(Effect.flatMap(listAuthors))),
);

export const ChangeAuthorsResult = ResultSchema(
  Schema.Struct({ ok: Schema.Boolean }),
  Schema.Union([NotAuthenticated, Forbidden, NotFound]),
);

export const grantAuthorFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ email: Text(320) })))
  .handler(({ data }) =>
    runEffect(
      ChangeAuthorsResult,
      currentUser.pipe(
        Effect.flatMap((user) => grantAuthor(user, data.email)),
        Effect.as({ ok: true }),
      ),
    ),
  );

export const revokeAuthorFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ userId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      ChangeAuthorsResult,
      currentUser.pipe(
        Effect.flatMap((user) => revokeAuthor(user, data.userId)),
        Effect.as({ ok: true }),
      ),
    ),
  );

// Generated parts of the draft (D36): request one, watch them generate, and review them.
const PartFailures = Schema.Union([NotAuthenticated, Forbidden, NotFound, InvalidInput]);

export const DraftPartResult = ResultSchema(StoryPart, PartFailures);

const { storyVersionId: _, ...requestFields } = PartRequest.fields;

export const DraftPartPlanResult = ResultSchema(
  Schema.Struct({
    requests: Schema.Array(Schema.Struct(requestFields)),
    blocked: Schema.Array(Schema.String),
    estimateUsd: Schema.Number,
  }),
  DraftFailures,
);
export const draftPartPlanFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(StoryId))
  .handler(({ data }) =>
    runEffect(DraftPartPlanResult, currentUser.pipe(Effect.flatMap((user) => draftPartPlan(user, data.storyId)))),
  );

export const UploadReviewResult = ResultSchema(
  Schema.Struct({ light: Schema.String, dark: Schema.String }),
  DraftFailures,
);
export const draftUploadReviewFn = createServerFn({ method: "GET" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ storyId: Schema.String, pageId: Schema.String, slotId: Schema.String, asset: Schema.String }),
    ),
  )
  .handler(({ data }) =>
    runEffect(
      UploadReviewResult,
      currentUser.pipe(
        Effect.flatMap((user) => draftUploadReview(user, data.storyId, data.pageId, data.slotId, data.asset)),
      ),
    ),
  );

export const DraftPartsRequestResult = ResultSchema(Schema.Array(StoryPart), PartFailures);

/** Parts of one figure, generated together: one tiled edit per option for up to four of its bases (D44). */
export const requestDraftPartsFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        storyId: Schema.String,
        requests: Schema.Array(Schema.Struct(requestFields)).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
      }),
    ),
  )
  .handler(({ data: { storyId, requests } }) =>
    runEffect(
      DraftPartsRequestResult,
      currentUser.pipe(Effect.flatMap((user) => requestDraftParts(user, storyId, requests))),
    ),
  );

export const reviewDraftPartFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        storyId: Schema.String,
        partId: Schema.String,
        decision: PartDecision,
        reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
      }),
    ),
  )
  .handler(({ data }) =>
    runEffect(
      DraftPartResult,
      currentUser.pipe(
        Effect.flatMap((user) => reviewDraftPart(user, data.storyId, data.partId, data.decision, data.reason)),
      ),
    ),
  );

export const DraftPartsResult = ResultSchema(Schema.Array(StoryPart), DraftFailures);

export const listDraftPartsFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(StoryId))
  .handler(({ data }) =>
    runEffect(DraftPartsResult, currentUser.pipe(Effect.flatMap((user) => listDraftParts(user, data.storyId)))),
  );

export const PreviewDraftResult = ResultSchema(DraftView.fields.pages, DraftFailures);

/** The editor's live preview of unsaved changes, optionally with family members' looks in roles; saves nothing. */
export const previewDraftFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        storyId: Schema.String,
        draft: StoryDraft,
        looks: Schema.Record(Schema.String, Look),
        candidateId: Schema.optionalKey(Schema.String),
      }),
    ),
  )
  .handler(({ data }) =>
    runEffect(
      PreviewDraftResult,
      currentUser.pipe(
        Effect.flatMap((user) => previewDraft(user, data.storyId, data.draft, data.looks, data.candidateId)),
      ),
    ),
  );

// Importing art made outside the app: start an import of uploaded art, and follow it.
export const ArtImportStartResult = ResultSchema(Schema.Struct({ taskId: Schema.String }), PartFailures);

export const requestArtImportFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ storyId: Schema.String, request: ArtImportRequest })))
  .handler(({ data }) =>
    runEffect(
      ArtImportStartResult,
      currentUser.pipe(Effect.flatMap((user) => requestArtImport(user, data.storyId, data.request))),
    ),
  );

export const ArtImportStatusResult = ResultSchema(ImportStatus, DraftFailures);

export const artImportStatusFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ storyId: Schema.String, taskId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      ArtImportStatusResult,
      currentUser.pipe(Effect.flatMap((user) => artImportStatus(user, data.storyId, data.taskId))),
    ),
  );

export const requestCastingFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        storyId: Schema.String,
        pageId: Schema.String,
        mode: Schema.Literals(["detect", "extract"]),
        requestId: Text(80),
      }),
    ),
  )
  .handler(({ data }) =>
    runEffect(
      ArtImportStartResult,
      currentUser.pipe(
        Effect.flatMap((user) => requestCasting(user, data.storyId, data.pageId, data.mode, data.requestId)),
      ),
    ),
  );

export const CastingStatusResult = ResultSchema(CastingStatus, DraftFailures);
export const castingStatusFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ storyId: Schema.String, taskId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      CastingStatusResult,
      currentUser.pipe(Effect.flatMap((user) => castingStatus(user, data.storyId, data.taskId))),
    ),
  );
