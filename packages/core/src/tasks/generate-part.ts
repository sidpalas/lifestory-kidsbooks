import { createHash } from "node:crypto";

import { schema } from "@lifestory/db";
import type { TaskContext } from "absurd-sdk";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";

import { decodeStoryVersion, storyAssetKey } from "../book-format/index.ts";
import type { Rect } from "../book-format/manifest.ts";
import { Database } from "../database.ts";
import { generateImage } from "../generations.ts";
import { defineTask, step } from "../jobs.ts";
import { type Age, DEFAULT_FEATURES, type FeaturesOption, sameAppearance } from "../looks/vocabulary.ts";
import {
  byLightness,
  composeReview,
  type CutOutOptions,
  cutOutLayer,
  cutOutTile,
  headTop,
  type PartLayer,
  prepareBase,
  rectToPixels,
  referenceImage,
  reviewSheet,
  type TilePlacement,
  tileBases,
} from "../parts/images.ts";
import {
  findAppearance,
  partAssets,
  partPrompt,
  PartTaskParams,
  type StoredLayer,
  tiledPrompt,
} from "../parts/parts.ts";
import { ObjectStorage } from "../storage.ts";

/** The part, its story version, and the appearance it is for; a missing one is a bug (requestParts checked it). */
const loadPart = Effect.fn("parts.load")(function* (partId: string) {
  const [row] = yield* Database.query((db) =>
    db
      .select({
        part: schema.storyPart,
        storyId: schema.storyVersion.storyId,
        version: schema.storyVersion.version,
        manifest: schema.storyVersion.manifest,
        publishedAt: schema.storyVersion.publishedAt,
      })
      .from(schema.storyPart)
      .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.storyPart.storyVersionId))
      .where(eq(schema.storyPart.id, partId)),
  );
  if (!row) return yield* Effect.die(new Error(`part ${partId} doesn't exist`));
  const manifest = yield* decodeStoryVersion(row.manifest, row.publishedAt).pipe(Effect.orDie);
  const appearance = findAppearance(
    manifest,
    row.part.pageId,
    row.part.slotId,
    row.part.age as Age,
    row.part.face,
    row.part.features as FeaturesOption | null,
  );
  if ("problem" in appearance) return yield* Effect.die(new Error(`part ${partId}: ${appearance.problem}`));
  const storage = yield* ObjectStorage;
  const key = (asset: string) => storyAssetKey(row.storyId, row.version, asset);
  const read = (asset: string) =>
    storage.get(key(asset)).pipe(
      Effect.map((object) => object.body),
      Effect.orDie,
    );
  const put = (asset: string, body: Uint8Array) => storage.put(key(asset), body, "image/png").pipe(Effect.orDie);
  return { ...row, decoded: manifest, ...appearance, assets: partAssets(partId), key, read, put };
});
type LoadedPart = Effect.Success<ReturnType<typeof loadPart>>;

/**
 * An approved drawing of the parts' option for the edit to copy, as referenceImage: one of the version's approved
 * manifest parts (the illustrator's or imported art), else its earliest approved generated part, preferring the
 * same role and then the same face type. Null when the option has no approved drawing yet.
 */
