import { Schema } from "effect";

// Typed domain errors. Each is a Schema class so it survives the server
// function boundary (see rpc.ts) and can be matched by _tag on the client.

export class NotAuthenticated extends Schema.TaggedError<NotAuthenticated>()("NotAuthenticated", {}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  entity: Schema.String,
  id: Schema.String,
}) {}

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  operation: Schema.String,
  key: Schema.String,
  message: Schema.String,
}) {}

export class JobError extends Schema.TaggedError<JobError>()("JobError", {
  message: Schema.String,
}) {}

/** An image generation that the provider rejected, failed, or that its content filter blocked. */
export class GenerationFailed extends Schema.TaggedError<GenerationFailed>()("GenerationFailed", {
  generationId: Schema.String,
  message: Schema.String,
}) {}
