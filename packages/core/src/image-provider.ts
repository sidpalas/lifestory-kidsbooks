import { createHash } from "node:crypto";

import type { JsonObject } from "absurd-sdk";
import { Context, Effect, Layer, Schema } from "effect";
import sharp from "sharp";

import type { GenerationFailed } from "./errors.ts";
import { Jobs } from "./jobs.ts";
import { ObjectStorage } from "./storage.ts";

/** One image for a provider to render. Built by `generateImage` (generations.ts); providers never invent IDs. */
export interface ImageJob {
  readonly generationId: string;
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** Object keys of reference images, in order: the prompt calls them "the first image", "the second image", ... */
  readonly references: ReadonlyArray<string>;
  /**
   * "transparent" for a figure layer (D56), "opaque" for anything drawn on paper, such as a sheet. Without it the
   * provider chooses: OpenAI's "auto" can return a transparent sheet.
   */
  readonly background?: "transparent" | "opaque";
  /** Where the provider writes the image. */
  readonly outputKey: string;
}

export interface SubmitResult {
  /** The provider's own job ID, if it has one. */
  readonly externalId: string | null;
  /** What the provider reported using, and what that cost in US dollars, when known at submit time. */
  readonly usage?: JsonObject;
  readonly costUsd?: number;
}

/** How a generation ended; the payload of its `generation.done:<id>` event. */
export const GenerationOutcome = Schema.Union([
  Schema.Struct({ generationId: Schema.String, status: Schema.Literal("succeeded"), contentType: Schema.String }),
  Schema.Struct({ generationId: Schema.String, status: Schema.Literal("failed"), message: Schema.String }),
]);
export type GenerationOutcome = typeof GenerationOutcome.Type;

export const generationEvent = (generationId: string) => `generation.done:${generationId}`;

/**
 * The one boundary for image generation (docs/plan.md, "Generation workflow"). `submit` starts a job and returns;
 * the provider writes the image to `job.outputKey` and later emits `generation.done:<generationId>` with a
 * `GenerationOutcome`; both providers here are synchronous and emit it before `submit` returns. Submitting the
 * same generation twice must not render it twice.
 */
export class ImageProvider extends Context.Service<
  ImageProvider,
  {
    readonly name: string;
    /** File extension of the image it writes for a job, such as "png". */
    readonly extension: (job: Pick<ImageJob, "references">) => string;
    readonly submit: (job: ImageJob) => Effect.Effect<SubmitResult, GenerationFailed>;
  }
>()("@lifestory/core/ImageProvider") {}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Deterministic placeholder: the colour comes from a hash of the key, so reruns are byte-identical. */
export const renderPlaceholder = (request: { key: string; prompt: string; width: number; height: number }) => {
  const hue = createHash("sha256").update(request.key).digest().readUInt16BE(0) % 360;
  const { width, height } = request;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="hsl(${hue} 60% 80%)"/>
<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="hsl(${(hue + 180) % 360} 50% 60%)"/>
<text x="50%" y="90%" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(height / 20)}" fill="#333">${escapeXml(request.prompt)}</text>
</svg>
`;
  return { body: new TextEncoder().encode(svg), contentType: "image/svg+xml" };
};

/**
 * A deterministic stand-in for a transparent figure (D56): a soft figure-shaped blob in the key's colour, standing on
 * the bottom of the window as the bald figure does, with everything around it transparent. Enough for the fit
 * check, the keep-zone clip, the tint and the compose to run without a model.
 */
export const renderFakeFigure = async (request: { key: string; width: number; height: number }) => {
  const hue = createHash("sha256").update(request.key).digest().readUInt16BE(0) % 360;
  const { width: w, height: h } = request;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<ellipse cx="${w / 2}" cy="${h * 0.3}" rx="${w * 0.16}" ry="${h * 0.12}" fill="hsl(${hue} 45% 55%)"/>
<rect x="${w * 0.3}" y="${h * 0.38}" width="${w * 0.4}" height="${h * 0.5}" rx="${w * 0.08}" fill="hsl(${(hue + 40) % 360} 50% 50%)"/>
</svg>`;
  const body = await sharp(Buffer.from(svg)).png().toBuffer();
  return { body: new Uint8Array(body), contentType: "image/png" };
};

/**
 * The default provider (development, tests, CI): writes a placeholder PNG, or for a transparent job a fake figure
 * (renderFakeFigure), and emits the completion event itself, so the workflow takes the same submit, suspend, and
 * resume path as with a real provider.
 */
export const FakeImageProvider = Layer.effect(
  ImageProvider,
  Effect.gen(function* () {
    const storage = yield* ObjectStorage;
    const jobs = yield* Jobs;
    return {
      name: "fake",
      extension: () => "png",
      submit: (job) =>
        Effect.gen(function* () {
          const image =
            job.background === "transparent"
              ? yield* Effect.promise(() => renderFakeFigure({ key: job.generationId, ...job }))
              : yield* Effect.promise(async () => {
                  const svg = renderPlaceholder({ key: job.generationId, ...job });
                  const body = await sharp(Buffer.from(svg.body)).png().toBuffer();
                  return { body: new Uint8Array(body), contentType: "image/png" };
                });
          yield* storage.put(job.outputKey, image.body, image.contentType).pipe(Effect.orDie);
          const outcome: GenerationOutcome = {
            generationId: job.generationId,
            status: "succeeded",
            contentType: image.contentType,
          };
          yield* jobs.emit(generationEvent(job.generationId), outcome);
          return { externalId: null, costUsd: 0 };
        }),
    };
  }),
);
