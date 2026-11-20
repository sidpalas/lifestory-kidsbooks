// Modal's completion callback (modal/flux_klein.py). Verifies the HMAC signature, checks the generation exists,
// and emits its `generation.done` event, which resumes the waiting workflow. Duplicate callbacks are harmless:
// Absurd keeps the first payload for an event name.
import {
  Generations,
  GenerationOutcome,
  generationEvent,
  Jobs,
  signatureHeader,
  verifySignature,
} from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Config, Effect, Option, Redacted, Schema } from "effect";
import { serverRuntime } from "~/server/runtime";

const decodeOutcome = Schema.decodeUnknownEffect(Schema.fromJsonString(GenerationOutcome));

export const Route = createFileRoute("/api/webhooks/modal")({
  server: {
    handlers: {
      POST: ({ request }) =>
        serverRuntime().runPromise(
          Effect.gen(function* () {
            const secret = yield* Config.option(Config.Redacted("MODAL_CALLBACK_SECRET"));
            if (Option.isNone(secret)) return new Response("Not found", { status: 404 });
            const body = yield* Effect.promise(() => request.text());
            if (!verifySignature(Redacted.value(secret.value), body, request.headers.get(signatureHeader))) {
              return new Response("Bad signature", { status: 401 });
            }
            const outcome = yield* decodeOutcome(body).pipe(Effect.option);
            if (Option.isNone(outcome)) return new Response("Bad request", { status: 400 });
            const row = yield* Generations.use((generations) => generations.get(outcome.value.generationId));
            if (Option.isNone(row)) return new Response("Unknown generation", { status: 404 });
            yield* Jobs.use((jobs) => jobs.emit(generationEvent(outcome.value.generationId), outcome.value));
            return new Response(null, { status: 204 });
          }),
        ),
    },
  },
});
