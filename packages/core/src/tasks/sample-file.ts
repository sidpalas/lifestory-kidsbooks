import { Effect, Schema } from "effect";
import type { SampleFileResult } from "../contracts.ts";
import { ImageProvider } from "../image-provider.ts";
import { defineTask, step } from "../jobs.ts";
import { ObjectStorage } from "../storage.ts";


/**
 * Foundation smoke task: renders a placeholder through the image provider and
 * writes it to object storage. The object key comes from the task ID, so a
 * retried step overwrites the same object instead of creating a second one.
 */
export const writeSampleFile = defineTask({
  name: "sample.write-file",
  params: Schema.Struct({ label: Schema.String, requestedBy: Schema.String }),
  run: (params, ctx) =>
    step(
      ctx,
      "render-and-store",
      Effect.gen(function* () {
        const images = yield* ImageProvider;
        const storage = yield* ObjectStorage;
        const key = `samples/${ctx.taskID}.svg`;
        const image = yield* images.generate({ key, prompt: params.label, width: 600, height: 400 });
        yield* storage.put(key, image.body, image.contentType);
        return { key, contentType: image.contentType, bytes: image.body.byteLength } satisfies SampleFileResult;
      }),
    ),
});

/** Every task the worker runs. */
export const tasks = [writeSampleFile] as const;
