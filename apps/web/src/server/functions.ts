import {
  NotAuthenticated,
  CastMember,
  Look,
  NotFound,
  ResultSchema,
  SampleFileResult,
  StoryManifest,
  StorySummary,
  JobError,
  UnsupportedLook,
  TaskState,
  Forbidden,
  ProofSummary,
  TextStyleName,
} from "@lifestory/core/contracts";
import {
  Auth,
  canAuthor,
  getStoryPreview,
  Jobs,
  listPublishedStories,
  listStoryProofs,
  printableProof,
  requestStoryProof,
  writeSampleFile,
} from "@lifestory/core";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { runEffect } from "./runtime.ts";

// Result schemas are shared with the client, which decodes with unwrapResult.
export const HomeResult = ResultSchema(
  Schema.Struct({
    user: Schema.Struct({ name: Schema.String, email: Schema.String }),
    stories: Schema.Array(StorySummary),
    canAuthor: Schema.Boolean,
  }),
  NotAuthenticated,
);

export const StartSampleFileResult = ResultSchema(
  Schema.Struct({ taskId: Schema.String }),
  Schema.Union([NotAuthenticated, JobError]),
);

export const SampleFileStatusResult = ResultSchema(
  Schema.Struct({ state: TaskState, result: Schema.NullOr(SampleFileResult) }),
  Schema.Union([NotAuthenticated, JobError]),
);

const currentUser = Auth.use((auth) => auth.requireUser(getRequest().headers));

export const getHome = createServerFn({ method: "GET" }).handler(() =>
  runEffect(
    HomeResult,
    Effect.gen(function* () {
      const user = yield* currentUser;
      const stories = yield* listPublishedStories();
      return { user: { name: user.name, email: user.email }, stories, canAuthor: yield* canAuthor(user) };
    }),
  ),
);

export const startSampleFile = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ label: Schema.String.check(Schema.isMinLength(1)) })))
  .handler(async ({ data }) => {
      return runEffect(
      StartSampleFileResult,
      Effect.gen(function* () {
        const user = yield* currentUser;
        const jobs = yield* Jobs;
        return yield* jobs.spawn(writeSampleFile, { label: data.label, requestedBy: user.id });
      }),
    );
  });

export const getSampleFileStatus = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ taskId: Schema.String })))
  .handler(async ({ data }) => {
      return runEffect(
      SampleFileStatusResult,
      Effect.gen(function* () {
        yield* currentUser;
        const jobs = yield* Jobs;
        const status = yield* jobs.status(data.taskId);
        const result =
          status.state === "completed" ? yield* Schema.decodeUnknownEffect(SampleFileResult)(status.result).pipe(Effect.orDie) : null;
        return { state: status.state, result };
      }),
    );
  });

const Rect = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]);

export const StoryPreviewResult = ResultSchema(
  Schema.Struct({
    story: StorySummary,
    version: Schema.Number,
    manifest: StoryManifest,
    cast: Schema.Record(Schema.String, CastMember),
    /** Each page's composed illustration, as storage keys placed in the illustration area. */
    pages: Schema.Array(Schema.Struct({ pageId: Schema.String, layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })) })),
  }),
  Schema.Union([NotAuthenticated, NotFound, UnsupportedLook]),
);

export const getStoryPreviewFn = createServerFn({ method: "GET" })
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ slug: Schema.String, looks: Schema.optional(Schema.Record(Schema.String, Look)) })),
  )
  .handler(async ({ data }) =>
    runEffect(
      StoryPreviewResult,
      Effect.gen(function* () {
        const user = yield* currentUser;
        return yield* getStoryPreview(user.id, data.slug, data.looks);
      }),
    ),
  );

const StorySlugAndLooks = Schema.Struct({ slug: Schema.String, looks: Schema.optional(Schema.Record(Schema.String, Look)) });

export const RequestProofResult = ResultSchema(Schema.Struct({ id: Schema.String }), Schema.Union([NotAuthenticated, NotFound, Forbidden, UnsupportedLook, JobError]));

/** Starts a PDF proof of the story with the looks shown, for the user's family (D27). */
export const requestStoryProofFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(StorySlugAndLooks))
  .handler(async ({ data }) =>
    runEffect(
      RequestProofResult,
      Effect.gen(function* () {
        const user = yield* currentUser;
        return yield* requestStoryProof(user, data.slug, data.looks);
      }),
    ),
  );

export const StoryProofsResult = ResultSchema(
  Schema.Struct({ canRequest: Schema.Boolean, proofs: Schema.Array(ProofSummary) }),
  Schema.Union([NotAuthenticated, NotFound, Forbidden]));

export const listStoryProofsFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ slug: Schema.String })))
  .handler(async ({ data }) =>
    runEffect(
      StoryProofsResult,
      Effect.gen(function* () {
        const user = yield* currentUser;
        return yield* listStoryProofs(user, data.slug);
      }),
    ),
  );

export const PrintableProofResult = ResultSchema(
  Schema.Struct({
    storyId: Schema.String,
    version: Schema.Number,
    manifest: StoryManifest,
    cast: Schema.Record(Schema.String, CastMember),
    pages: Schema.Array(
      Schema.Struct({
        pageId: Schema.String,
        layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })),
        text: Schema.Array(Schema.Struct({ style: TextStyleName, text: Schema.String })),
      }),
    ),
  }),
  NotFound,
);

/** The print page's data. No session: the worker's headless Chromium holds a print token for this one proof. */
export const getPrintableProofFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ proofId: Schema.String, token: Schema.String })))
  .handler(async ({ data }) => runEffect(PrintableProofResult, printableProof(data.proofId, data.token)));
