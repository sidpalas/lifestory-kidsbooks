import {
  FamilyMembership,
  NotAuthenticated,
  ResultSchema,
  SampleFileResult,
  StorySummary,
  JobError,
  TaskState,
} from "@lifestory/core/contracts";
import { Auth, Jobs, listPublishedStories, listUserFamilies, writeSampleFile } from "@lifestory/core";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { runEffect } from "./runtime.ts";

// Result schemas are shared with the client, which decodes with unwrapResult.
export const HomeResult = ResultSchema(
  Schema.Struct({
    user: Schema.Struct({ name: Schema.String, email: Schema.String }),
    families: Schema.Array(FamilyMembership),
    stories: Schema.Array(StorySummary),
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
      const families = yield* listUserFamilies(user.id);
      const stories = yield* listPublishedStories();
      return { user: { name: user.name, email: user.email }, families, stories };
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
