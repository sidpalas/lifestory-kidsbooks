import type { JsonObject } from "absurd-sdk";
import { createHash } from "node:crypto";
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
  /** Object keys of reference images, in order: the model sees them as <ref_image_0>, <ref_image_1>, ... */
  readonly references: ReadonlyArray<string>;
  /** Where the provider writes the image. */
  readonly outputKey: string;
}

export interface SubmitResult {
  /** The provider's own job ID (Modal's function call ID), if it has one. */
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
 * `GenerationOutcome`: the Modal provider through its callback route, the fake provider right away. Submitting the
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
 * A deterministic stand-in for an in-place edit of `reference` (a PNG), so part generation runs its whole cut-out
 * without a model: the picture comes back shifted by a pixel and re-toned slightly, as a model returns it, with
 * glasses or a cap of hair (soft edge, a few one-pixel wisps) drawn where the sample story's hero has its head in
 * the padded 2:3 input. Strand positions come from the key, so reruns are byte-identical.
 */
export const renderFakeEdit = async (reference: Uint8Array, request: { key: string; prompt: string }) => {
  const { width, height } = await sharp(reference).metadata();
  const w = width!;
  const h = height!;
  const seed = createHash("sha256").update(request.key).digest();
  const part = /glasses/i.test(request.prompt)
    ? [0.443, 0.559]
        .map((x) => `<circle cx="${x * w}" cy="${0.226 * h}" r="${0.045 * w}" fill="none" stroke="#1d1a1c" stroke-width="${0.006 * w}"/>`)
        .join("") + `<path d="M${0.488 * w} ${0.226 * h} H${0.514 * w}" stroke="#1d1a1c" stroke-width="${0.005 * w}"/>`
    : `<ellipse cx="${0.5 * w}" cy="${0.135 * h}" rx="${0.185 * w}" ry="${0.055 * h}" fill="#4b3a33" filter="url(#soft)"/>` +
      [0, 1, 2, 3, 4, 5]
        .map((i) => {
          const x = (0.36 + 0.28 * (seed[i]! / 255)) * w;
          return `<path d="M${x} ${0.2 * h} q${0.01 * w} ${0.03 * h} 0 ${0.05 * h}" fill="none" stroke="#4b3a33" stroke-opacity="0.6" stroke-width="1.2"/>`;
        })
        .join("");
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><filter id="soft"><feGaussianBlur stdDeviation="1.5"/></filter></defs>${part}</svg>`,
  );
  const shifted = await sharp(reference).removeAlpha().extend({ left: 1, top: 1, extendWith: "copy" }).extract({ left: 0, top: 0, width: w, height: h }).linear(0.98, 4).png().toBuffer();
  const body = await sharp(shifted).composite([{ input: overlay }]).png().toBuffer();
  return { body: new Uint8Array(body), contentType: "image/png" };
};

/**
 * The default provider (development, tests, CI): writes a placeholder SVG, or with a reference image an edit of it
 * (renderFakeEdit), and emits the completion event itself, so the workflow takes the same submit, suspend, and
 * resume path as with a real provider.
 */
export const FakeImageProvider = Layer.effect(
  ImageProvider,
  Effect.gen(function* () {
    const storage = yield* ObjectStorage;
    const jobs = yield* Jobs;
    return {
      name: "fake",
      extension: (job) => (job.references.length > 0 ? "png" : "svg"),
      submit: (job) =>
        Effect.gen(function* () {
          const [reference] = job.references;
          const image = reference
            ? yield* storage.get(reference).pipe(
                Effect.flatMap((object) => Effect.promise(() => renderFakeEdit(object.body, { key: job.generationId, prompt: job.prompt }))),
                Effect.orDie,
              )
            : renderPlaceholder({ key: job.generationId, ...job });
          yield* storage.put(job.outputKey, image.body, image.contentType).pipe(Effect.orDie);
          const outcome: GenerationOutcome = { generationId: job.generationId, status: "succeeded", contentType: image.contentType };
          yield* jobs.emit(generationEvent(job.generationId), outcome);
          return { externalId: null, costUsd: 0 };
        }),
    };
  }),
);
