import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { NotAuthenticated, NotFound } from "../src/errors.ts";
import { ResultSchema, unwrapResult } from "../src/rpc.ts";

const Result = ResultSchema(Schema.Struct({ n: Schema.Number }), Schema.Union([NotAuthenticated, NotFound]));
// Simulates the server function boundary: encode, serialize to JSON, parse, decode.
const roundTrip = (effect: Effect.Effect<{ n: number }, NotAuthenticated | NotFound>) =>
  unwrapResult(Result)(JSON.parse(JSON.stringify(Schema.encodeSync(Result)(Effect.runSync(Effect.exit(effect))))));

describe("server function results", () => {
  it("round-trips success values", () => {
    expect(roundTrip(Effect.succeed({ n: 7 }))).toEqual({ n: 7 });
  });

  it("rethrows a typed failure as the same tagged error class", () => {
    const thrown = (() => {
      try {
        roundTrip(Effect.fail(new NotFound({ entity: "story", id: "s1" })));
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeInstanceOf(NotFound);
    expect(thrown).toMatchObject({ _tag: "NotFound", entity: "story", id: "s1" });
  });

  it("turns a defect into a plain Error rather than a typed failure", () => {
    expect(() => roundTrip(Effect.die(new Error("boom")))).toThrow(Error);
    expect(() => roundTrip(Effect.die(new Error("boom")))).not.toThrow(NotFound);
  });
});
