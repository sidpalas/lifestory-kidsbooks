// `page.import`: turns art made outside the app into one page's layers for one role (docs: the "Story art import
// design" in thread T-01a1f4cb-9c6d-7743-8aea-3999570d90f1). A layered file is stacked by use; a flat page goes
// through the image model twice (the character removed, then made bald) with the cut-out of D36 against each edit;
// the bald figure becomes a base with its skin mask and overlay; the result is shown on the lightest and darkest
// skin. Nothing goes into the draft until the author applies it. Every file's key derives from the task ID and every
// step is deterministic, so a rerun writes the same bytes.
import { schema } from "@lifestory/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { decodeStoryDraft, storyAssetKey } from "../book-format/index.ts";
import type { FigureBase, Part, Rect } from "../book-format/manifest.ts";
import { Database } from "../database.ts";
import { generateImage, Generations } from "../generations.ts";
import { defineTask, step } from "../jobs.ts";
import { byLightness, prepareBase } from "../parts/images.ts";
import { ObjectStorage } from "../storage.ts";
import { ArtImportRequest, type ImportResult } from "./contract.ts";
import { composeForReview, figureOffPaper, hairLayerPart, makeBase, separateFlat, stackLayers, takeOffHair } from "./images.ts";

export const ImportTaskParams = Schema.Struct({ storyId: Schema.String, version: Schema.Number, request: ArtImportRequest });

/** What the task ends with: the result for the author to review, or a problem they can fix. */
export type ImportOutcome = { readonly result: ImportResult } | { readonly storyId: string; readonly error: string };

/** "from 30% to 60% across and 20% to 90% down" for a rect in thousandths of the base, placed in the padded input. */
const area = (rect: Rect, prepared: { width: number; height: number; padding: { left: number; top: number; paddedWidth: number; paddedHeight: number } }) => {
  const { padding } = prepared;
  const x = (v: number) => Math.round(((padding.left + (v * prepared.width) / 1000) / padding.paddedWidth) * 100);
  const y = (v: number) => Math.round(((padding.top + (v * prepared.height) / 1000) / padding.paddedHeight) * 100);
  return `from ${x(rect[0])}% to ${x(rect[2])}% across and ${y(rect[1])}% to ${y(rect[3])}% down`;
};

const KEEP = "drawn in exactly the same illustration style, medium, line and texture. Change nothing else: keep every other part of the picture exactly as it is.";

export const removePrompt = (description: string, where: string) =>
  `Remove ${description} from this picture completely and paint what was behind them, so the scene continues naturally, ${KEEP} They are in the area ${where}.`;

export const baldPrompt = (where: string) =>
  `Make the character in this picture completely bald: no hair at all, a smooth bare scalp with the ears showing, in the same skin colour, ${KEEP} Keep the face, eyebrows, expression, body, clothes and pose. The hair is in the area ${where}.`;

const faceWords: Record<string, string> = {
  "face:round": "a round face with full cheeks and a soft jaw",
  "face:oval": "a narrow oval face with high cheekbones and a pointed chin",
};

export const derivePrompt = (face: string) =>
  `Redraw this same character with ${faceWords[face] ?? face}: still completely bald, the same age, skin colour, expression, pose, clothes, colours, size and framing, on the same plain paper, ${KEEP.split(".")[0]}.`;

