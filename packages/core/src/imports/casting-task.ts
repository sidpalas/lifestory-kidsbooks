import { createHash } from "node:crypto";

import { Effect, Schema } from "effect";

import { CharacterSlot, type Rect, storyAssetKey } from "../book-format/index.ts";
import { generateImage } from "../generations.ts";
import { defineTask, Jobs, step } from "../jobs.ts";
import { prepareBase } from "../parts/images.ts";
import { ObjectStorage } from "../storage.ts";
import { CastingPage, type CastingOutcome } from "./casting-contract.ts";
import { CastingProvider } from "./casting-provider.ts";
import { ImportResult } from "./contract.ts";
import { separateFlat } from "./images.ts";
import { area, importTask, removePrompt } from "./task.ts";

export const castingTask = defineTask({
  name: "page.cast",
  params: Schema.Struct({
    storyId: Schema.String,
    version: Schema.Number,
    page: CastingPage,
    roles: Schema.Array(CharacterSlot),
    mode: Schema.Literals(["detect", "extract"]),
  }),
  run: ({ storyId, version, page, roles, mode }, ctx) => {
    const key = (asset: string) => storyAssetKey(storyId, version, asset);
    return Effect.gen(function* () {
      const provider = yield* CastingProvider;
      const read = (asset: string) => ObjectStorage.use((s) => s.get(key(asset))).pipe(Effect.orDie);
      const write = (asset: string, bytes: Uint8Array, contentType = "image/png") =>
        ObjectStorage.use((s) => s.put(key(asset), bytes, contentType)).pipe(Effect.orDie);
      const outcome = (
        error: string | null,
        figures = page.figures,
        results: ReadonlyArray<ImportResult> = [],
      ): CastingOutcome => ({
        storyId,
        error,
        figures,
        results,
        provider: provider.name,
      });
      if (mode === "detect") {
        return yield* step(
          ctx,
          "detect",
          Effect.gen(function* () {
            const source = yield* read(page.asset);
            return yield* provider.detect(source.body, roles).pipe(
              Effect.map((figures) => outcome(null, figures)),
              Effect.catchTag("InvalidInput", (e) => Effect.succeed(outcome(e.message))),
            );
          }),
        );
      }
      const figures = page.figures.filter((f) => !f.ignored);
      const bounds: Rect = [
        Math.min(...figures.map((f) => f.box[0])),
        Math.min(...figures.map((f) => f.box[1])),
        Math.max(...figures.map((f) => f.box[2])),
        Math.max(...figures.map((f) => f.box[3])),
      ];
      const id = createHash("sha256").update(ctx.taskID).digest("hex").slice(0, 12);
      const folder = `pages/${page.pageId}/casting`;
      const input = `${folder}/${id}-input.png`;
      const removed = `${folder}/${id}-removed.png`;
      const plate = `${folder}/${id}-plate.jpg`;
      const prepared = yield* step(
        ctx,
        "prepare",
        Effect.gen(function* () {
          const source = yield* read(page.asset);
          const p = yield* Effect.promise(() => prepareBase(source.body));
          yield* write(input, p.input);
          const { base: _, input: __, ...geometry } = p;
          return geometry;
        }),
      );
      // One removal of all selected people. Every per-character import uses the same original, edit and final plate.
      const edit = yield* generateImage(ctx, "remove-cast", {
        key: `casting:${ctx.taskID}`,
        prompt: removePrompt(figures.map((f) => f.description).join(" AND "), area(bounds, prepared)),
        width: prepared.inputWidth,
        height: prepared.inputHeight,
        references: [key(input)],
        outputKey: key(`${folder}/${id}-removed`),
      }).pipe(Effect.catchTag("GenerationFailed", (e) => Effect.succeed({ failed: e.message } as const)));
      if ("failed" in edit) return outcome(edit.failed);
      const plateError = yield* step(
        ctx,
        "shared-plate",
        Effect.gen(function* () {
          const [source, edited] = yield* Effect.all([read(page.asset), read(removed)]);
          const p = yield* Effect.promise(() => prepareBase(source.body));
          const result = yield* Effect.promise(() => separateFlat(source.body, p, edited.body, bounds));
          if ("error" in result) return result.error ?? "Couldn't separate the page.";
          yield* write(plate, result.plate, "image/jpeg");
          return null;
        }),
      );
      if (plateError) return outcome(plateError);
      const tasks = yield* step(
        ctx,
        "imports",
        Effect.forEach(figures, (f) =>
          Jobs.use((jobs) =>
            jobs.spawn(
              importTask,
              {
                storyId,
                version,
                request: {
                  kind: "page",
                  pageId: page.pageId,
                  slotId: f.slotId,
                  age: f.age,
                  face: f.face,
                  hair: f.hair,
                  bald: f.hair === null,
                  hairZone: [0, 0, 1000, 500],
                  seed: 1,
                  source: {
                    kind: "flat",
                    asset: page.asset,
                    box: f.box,
                    description: f.description,
                    head: f.head,
                    removed,
                    plate,
                    removalBox: bounds,
                  },
                },
              },
              { idempotencyKey: `cast-import:${ctx.taskID}:${f.id}` },
            ),
          ).pipe(Effect.orDie),
        ),
      );
      for (let attempt = 0; ; attempt++) {
        const states = yield* step(
          ctx,
          `wait-${attempt}`,
          Effect.forEach(tasks, (task) => Jobs.use((j) => j.status(task.taskId)).pipe(Effect.orDie)),
        );
        if (states.some((s) => s.state === "failed" || s.state === "cancelled"))
          return outcome("A character extraction stopped. Correct the casting or retry.");
        if (states.every((s) => s.state === "completed")) {
          const results: ImportResult[] = [];
          for (const s of states) {
            const result = Schema.decodeUnknownSync(
              Schema.Union([
                Schema.Struct({ result: ImportResult }),
                Schema.Struct({ storyId: Schema.String, error: Schema.String }),
              ]),
            )(s.result);
            if ("error" in result) return outcome(result.error);
            results.push(result.result);
          }
          return outcome(null, figures, results);
        }
        yield* Effect.promise(() => ctx.sleepFor(`pause-${attempt}`, 2));
      }
    });
  },
});
