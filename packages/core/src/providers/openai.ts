// The OpenAI provider (D56): character sheets and figures with `gpt-image-2.5-sunburst` through the Images edit API,
// several reference images in order. The API is synchronous, so submit calls it, stores the output, and emits
// `generation.done` itself, like the fake provider. The model is configuration (OPENAI_PHOTO_MODEL): it must be one
// OpenAI lists as eligible for zero data retention, and OpenAI retires models, so a successor is measured on the
// same test set first. A job that sends a family's photo is refused unless OPENAI_ZDR=enabled says the project is
// under zero data retention.
import type { JsonObject } from "absurd-sdk";
import { Config, Effect, Layer, Redacted } from "effect";

import { GenerationFailed } from "../errors.ts";
import { generationEvent, type GenerationOutcome, ImageProvider } from "../image-provider.ts";
import { Jobs } from "../jobs.ts";
import { ObjectStorage } from "../storage.ts";

/**
 * US$ per million tokens, from OpenAI's pricing page (2.6: the assessment of 2026-11-19, thread
 * T-01a1f149-95e2-74f7-9818-59d430153d86). A model missing here records its usage with an unknown cost.
 */
export const openAIPrices: Readonly<
  Record<string, { readonly imageInput: number; readonly textInput: number; readonly output: number }>
> = {
  "gpt-image-2.6-sunburst": { imageInput: 8, textInput: 5, output: 30 },
  "gpt-image-2.6-flare": { imageInput: 8, textInput: 5, output: 30 },
};

interface OpenAIUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly input_tokens_details?: { readonly image_tokens?: number; readonly text_tokens?: number };
}

export const openAICost = (model: string, usage: OpenAIUsage | undefined): number | undefined => {
  const prices = openAIPrices[model];
  if (!prices || !usage) return undefined;
  const image = usage.input_tokens_details?.image_tokens ?? 0;
  const text = usage.input_tokens_details?.text_tokens ?? (usage.input_tokens ?? 0) - image;
  const dollars =
    (image * prices.imageInput + text * prices.textInput + (usage.output_tokens ?? 0) * prices.output) / 1e6;
  return Math.round(dollars * 1e6) / 1e6;
};

/** A family's photo, by its object key (D56): `families/<familyId>/books/<bookId>/photos/...`. */
export const isPhotoKey = (key: string) => /^families\/[^/]+\/books\/[^/]+\/photos\//.test(key);

/**
 * Below Absurd's 120 s task lease, so a slow call fails the step and is retried instead of a second worker
 * claiming the task while the first call is still running (and paid for).
 */
const requestTimeoutMs = 110_000;

export const OpenAIImageProvider = Layer.effect(
  ImageProvider,
  Effect.gen(function* () {
    const apiKey = yield* Config.Redacted("OPENAI_API_KEY");
    const model = yield* Config.String("OPENAI_PHOTO_MODEL").pipe(Config.withDefault("gpt-image-2.5-sunburst"));
    const zdr = (yield* Config.String("OPENAI_ZDR").pipe(Config.withDefault("off"))) === "enabled";
    const quality = yield* Config.Literals(["low", "medium", "high"], "OPENAI_IMAGE_QUALITY").pipe(
      Config.withDefault("medium" as const),
    );
    const endpoint = yield* Config.String("OPENAI_BASE_URL").pipe(Config.withDefault("https://api.openai.com/v1"));
    const storage = yield* ObjectStorage;
    const jobs = yield* Jobs;

    return {
      name: `openai:${model}`,
      extension: () => "png",
      submit: (job) =>
        Effect.gen(function* () {
          const fail = (message: string) => new GenerationFailed({ generationId: job.generationId, message });
          const finish = (outcome: GenerationOutcome) => jobs.emit(generationEvent(job.generationId), outcome);

          if (!zdr && job.references.some(isPhotoKey)) {
            yield* finish({
              generationId: job.generationId,
              status: "failed",
              message: "refused: a family's photo goes to OpenAI only with OPENAI_ZDR=enabled",
            });
            return { externalId: null };
          }

          // A rerun of the submit step after the image was stored must not pay for it again.
          const existing = yield* storage.get(job.outputKey).pipe(Effect.option);
          if (existing._tag === "Some") {
            yield* finish({ generationId: job.generationId, status: "succeeded", contentType: "image/png" });
            return { externalId: null };
          }

          const form = new FormData();
          form.set("model", model);
          form.set("prompt", job.prompt);
          form.set("size", `${job.width}x${job.height}`);
          form.set("quality", quality);
          form.set("output_format", "png");
          form.set("n", "1");
          if (job.background) form.set("background", job.background);
          for (const [i, key] of job.references.entries()) {
            const reference = yield* storage.get(key).pipe(Effect.mapError((error) => fail(error.message)));
            form.append(
              "image[]",
              new Blob([new Uint8Array(reference.body)], { type: reference.contentType }),
              `ref-${i}.png`,
            );
          }
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${endpoint}/images/edits`, {
                method: "POST",
                headers: { authorization: `Bearer ${Redacted.value(apiKey)}` },
                body: form,
                signal: AbortSignal.timeout(requestTimeoutMs),
              }),
            catch: (error) => fail(`request failed: ${String(error)}`),
          });
          const text = yield* Effect.promise(() => response.text());
          if (response.status === 429 || response.status >= 500) {
            // Rate limits and outages pass: fail the step, and Absurd retries the task.
            return yield* fail(`OpenAI returned ${response.status}: ${text.slice(0, 300)}`);
          }
          if (!response.ok) {
            // A rejected request (content policy, bad input) fails the same way every time: end the generation.
            yield* finish({
              generationId: job.generationId,
              status: "failed",
              message: `OpenAI returned ${response.status}: ${text.slice(0, 500)}`,
            });
            return { externalId: null };
          }
          const body = JSON.parse(text) as { data?: ReadonlyArray<{ b64_json?: string }>; usage?: OpenAIUsage };
          const image = body.data?.[0]?.b64_json;
          if (!image) return yield* fail(`OpenAI returned no image: ${text.slice(0, 300)}`);
          yield* storage
            .put(job.outputKey, new Uint8Array(Buffer.from(image, "base64")), "image/png")
            .pipe(Effect.mapError((error) => fail(error.message)));
          yield* finish({ generationId: job.generationId, status: "succeeded", contentType: "image/png" });
          const costUsd = openAICost(model, body.usage);
          return {
            externalId: null,
            ...(body.usage ? { usage: { model, quality, ...body.usage } as unknown as JsonObject } : {}),
            ...(costUsd !== undefined ? { costUsd } : {}),
          };
        }),
    };
  }),
);