const referenceFor = Effect.fn("parts.reference")(function* (parts: ReadonlyArray<LoadedPart>) {
  const first = parts[0]!;
  const { option } = first.part;
  const generating = new Set(parts.map((part) => part.part.id));
  const fromManifest = first.decoded.pages.flatMap((page) =>
    page.illustration.layers.flatMap((layer) => {
      if (layer.kind !== "figure") return [];
      const drawn = layer.parts.filter((part) => part.option === option && part.approved);
      // One candidate per appearance, with all its layers (a part and any skin drawn with it).
      return drawn
        .filter(
          (part, i) =>
            drawn.findIndex((other) =>
              sameAppearance(other, part.age, part.face, part.features ?? DEFAULT_FEATURES),
            ) === i,
        )
        .flatMap((part) => {
          const base = layer.bases.find((candidate) =>
            sameAppearance(candidate, part.age, part.face, part.features ?? DEFAULT_FEATURES),
          );
          const layers = drawn.filter((other) =>
            sameAppearance(other, part.age, part.face, part.features ?? DEFAULT_FEATURES),
          );
          return base
            ? [
                {
                  from: `${page.pageId}/${layer.slotId}/${part.age}/${part.face}`,
                  slotId: layer.slotId,
                  face: part.face,
                  base: base.asset,
                  layers,
                },
              ]
            : [];
        });
    }),
  );
  const approved = yield* Database.query((db) =>
    db
      .select()
      .from(schema.storyPart)
      .where(
        and(
          eq(schema.storyPart.storyVersionId, first.part.storyVersionId),
          eq(schema.storyPart.option, option),
          eq(schema.storyPart.status, "approved"),
        ),
      )
      .orderBy(asc(schema.storyPart.reviewedAt), asc(schema.storyPart.id)),
  );
  const fromGenerated = approved.flatMap((row) => {
    if (generating.has(row.id)) return [];
    const appearance = findAppearance(
      first.decoded,
      row.pageId,
      row.slotId,
      row.age as Age,
      row.face,
      row.features as FeaturesOption | null,
    );
    return "problem" in appearance
      ? []
      : [
          {
            from: row.id,
            slotId: row.slotId,
            face: row.face,
            base: appearance.base.asset,
            layers: (row.layers as ReadonlyArray<StoredLayer> | null) ?? [],
          },
        ];
  });
  const score = (candidate: { slotId: string; face: string }) =>
    (candidate.slotId === first.part.slotId ? 2 : 0) + (candidate.face === first.part.face ? 1 : 0);
  type Candidate = {
    readonly from: string;
    readonly slotId: string;
    readonly face: string;
    readonly base: string;
    readonly layers: ReadonlyArray<{ readonly asset: string; readonly at: Rect }>;
  };
  const best = [...fromManifest, ...fromGenerated]
    .filter((candidate) => candidate.layers.length > 0)
    .reduce<Candidate | null>(
      (chosen, candidate) => (chosen === null || score(candidate) > score(chosen) ? candidate : chosen),
      null,
    );
  if (!best) return null;
  const [base, layers] = yield* Effect.all([
    first.read(best.base),
    Effect.forEach(best.layers, (layer) => first.read(layer.asset).pipe(Effect.map((png) => ({ png, at: layer.at })))),
  ]);
  return { from: best.from, png: yield* Effect.promise(() => referenceImage(base, layers)) };
});

/** Updates the part's row; returns true, since a step's result must be JSON. */
const setPart = (partId: string, patch: Partial<typeof schema.storyPart.$inferInsert>) =>
  Database.query((db) => db.update(schema.storyPart).set(patch).where(eq(schema.storyPart.id, partId))).pipe(
    Effect.as(true),
  );

/** Glasses keep their colours; hair and facial hair are recoloured and reach the figure's silhouette. */
const cutOutOptions = (part: LoadedPart, figure: Uint8Array): CutOutOptions =>
  part.part.axis === "glasses" ? { neutral: false } : { neutral: true, figure };

/** Where a part's edit came from: its own edit, or one tile of a tiled edit (D44). */
interface Edit {
  readonly key: string;
  readonly generationId: string;
  readonly tile?: TilePlacement & { readonly index: number; readonly of: number };
  /** The approved drawing the edit copied: a part ID, or page/role/age/face of a manifest part. */
  readonly reference?: string | null;
}

/**
 * Cuts one part out of its edit, then makes its review images and records it for review. Step names end in
 * `suffix`, so the parts of a tiled edit each get their own.
 */