export const importTask = defineTask({
  name: "page.import",
  params: ImportTaskParams,
  run: ({ storyId, version, request }, ctx) =>
    Effect.gen(function* () {
      const id = createHash("sha256").update(ctx.taskID).digest("hex").slice(0, 10);
      const folder = `pages/${request.pageId}/${request.slotId}`;
      const asset = (name: string, extension = "png") => `${folder}/import-${id}-${name}.${extension}`;
      const key = (path: string) => storyAssetKey(storyId, version, path);
      const read = (path: string) => ObjectStorage.use((storage) => storage.get(key(path))).pipe(Effect.map((object) => object.body), Effect.orDie);
      const write = (path: string, body: Uint8Array, type = "image/png") => ObjectStorage.use((storage) => storage.put(key(path), body, type)).pipe(Effect.orDie);
      const fail = (error: string): ImportOutcome => ({ storyId, error });
      const generations: Array<string> = [];

      // 1. The figure in colour, with its box, the page's art, and the author's own hair, overlay and occluder layers.
      type Stage = { readonly error: string } | {
        readonly plate: string | null;
        readonly foreground: string | null;
        readonly box: Rect | null;
        readonly figure: string;
        readonly hair: string | null;
        readonly overlay: string | null;
        readonly occluder: string | null;
        readonly notes: ReadonlyArray<string>;
      };
      let stage: Stage;
      if (request.kind === "derive") {
        const prepared = yield* step(ctx, "prepare-derive", Effect.gen(function* () {
          const from = yield* read(request.from);
          const base = yield* Effect.promise(() => prepareBase(from));
          yield* write(asset("derive-input"), base.input);
          const { base: _, input: __, ...geometry } = base;
          return geometry;
        }));
        const edit = yield* generateImage(ctx, "derive", {
          key: `import:${ctx.taskID}:derive`,
          prompt: derivePrompt(request.face),
          width: prepared.inputWidth,
          height: prepared.inputHeight,
          references: [key(asset("derive-input"))],
          outputKey: key(`${folder}/import-${id}-derive-edit`),
        }).pipe(Effect.catchTag("GenerationFailed", (error) => Effect.succeed({ failed: error.message } as const)));
        if ("failed" in edit) return fail(`The image model couldn't draw it: ${edit.failed}`);
        generations.push(edit.generationId);
        stage = yield* step(ctx, "off-paper", Effect.gen(function* () {
          const body = yield* ObjectStorage.use((storage) => storage.get(edit.key)).pipe(Effect.orDie);
          yield* write(asset("figure"), yield* Effect.promise(() => figureOffPaper(prepared, body.body)));
          return { plate: null, foreground: null, box: null, figure: asset("figure"), hair: null, overlay: null, occluder: null, notes: [] };
        }));
      } else if (request.source.kind === "layers") {
        const layers = request.source.layers;
        stage = yield* step(ctx, "stack", Effect.gen(function* () {
          const pngs = yield* Effect.forEach(layers, (layer) => (layer.use === "ignore" ? Effect.succeed(new Uint8Array()) : read(layer.asset)));
          const stacked = yield* Effect.promise(() => stackLayers(layers.map((layer, i) => ({ png: pngs[i]!, use: layer.use, name: layer.name }))));
          if ("error" in stacked) return { error: stacked.error };
          yield* write(asset("plate", "jpg"), stacked.plate, "image/jpeg");
          if (stacked.foreground) yield* write(asset("foreground"), stacked.foreground);
          yield* write(asset("colour"), stacked.figure);
          for (const [name, body] of [["hair-layer", stacked.hair], ["overlay", stacked.overlay], ["occluder-layer", stacked.occluder]] as const) if (body) yield* write(asset(name), body);
          return {
            plate: asset("plate", "jpg"),
            foreground: stacked.foreground ? asset("foreground") : null,
            box: stacked.box,
            figure: asset("colour"),
            hair: stacked.hair ? asset("hair-layer") : null,
            overlay: stacked.overlay ? asset("overlay") : null,
            occluder: stacked.occluder ? asset("occluder-layer") : null,
            notes: stacked.notes,
          };
        }));
      } else {
        const source = request.source;
        const prepared = yield* step(ctx, "prepare-page", Effect.gen(function* () {
          const page = yield* read(source.asset);
          const base = yield* Effect.promise(() => prepareBase(page));
          yield* write(asset("page-base"), base.base);
          yield* write(asset("page-input"), base.input);
          const { base: _, input: __, ...geometry } = base;
          return geometry;
        }));
        const edit = yield* generateImage(ctx, "remove", {
          key: `import:${ctx.taskID}:remove`,
          prompt: removePrompt(source.description, area(source.box, prepared)),
          width: prepared.inputWidth,
          height: prepared.inputHeight,
          references: [key(asset("page-input"))],
          outputKey: key(`${folder}/import-${id}-remove-edit`),
        }).pipe(Effect.catchTag("GenerationFailed", (error) => Effect.succeed({ failed: error.message } as const)));
        if ("failed" in edit) return fail(`The image model couldn't remove the character: ${edit.failed}`);
        generations.push(edit.generationId);
        stage = yield* step(ctx, "separate", Effect.gen(function* () {
          const [page, base, removed] = yield* Effect.all([read(source.asset), read(asset("page-base")), ObjectStorage.use((s) => s.get(edit.key)).pipe(Effect.orDie)]);
          const separated = yield* Effect.promise(() => separateFlat(page, { ...prepared, base }, removed.body, source.box));
          if ("error" in separated) return { error: separated.error ?? "" };
          yield* write(asset("plate", "jpg"), separated.plate, "image/jpeg");
          yield* write(asset("colour"), separated.figure);
          return { plate: asset("plate", "jpg"), foreground: null, box: separated.box, figure: asset("colour"), hair: null, overlay: null, occluder: null, notes: [] };
        }));
      }
      if ("error" in stage) return fail(stage.error);
      const separated = stage;

      // 2. The bald figure: drawn bald, the author's hair layer as the part, or the hair taken off against a bald edit.
      let colourFigure = separated.figure;
      let hair: { readonly asset: string; readonly at: Rect } | null = null;
      if (request.kind === "page" && !request.bald) {
        if (separated.hair) {
          const hairLayer = separated.hair;
          hair = yield* step(ctx, "hair-layer", Effect.gen(function* () {
            const layer = yield* read(hairLayer);
            const part = yield* Effect.promise(() => hairLayerPart(layer));
            if (!part) return null;
            yield* write(asset("hair"), part.png);
            return { asset: asset("hair"), at: part.at };
          }));
        } else {
          const prepared = yield* step(ctx, "prepare-figure", Effect.gen(function* () {
            const figure = yield* read(separated.figure);
            const base = yield* Effect.promise(() => prepareBase(figure));
            yield* write(asset("figure-base"), base.base);
            yield* write(asset("figure-input"), base.input);
            const { base: _, input: __, ...geometry } = base;
            return geometry;
          }));
          const edit = yield* generateImage(ctx, "bald", {
            key: `import:${ctx.taskID}:bald`,
            prompt: baldPrompt(area(request.hairZone, prepared)),
            width: prepared.inputWidth,
            height: prepared.inputHeight,
            references: [key(asset("figure-input"))],
            outputKey: key(`${folder}/import-${id}-bald-edit`),
          }).pipe(Effect.catchTag("GenerationFailed", (error) => Effect.succeed({ failed: error.message } as const)));
          if ("failed" in edit) return fail(`The image model couldn't take the hair off: ${edit.failed}`);
          generations.push(edit.generationId);
          const zone = request.hairZone;
          const taken = yield* step(ctx, "take-off-hair", Effect.gen(function* () {
            const [figure, base, bald] = yield* Effect.all([read(separated.figure), read(asset("figure-base")), ObjectStorage.use((s) => s.get(edit.key)).pipe(Effect.orDie)]);
            const out = yield* Effect.promise(() => takeOffHair(figure, { ...prepared, base }, bald.body, zone));
            yield* write(asset("bald"), out.colourFigure);
            if (out.hair) yield* write(asset("hair"), out.hair.png);
            return { hair: out.hair ? { asset: asset("hair"), at: out.hair.at } : null };
          }));
          colourFigure = asset("bald");
          hair = taken.hair;
        }
        if (request.hair === null) hair = null;
      }

      // 3. The base, its skin mask and overlay, and the occluder.
      const made = yield* step(ctx, "base", Effect.gen(function* () {
        const figure = yield* read(colourFigure);
        const overlay = separated.overlay ? yield* read(separated.overlay) : null;
        const occluder = separated.occluder ? yield* read(separated.occluder) : null;
        const files = yield* Effect.promise(() => makeBase(figure, { overlay, occluder }));
        if ("error" in files) return { error: files.error } as const;
        yield* write(asset("base"), files.base);
        yield* write(asset("skin"), files.skinMask);
        yield* write(asset("mask-review"), files.maskReview);
        if (files.overlay) yield* write(asset("face"), files.overlay);
        if (files.occluder) {
          yield* write(asset("occluder"), files.occluder.asset);
          yield* write(asset("occluder-skin"), files.occluder.skinMask);
        }
        const base: FigureBase = {
          age: request.age,
          face: request.face,
          asset: asset("base"),
          skinMask: asset("skin"),
          ...(files.overlay ? { overlay: asset("face") } : {}),
          ...(files.occluder ? { occluder: { asset: asset("occluder"), skinMask: asset("occluder-skin") } } : {}),
        };
        return { base, width: files.width, height: files.height, notes: files.notes };
      }));
      if ("error" in made) return fail(made.error ?? "");

      const parts: ReadonlyArray<Part> =
        request.kind === "page" && request.hair && hair
          ? [{ age: request.age, face: request.face, axis: "hair", option: request.hair, asset: hair.asset, at: hair.at, palette: "hairColour", approved: false }]
          : [];

      // 4. Review: the figure as a book composes it, on the lightest skin with the darkest hair and the reverse.
      yield* step(ctx, "review", Effect.gen(function* () {
        const [row] = yield* Database.query((db) =>
          db.select({ manifest: schema.storyVersion.manifest }).from(schema.storyVersion).where(and(eq(schema.storyVersion.storyId, storyId), eq(schema.storyVersion.version, version))),
        );
        const { palettes } = yield* decodeStoryDraft(row?.manifest).pipe(Effect.orDie);
        const skins = byLightness(palettes.skin);
        const hairs = byLightness(palettes.hairColour);
        const figure = {
          base: yield* read(made.base.asset),
          skinMask: yield* read(made.base.skinMask),
          overlay: made.base.overlay ? yield* read(made.base.overlay) : null,
          parts: yield* Effect.forEach(parts, (part) => read(part.asset).pipe(Effect.map((png) => ({ png, at: part.at, palette: part.palette })))),
          occluder: made.base.occluder ? { asset: yield* read(made.base.occluder.asset), skinMask: yield* read(made.base.occluder.skinMask!) } : null,
        };
        const looks = [
          { skin: palettes.skin[skins[0]!]!, hair: palettes.hairColour[hairs.at(-1)!]! },
          { skin: palettes.skin[skins.at(-1)!]!, hair: palettes.hairColour[hairs[0]!]! },
        ];
        const [light, dark] = yield* Effect.promise(() => Promise.all(looks.map((look) => composeForReview(figure, look, made.width, made.height))));
        yield* write(asset("light"), light!);
        yield* write(asset("dark"), dark!);
        return true;
      }));

      const cost = yield* step(ctx, "cost", Effect.gen(function* () {
        const rows = yield* Effect.forEach(generations, (generationId) => Generations.use((g) => g.get(generationId)));
        return rows.reduce((sum, row) => sum + (row._tag === "Some" ? (row.value.costUsd ?? 0) : 0), 0);
      }));

      const result: ImportResult = {
        storyId,
        request,
        plate: separated.plate,
        foreground: separated.foreground,
        box: separated.box,
        base: made.base,
        parts,
        colourFigure,
        review: { light: asset("light"), dark: asset("dark"), mask: asset("mask-review"), plate: separated.plate },
        costUsd: Math.round(cost * 1e4) / 1e4,
        notes: [...separated.notes, ...made.notes],
      };
      return { result } satisfies ImportOutcome;
    }),
});
