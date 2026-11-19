import { schema } from "@lifestory/db";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { decodeStoryVersion, storyAssetKey } from "../book-format/index.ts";
import type { Rect } from "../book-format/manifest.ts";
import { Database } from "../database.ts";
import { generateImage } from "../generations.ts";
import { defineTask, step } from "../jobs.ts";
import type { Age, FeaturesOption } from "../looks/vocabulary.ts";
import { byLightness, composeReview, cutOutLayer, prepareBase, reviewSheet } from "../parts/images.ts";
import { findAppearance, partAssets, PartTaskParams, type StoredLayer } from "../parts/parts.ts";
import { ObjectStorage } from "../storage.ts";

/** The part, its story version, and the appearance it is for; a missing one is a bug (requestPart checked it). */
const loadPart = Effect.fn("parts.load")(function* (partId: string) {
  const [row] = yield* Database.query((db) =>
    db
      .select({ part: schema.storyPart, storyId: schema.storyVersion.storyId, version: schema.storyVersion.version, manifest: schema.storyVersion.manifest, publishedAt: schema.storyVersion.publishedAt })
      .from(schema.storyPart)
      .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.storyPart.storyVersionId))
      .where(eq(schema.storyPart.id, partId)),
  );
  if (!row) return yield* Effect.die(new Error(`part ${partId} doesn't exist`));
  const manifest = yield* decodeStoryVersion(row.manifest, row.publishedAt).pipe(Effect.orDie);
  const appearance = findAppearance(manifest, row.part.pageId, row.part.slotId, row.part.age as Age, row.part.face, row.part.features as FeaturesOption | null);
  if ("problem" in appearance) return yield* Effect.die(new Error(`part ${partId}: ${appearance.problem}`));
  const storage = yield* ObjectStorage;
  const key = (asset: string) => storyAssetKey(row.storyId, row.version, asset);
  const read = (asset: string) => storage.get(key(asset)).pipe(Effect.map((object) => object.body), Effect.orDie);
  const put = (asset: string, body: Uint8Array) => storage.put(key(asset), body, "image/png").pipe(Effect.orDie);
  return { ...row, ...appearance, assets: partAssets(partId), key, read, put };
});

/** Updates the part's row; returns true, since a step's result must be JSON. */
const setPart = (partId: string, patch: Partial<typeof schema.storyPart.$inferInsert>) =>
  Database.query((db) => db.update(schema.storyPart).set(patch).where(eq(schema.storyPart.id, partId))).pipe(Effect.as(true));

/**
 * Generates one part for an appearance (docs/plan.md, "Authoring-time part generation"; D30), in steps a rerun
 * repeats harmlessly (every file's key derives from the part ID, and each computation is deterministic):
 *
 * 1. `prepare`: the base flattened at working size (the known background) and padded for the provider.
 * 2. `edit`: the provider's in-place edit (generateImage: submit, suspend until done, record with its cost).
 * 3. `cut-out`: align, colour-match, segment, matte, unmix (parts/cutout.ts), and split by region into RGBA layers
 *    placed in the base: the part, and any skin the model drew in it.
 * 4. `review-images`: the layer composed on the lightest and darkest skin of the story's palettes, and a sheet.
 * 5. `record`: the part waits for the illustrator's review.
 *
 * A provider failure or an edit that added nothing in the zone marks the part failed.
 */