const finishPart = (
  ctx: TaskContext,
  partId: string,
  suffix: string,
  geometry: { readonly width: number; readonly height: number },
  edit: Edit,
  cutOut: (
    part: LoadedPart,
    base: Uint8Array,
    skinMask: Uint8Array,
    figure: Uint8Array,
    output: Uint8Array,
  ) => Promise<{ readonly layers: ReadonlyArray<PartLayer>; readonly metrics: object }>,
) =>
  Effect.gen(function* () {
    const cut = yield* step(
      ctx,
      `cut-out${suffix}`,
      Effect.gen(function* () {
        const part = yield* loadPart(partId);
        const storage = yield* ObjectStorage;
        const [base, skinMask, figure, output] = yield* Effect.all([
          part.read(part.assets.base),
          part.read(part.base.skinMask),
          part.read(part.base.asset),
          storage.get(edit.key).pipe(Effect.orDie),
        ]);
        const { layers, metrics } = yield* Effect.promise(() => cutOut(part, base, skinMask, figure, output.body));
        const stored: Array<StoredLayer> = [];
        for (const layer of layers) {
          const asset = layer.region === "skin" ? part.assets.skin : part.assets.part;
          yield* part.put(asset, layer.png);
          stored.push({
            asset,
            at: layer.at,
            palette: layer.region === "skin" ? "skin" : part.part.axis !== "glasses" ? "hairColour" : "none",
          });
        }
        return {
          layers: stored,
          metrics: {
            ...metrics,
            ...(edit.tile ? { tile: edit.tile } : {}),
            ...(edit.reference ? { reference: edit.reference } : {}),
          },
        };
      }),
    );
    if (!cut.layers.some((layer) => layer.palette !== "skin")) {
      yield* step(
        ctx,
        `failed${suffix}`,
        setPart(partId, {
          status: "failed",
          error: "the edit added nothing inside the zone",
          generationId: edit.generationId,
          metrics: cut.metrics,
        }),
      );
      return { partId, status: "failed" as const };
    }

    yield* step(
      ctx,
      `review-images${suffix}`,
      Effect.gen(function* () {
        const part = yield* loadPart(partId);
        const { palettes } = yield* decodeStoryVersion(part.manifest, part.publishedAt).pipe(Effect.orDie);
        const skins = byLightness(palettes.skin);
        const hairs = byLightness(palettes.hairColour);
        const [base, skinMask, browMask, layers] = yield* Effect.all([
          part.read(part.base.asset),
          part.read(part.base.skinMask),
          part.base.browMask ? part.read(part.base.browMask) : Effect.succeed(undefined),
          Effect.forEach(cut.layers, (layer) =>
            part.read(layer.asset).pipe(Effect.map((png) => ({ png, at: layer.at, palette: layer.palette }))),
          ),
        ]);
        const inputs = { base, skinMask, ...(browMask ? { browMask } : {}), layers };
        // The lightest skin with the darkest hair, and the darkest skin with the lightest: a band of the base's old
        // skin or a dark fringe left in the layer shows on one of them.
        const light = { skin: palettes.skin[skins[0]!]!, hair: palettes.hairColour[hairs.at(-1)!]! };
        const dark = { skin: palettes.skin[skins.at(-1)!]!, hair: palettes.hairColour[hairs[0]!]! };
        const { width, height } = geometry;
        const [lightPng, darkPng] = yield* Effect.promise(() =>
          Promise.all([composeReview(inputs, light, width, height), composeReview(inputs, dark, width, height)]),
        );
        const sheet = yield* Effect.promise(() =>
          reviewSheet(lightPng, darkPng, layers, part.part.zone as Rect, width, height),
        );
        yield* part.put(part.assets.light, lightPng);
        yield* part.put(part.assets.dark, darkPng);
        yield* part.put(part.assets.sheet, sheet);
        return { light: skins[0]!, dark: skins.at(-1)! };
      }),
    );

    yield* step(
      ctx,
      `record${suffix}`,
      setPart(partId, {
        status: "pending_review",
        layers: cut.layers,
        metrics: cut.metrics,
        generationId: edit.generationId,
        error: null,
      }),
    );
    return { partId, status: "pending_review" as const };
  });

/** One part on its own: the whole base, padded to the provider's size, in one edit. */
const generateOne = (ctx: TaskContext, partId: string) =>
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
        const reference = yield* referenceFor([part]);
        if (reference) yield* part.put(part.assets.reference, reference.png);
        const prompt = partPrompt(part.part.age as Age, part.part.option, part.part.note, reference !== null);
        yield* setPart(partId, { prompt });
        const { base: _, input: __, ...geometry } = base;
        return {
          ...geometry,
          prompt,
          input: part.key(part.assets.input),
          reference: reference ? { from: reference.from, key: part.key(part.assets.reference) } : null,
          edit: part.key(part.assets.edit),
        };
      }),
    );

    const edit = yield* generateImage(ctx, "edit", {
      key: `part:${partId}`,
      prompt: prepared.prompt,
      width: prepared.inputWidth,
      height: prepared.inputHeight,
      references: [prepared.input, ...(prepared.reference ? [prepared.reference.key] : [])],
      outputKey: prepared.edit,
    }).pipe(
      Effect.catchTag("GenerationFailed", (error) =>
        step(
          ctx,
          "failed",
          setPart(partId, { status: "failed", error: error.message, generationId: error.generationId }),
        ).pipe(Effect.as(null)),
      ),
    );
    if (!edit) return [{ partId, status: "failed" as const }];

    return [
      yield* finishPart(
        ctx,
        partId,
        "",
        prepared,
        { ...edit, reference: prepared.reference?.from ?? null },
        (part, base, skinMask, figure, output) =>
          cutOutLayer(
            { base, width: prepared.width, height: prepared.height, padding: prepared.padding },
            output,
            skinMask,
            part.part.zone as Rect,
            cutOutOptions(part, figure),
          ),
      ),
    ];
  });

/**
 * Several parts of one option (D44): each base's head is a tile of a shared edit, four to an image (two for large
 * figures), with room above each head; each tile is cut out against its own base.
 */
