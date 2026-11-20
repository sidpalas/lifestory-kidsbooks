// What the authoring UI sends and gets back when it imports art made outside the app (browser-safe; exported from
// contracts.ts). An import turns one page's art into the book format's layers for one role: the plate and
// foreground, and the figure's box, base, skin mask, overlay, occluder, and the hair it was drawn with as a part.
// The author reviews the result and applies it to the draft; nothing is saved until they do.
import { Schema } from "effect";

import { FigureBase, type FigureLayer, type Page, Part, Rect } from "../book-format/manifest.ts";
import { Age, FaceOption, HairOption } from "../looks/vocabulary.ts";

/** What one layer of a layered file is for. Layers are listed bottom to top, each a PNG on the page's whole canvas. */
export const LayerUse = Schema.Literals(["plate", "foreground", "figure", "hair", "overlay", "occluder", "ignore"]);
export type LayerUse = typeof LayerUse.Type;

export const ImportSource = Schema.Union([
  /** A layered file (PSD, read in the browser) or a set of PNG layers, uploaded as full-canvas PNGs. */
  Schema.Struct({
    kind: Schema.Literal("layers"),
    layers: Schema.Array(Schema.Struct({ asset: Schema.String, name: Schema.String, use: LayerUse })).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(64),
    ),
  }),
  /** One flat picture of the page: the image model removes the character inside `box` and paints what was behind. */
  Schema.Struct({
    kind: Schema.Literal("flat"),
    asset: Schema.String,
    /** Where the character is, in thousandths of the picture. */
    box: Rect,
    /** Who to remove, in words the model understands, such as "the little girl in the yellow raincoat". */
    description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    /** A cast-page extraction shares one removal edit and one final plate across every figure. */
    removed: Schema.optionalKey(Schema.String),
    plate: Schema.optionalKey(Schema.String),
    removalBox: Schema.optionalKey(Rect),
    head: Schema.optionalKey(Rect),
  }),
]);
export type ImportSource = typeof ImportSource.Type;

export const ImportRequest = Schema.Struct({
  kind: Schema.Literal("page"),
  pageId: Schema.String,
  slotId: Schema.String,
  /** The age and face type the author drew; the import becomes that base. */
  age: Age,
  face: FaceOption,
  /**
   * The hairstyle the author drew, which becomes that option's part on this base; null drops the drawn hair (the
   * part pipeline draws every hairstyle). Ignored when `bald`.
   */
  hair: Schema.NullOr(HairOption),
  /** The figure is drawn bald already: no hair to take off. */
  bald: Schema.Boolean,
  /** Where hair may be, in thousandths of the figure: the head, with room for long hair. */
  hairZone: Rect,
  source: ImportSource,
  seed: Schema.Number,
});
export type ImportRequest = typeof ImportRequest.Type;

/** Another face type (or later, age) of an imported figure, drawn by the image model from its coloured bald figure. */
export const DeriveRequest = Schema.Struct({
  kind: Schema.Literal("derive"),
  pageId: Schema.String,
  slotId: Schema.String,
  age: Age,
  face: FaceOption,
  /** The coloured bald figure an earlier import returned (`colourFigure`). */
  from: Schema.String,
  seed: Schema.Number,
});
export type DeriveRequest = typeof DeriveRequest.Type;

export const ArtImportRequest = Schema.Union([ImportRequest, DeriveRequest]);
export type ArtImportRequest = typeof ArtImportRequest.Type;

export const ImportResult = Schema.Struct({
  storyId: Schema.String,
  request: ArtImportRequest,
  /** Art layers for the page (none for a derived base). */
  plate: Schema.NullOr(Schema.String),
  foreground: Schema.NullOr(Schema.String),
  /** The figure's box on the page, in thousandths; a derived base keeps its source's. */
  box: Schema.NullOr(Rect),
  base: FigureBase,
  /** The hair the author drew, as the part for `request.hair`, unapproved until they approve it. */
  parts: Schema.Array(Part),
  /** The bald figure in its own colours, the starting point for other face types. */
  colourFigure: Schema.String,
  /** For review: the figure on the lightest and the darkest skin, and its skin mask tinted over it. */
  review: Schema.Struct({
    light: Schema.String,
    dark: Schema.String,
    mask: Schema.String,
    plate: Schema.NullOr(Schema.String),
  }),
  costUsd: Schema.Number,
  notes: Schema.Array(Schema.String),
});
export type ImportResult = typeof ImportResult.Type;

export const ImportStatus = Schema.Struct({
  taskId: Schema.String,
  state: Schema.Literals(["working", "done", "failed"]),
  result: Schema.NullOr(ImportResult),
  error: Schema.NullOr(Schema.String),
});
export type ImportStatus = typeof ImportStatus.Type;

/**
 * The page with an import applied: its plate replaces the page's first art layer behind the figures (or goes at the
 * bottom), its foreground goes on top, and the role's figure (added above the plate and other figures if the page has
 * none) takes the box, the base for the import's age and face with defined features (replacing one there), and the
 * hair part (replacing the same option's part on that base). A derived base adds only the base.
 */
export const applyImport = (page: Page, result: ImportResult): Page => {
  const { request } = result;
  let layers = [...page.illustration.layers];
  if (result.plate) {
    const firstFigure = layers.findIndex((layer) => layer.kind === "figure");
    const plateAt = layers.findIndex((layer, i) => layer.kind === "art" && (firstFigure === -1 || i < firstFigure));
    if (plateAt === -1) layers.unshift({ kind: "art", asset: result.plate });
    else layers[plateAt] = { kind: "art", asset: result.plate };
  }
  // An import draws defined features (D40: absent means defined), so a softer base of the same age and face stays.
  const sameBase = (candidate: { age: string; face: string; features?: string }) =>
    candidate.age === request.age &&
    candidate.face === request.face &&
    (candidate.features ?? "features:defined") === "features:defined";
  const at = layers.findIndex((layer) => layer.kind === "figure" && layer.slotId === request.slotId);
  const existing = at === -1 ? null : (layers[at] as FigureLayer);
  const figure: FigureLayer = {
    kind: "figure",
    slotId: request.slotId,
    box: result.box ?? existing?.box ?? [350, 300, 650, 900],
    ...(existing?.age ? { age: existing.age } : {}),
    ...(existing?.showsHead !== undefined ? { showsHead: existing.showsHead } : {}),
    ...(existing?.partOrder ? { partOrder: existing.partOrder } : {}),
    bases: [...(existing?.bases ?? []).filter((base) => !sameBase(base)), result.base],
    parts: [
      ...(existing?.parts ?? []).filter(
        (part) =>
          !result.parts.some((added) => sameBase(part) && part.axis === added.axis && part.option === added.option),
      ),
      ...result.parts,
    ],
  };
  if (existing) layers[at] = figure;
  else {
    const lastFigure = layers.findLastIndex((layer) => layer.kind === "figure");
    const plates = layers.findLastIndex((layer, i) => layer.kind === "art" && (lastFigure === -1 || i < lastFigure));
    layers.splice(Math.max(lastFigure, plates) + 1, 0, figure);
  }
  if (result.foreground) layers = [...layers, { kind: "art", asset: result.foreground }];
  return { ...page, illustration: { layers } };
};