export const generatePart = defineTask({
  name: "part.generate",
  params: PartTaskParams,
  run: ({ partId }, ctx) =>
    Effect.gen(function* () {
      const prepared = yield* step(
        ctx,
        "prepare",
        Effect.gen(function* () {
          const part = yield* loadPart(partId);
          const asset = yield* part.read(part.base.asset);
          const base = yield* Effect.promise(() => prepareBase(asset));
          yield* part.put(part.assets.base, base.base);
          yield* part.put(part.assets.input, base.input);
          const { base: _, input: __, ...geometry } = base;
          return { ...geometry, prompt: part.part.prompt, input: part.key(part.assets.input), edit: part.key(part.assets.edit) };
        }),
      );

      const edit = yield* generateImage(ctx, "edit", {
        key: `part:${partId}`,
        prompt: prepared.prompt,
        width: prepared.inputWidth,
        height: prepared.inputHeight,
        references: [prepared.input],
        outputKey: prepared.edit,
      }).pipe(
        Effect.catchTag("GenerationFailed", (error) =>
          step(ctx, "failed", setPart(partId, { status: "failed", error: error.message, generationId: error.generationId })).pipe(Effect.as(null)),
        ),
      );
      if (!edit) return { partId, status: "failed" as const };

      const cut = yield* step(
        ctx,
        "cut-out",
        Effect.gen(function* () {
          const part = yield* loadPart(partId);
          const storage = yield* ObjectStorage;
          const [base, skinMask, output] = yield* Effect.all([
            part.read(part.assets.base),
            part.read(part.base.skinMask),
            storage.get(edit.key).pipe(Effect.orDie),
          ]);
          const { layers, metrics } = yield* Effect.promise(() =>
            cutOutLayer({ base, width: prepared.width, height: prepared.height, padding: prepared.padding }, output.body, skinMask, part.part.zone as Rect, {
              neutral: part.part.axis !== "glasses",
            }),
          );
          const stored: Array<StoredLayer> = [];
          for (const layer of layers) {
            const asset = layer.region === "skin" ? part.assets.skin : part.assets.part;
            yield* part.put(asset, layer.png);
            stored.push({ asset, at: layer.at, palette: layer.region === "skin" ? "skin" : part.part.axis !== "glasses" ? "hairColour" : "none" });
          }
          return { layers: stored, metrics };
        }),
      );
      if (!cut.layers.some((layer) => layer.palette !== "skin")) {
        yield* step(ctx, "failed", setPart(partId, { status: "failed", error: "the edit added nothing inside the zone", generationId: edit.generationId, metrics: cut.metrics }));
        return { partId, status: "failed" as const };
      }

      yield* step(
        ctx,
        "review-images",
        Effect.gen(function* () {
          const part = yield* loadPart(partId);
          const { palettes } = yield* decodeStoryVersion(part.manifest, part.publishedAt).pipe(Effect.orDie);
          const skins = byLightness(palettes.skin);
          const hairs = byLightness(palettes.hairColour);
          const [base, skinMask, browMask, layers] = yield* Effect.all([
            part.read(part.base.asset),
            part.read(part.base.skinMask),
            part.base.browMask ? part.read(part.base.browMask) : Effect.succeed(undefined),
            Effect.forEach(cut.layers, (layer) => part.read(layer.asset).pipe(Effect.map((png) => ({ png, at: layer.at, palette: layer.palette })))),
          ]);
          const inputs = { base, skinMask, ...(browMask ? { browMask } : {}), layers };
          // The lightest skin with the darkest hair, and the darkest skin with the lightest: a band of the base's old
          // skin or a dark fringe left in the layer shows on one of them.
          const light = { skin: palettes.skin[skins[0]!]!, hair: palettes.hairColour[hairs.at(-1)!]! };
          const dark = { skin: palettes.skin[skins.at(-1)!]!, hair: palettes.hairColour[hairs[0]!]! };
          const [lightPng, darkPng] = yield* Effect.promise(() =>
            Promise.all([composeReview(inputs, light, prepared.width, prepared.height), composeReview(inputs, dark, prepared.width, prepared.height)]),
          );
          const sheet = yield* Effect.promise(() => reviewSheet(lightPng, darkPng, layers, part.part.zone as Rect, prepared.width, prepared.height));
          yield* part.put(part.assets.light, lightPng);
          yield* part.put(part.assets.dark, darkPng);
          yield* part.put(part.assets.sheet, sheet);
          return { light: skins[0]!, dark: skins.at(-1)! };
        }),
      );

      yield* step(
        ctx,
        "record",
        setPart(partId, { status: "pending_review", layers: cut.layers, metrics: cut.metrics, generationId: edit.generationId, error: null }),
      );
      return { partId, status: "pending_review" as const };
    }),
});
