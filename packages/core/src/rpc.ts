import { Cause, Exit, Result, Schema } from "effect";

/**
 * Wire format for server function results. A server function runs an Effect,
 * and returns its Exit encoded with this schema, so typed failures (tagged
 * Schema errors) reach the client as the same tagged errors instead of a
 * generic thrown Error.
 */
export const ResultSchema = <A extends Schema.Top, E extends Schema.Top>(success: A, failure: E) =>
  Schema.toCodecJson(Schema.Exit(success, failure, Schema.Defect()));

/** Decodes an encoded result. Typed failures are thrown as their error class; defects as an Error. */
export const unwrapResult =
  <A, E>(schema: Schema.Codec<Exit.Exit<A, E>, Schema.Json>) =>
  (encoded: unknown): A => {
    const exit = Schema.decodeUnknownSync(schema)(encoded);
    if (Exit.isSuccess(exit)) return exit.value;
    const error = Cause.findError(exit.cause);
    if (Result.isSuccess(error)) throw error.success;
    throw new Error(Cause.pretty(exit.cause));
  };
