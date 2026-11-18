import { createHash } from "node:crypto";
import { Context, Effect, Layer, Schema } from "effect";
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
  /** Object keys of reference images, in order: the model sees them as <ref_image_0>, <ref_image_1>, ... */
  readonly references: ReadonlyArray<string>;
  /** Where the provider writes the image. */
  readonly outputKey: string;
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
 * `GenerationOutcome`: the Modal provider through its callback route, the fake provider right away. Submitting the
 * same generation twice must not render it twice.
 */
export class ImageProvider extends Context.Service<
  ImageProvider,
  {
    readonly name: string;
    /** File extension of the images it writes, such as "png". */
    readonly extension: string;
    readonly submit: (job: ImageJob) => Effect.Effect<{ readonly externalId: string | null }, GenerationFailed>;
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
 * The default provider (development, tests, CI): writes a placeholder SVG and emits the completion event itself,
 * so the workflow takes the same submit, suspend, and resume path as with Modal.
 */
export const FakeImageProvider = Layer.effect(
  ImageProvider,
  Effect.gen(function* () {
    const storage = yield* ObjectStorage;
    const jobs = yield* Jobs;
    return {
      name: "fake",
      extension: "svg",
      submit: (job) =>
        Effect.gen(function* () {
          const image = renderPlaceholder({ key: job.generationId, ...job });
          yield* storage.put(job.outputKey, image.body, image.contentType).pipe(Effect.orDie);
          const outcome: GenerationOutcome = { generationId: job.generationId, status: "succeeded", contentType: image.contentType };
          yield* jobs.emit(generationEvent(job.generationId), outcome);
          return { externalId: null };
        }),
    };
  }),
);
