import { Effect, Schema } from "effect";
import type { SampleFileResult } from "../contracts.ts";
import { generateImage } from "../generations.ts";
import { defineTask, step } from "../jobs.ts";
import { ObjectStorage } from "../storage.ts";

/**
 * Foundation smoke task: generates an image through the provider's submit, suspend, and callback path and
 * reports what landed in object storage. Keys derive from the task ID, so a rerun converges on one object.
 */
export const writeSampleFile = defineTask({
  name: "sample.write-file",
  params: Schema.Struct({ label: Schema.String, requestedBy: Schema.String }),
  run: (params, ctx) =>
    Effect.gen(function* () {
      const image = yield* generateImage(ctx, "image", {
        key: `sample:${ctx.taskID}`,
        prompt: params.label,
        width: 600,
        height: 400,
        outputKey: `samples/${ctx.taskID}`,
      });
      return yield* step(
        ctx,
        "inspect",
        ObjectStorage.use((storage) => storage.get(image.key)).pipe(
          Effect.map(
            (object) => ({ key: image.key, contentType: object.contentType, bytes: object.body.byteLength }) satisfies SampleFileResult,
          ),
        ),
      );
    }),
});
