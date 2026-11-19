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

/** The caller is signed in but their role doesn't allow this action. */
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  message: Schema.String,
}) {}

/** Wrong email or password, or an account that can't sign in. */
export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()("InvalidCredentials", {}) {}

/** An account with this email already exists (and has a password). */
export class AccountExists extends Schema.TaggedError<AccountExists>()("AccountExists", {
  email: Schema.String,
}) {}

/** An invitation or set-password link that is unknown, expired, or already used. */
export class InviteInvalid extends Schema.TaggedError<InviteInvalid>()("InviteInvalid", {}) {}

/** Better Auth refused a request; message is its explanation (for example "already a member"). */
export class AuthRejected extends Schema.TaggedError<AuthRejected>()("AuthRejected", {
  code: Schema.String,
  message: Schema.String,
}) {}

/** The story can't draw this look for the slot: these axes have options it doesn't supply (D26). */
export class UnsupportedLook extends Schema.TaggedError<UnsupportedLook>()("UnsupportedLook", {
  slotId: Schema.String,
  axes: Schema.Array(Schema.String),
}) {}