const generateTiled = (ctx: TaskContext, partIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const group = `tiles_${createHash("sha256").update(partIds.join(",")).digest("hex").slice(0, 24)}`;
    const prepared = yield* step(
      ctx,
      "prepare",
      Effect.gen(function* () {
        const parts = yield* Effect.forEach(partIds, loadPart);
        const bases = yield* Effect.forEach(parts, (part) =>
          Effect.gen(function* () {
            const [asset, skinMask] = yield* Effect.all([part.read(part.base.asset), part.read(part.base.skinMask)]);
            const base = yield* Effect.promise(() => prepareBase(asset));
            yield* part.put(part.assets.base, base.base);
            const zone = part.part.zone as Rect;
            const top = yield* Effect.promise(() =>
              headTop(skinMask, base.width, base.height, rectToPixels(zone, base.width, base.height)),
            );
            return { base: base.base, width: base.width, height: base.height, zone, headTop: top };
          }),
        );
        const images = yield* Effect.promise(() => tileBases(bases));
        const first = parts[0]!;
        const reference = yield* referenceFor(parts);
        if (reference) yield* first.put(`parts/${group}/reference.png`, reference.png);
        return yield* Effect.forEach(images, (image, k) =>
          Effect.gen(function* () {
            const input = `parts/${group}/input-${k}.png`;
            yield* first.put(input, image.png);
            const prompt = tiledPrompt(image.bases.length, first.part.option, first.part.note, reference !== null);
            yield* Effect.forEach(image.bases, (i) => setPart(partIds[i]!, { prompt }));
            return {
              input: first.key(input),
              reference: reference ? { from: reference.from, key: first.key(`parts/${group}/reference.png`) } : null,
              edit: first.key(`parts/${group}/edit-${k}`),
              width: image.width,
              height: image.height,
              prompt,
              tiles: image.bases.map((i, slot) => ({
                partId: partIds[i]!,
                width: bases[i]!.width,
                height: bases[i]!.height,
                ...image.tiles[slot]!,
              })),
            };
          }),
        );
      }),
    );

    const results: Array<{ readonly partId: string; readonly status: "failed" | "pending_review" }> = [];
    for (const [k, image] of prepared.entries()) {
      const edit = yield* generateImage(ctx, `edit-${k}`, {
        key: `parts:${group}:${k}`,
        prompt: image.prompt,
        width: image.width,
        height: image.height,
        references: [image.input, ...(image.reference ? [image.reference.key] : [])],
        outputKey: image.edit,
      }).pipe(
        Effect.catchTag("GenerationFailed", (error) =>
          step(
            ctx,
            `failed-${k}`,
            Effect.forEach(image.tiles, (tile) =>
              setPart(tile.partId, { status: "failed", error: error.message, generationId: error.generationId }),
            ),
          ).pipe(Effect.as(null)),
        ),
      );
      if (!edit) {
        results.push(...image.tiles.map((tile) => ({ partId: tile.partId, status: "failed" as const })));
        continue;
      }
      for (const [index, tile] of image.tiles.entries()) {
        const placement = { slot: tile.slot, window: tile.window, index, of: image.tiles.length };
        results.push(
          yield* finishPart(
            ctx,
            tile.partId,
            `:${tile.partId}`,
            tile,
            { ...edit, tile: placement, reference: image.reference?.from ?? null },
            (part, base, skinMask, figure, output) =>
              cutOutTile(
                { base, width: tile.width, height: tile.height },
                output,
                placement,
                skinMask,
                part.part.zone as Rect,
                cutOutOptions(part, figure),
              ),
          ),
        );
      }
    }
    return results;
  });

/**
 * Generates parts for appearances (docs/plan.md, "Authoring-time part generation"; D30, D44), in steps a rerun
 * repeats harmlessly (every file's key derives from the part IDs, and each computation is deterministic):
 *
 * 1. `prepare`: each base flattened at working size (the known background), and the image the provider edits: the
 *    base padded to its size for one part, or the parts' heads as tiles of one image (tileBases) for several.
 * 2. `edit`: the provider's in-place edit (generateImage: submit, suspend until done, record with its cost).
 * 3. `cut-out`: align, colour-match, segment, matte, unmix (parts/cutout.ts), and split by region into RGBA layers
 *    placed in the base: the part, and any skin the model drew in it. A tile is cut out against its own base.
 * 4. `review-images`: the layer composed on the lightest and darkest skin of the story's palettes, and a sheet.
 * 5. `record`: the part waits for the illustrator's review.
 *
 * A provider failure or an edit that added nothing in the zone marks the part failed.
 */
export const generatePart = defineTask({
  name: "part.generate",
  params: PartTaskParams,
  run: (params, ctx) => {
    // Tasks spawned before D44 name one part.
    const partIds = "partIds" in params ? params.partIds : [params.partId];
    return partIds.length === 1 ? generateOne(ctx, partIds[0]!) : generateTiled(ctx, partIds);
  },
});
