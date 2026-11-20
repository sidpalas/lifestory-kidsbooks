// The image work behind importing art made outside the app (server-only, sharp): stacking a layered file's layers
// into the plate, foreground and figure; separating a figure from a flat page against the image model's edit with the
// figure removed; taking drawn hair off a figure against its bald edit; and making the base, skin mask, overlay and
// occluder from a coloured figure (figure.ts), with review images on the lightest and darkest skin. Deterministic, so a
// rerun step writes the same bytes.
import sharp from "sharp";
import type { Palette, Rect } from "../book-format/manifest.ts";
import { recolour, rasterize } from "../looks/recolour.ts";
import { alphaBounds, boxSum, colourMatch, cutOutPart, dilate, findShift, neutralize, type PixelRect, type Rgb, shiftImage } from "../parts/cutout.ts";
import { PAPER, type Padding, rectToPixels, toRgb, unpadEdit } from "../parts/images.ts";
import { fillFigureHoles, findSkin, neutralSkin, skinMask, splitFace, tone, toLab } from "./figure.ts";

/** Plates are kept up to this size on the long edge (about 234 ppi on an 8.75 in page); figures up to the parts' working size. */
export const PLATE_SIZE = 2048;
export const FIGURE_SIZE = 1536;

const PAPER_RGB = [PAPER.r / 255, PAPER.g / 255, PAPER.b / 255] as const;

/** An RGBA picture as floats: RGB interleaved and straight (not premultiplied) alpha, both 0..1. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly rgb: Float32Array;
  readonly alpha: Float32Array;
}

const fromRaw = (data: Uint8Array | Buffer, width: number, height: number): Raster => {
  const n = width * height;
  const rgb = new Float32Array(n * 3);
  const alpha = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = data[p * 4 + c]! / 255;
    alpha[p] = data[p * 4 + 3]! / 255;
  }
  return { width, height, rgb, alpha };
};

/** Decodes an image to a Raster, shrunk to fit `maxSize` on its long edge. */
export const readRaster = async (bytes: Uint8Array, maxSize: number, size?: { width: number; height: number }) => {
  const image = (await rasterize(bytes)).resize(size ? { ...size, fit: "fill" } : { width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true });
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return fromRaw(data, info.width, info.height);
};

const toBytes = (rgb: Float32Array, alpha: Float32Array | null, width: number, height: number) => {
  const channels = alpha ? 4 : 3;
  const out = new Uint8Array(width * height * channels);
  for (let p = 0; p < width * height; p++) {
    for (let c = 0; c < 3; c++) out[p * channels + c] = Math.round(rgb[p * 3 + c]! * 255);
    if (alpha) out[p * 4 + 3] = Math.round(alpha[p]! * 255);
  }
  return sharp(out, { raw: { width, height, channels } });
};

export const encodePng = async (rgb: Float32Array, alpha: Float32Array, width: number, height: number) =>
  new Uint8Array(await toBytes(rgb, alpha, width, height).png({ compressionLevel: 6 }).toBuffer());

const encodeJpeg = async (rgb: Float32Array, width: number, height: number) =>
  new Uint8Array(await toBytes(rgb, null, width, height).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer());

/** A mask as the format stores it: white, its alpha the region (D24). */
export const encodeMask = (mask: Float32Array, width: number, height: number) => encodePng(new Float32Array(mask.length * 3).fill(1), mask, width, height);

const cropRaster = (raster: Raster, [x0, y0, x1, y1]: PixelRect): Raster => {
  const width = x1 - x0, height = y1 - y0;
  const rgb = new Float32Array(width * height * 3);
  const alpha = new Float32Array(width * height);
  for (let y = y0; y < y1; y++) {
    rgb.set(raster.rgb.subarray((y * raster.width + x0) * 3, (y * raster.width + x1) * 3), (y - y0) * width * 3);
    alpha.set(raster.alpha.subarray(y * raster.width + x0, y * raster.width + x1), (y - y0) * width);
  }
  return { width, height, rgb, alpha };
};

/** Shrinks a raster to fit `maxSize`, through sharp (which resizes RGBA premultiplied, so edges don't darken). */
const fit = async (raster: Raster, maxSize: number) => {
  if (Math.max(raster.width, raster.height) <= maxSize) return raster;
  const png = await encodePng(raster.rgb, raster.alpha, raster.width, raster.height);
  return readRaster(png, maxSize);
};

/** Resizes one channel (alpha) to `width` × `height`. */
const resizeChannel = async (channel: Float32Array, from: { width: number; height: number }, to: { width: number; height: number }) => {
  if (from.width === to.width && from.height === to.height) return channel;
  const data = await sharp(Uint8Array.from(channel, (v) => Math.round(v * 255)), { raw: { width: from.width, height: from.height, channels: 1 } })
    .resize(to.width, to.height, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  return Float32Array.from(data, (v: number) => v / 255);
};

const resizeRgb = async (image: Rgb, to: { width: number; height: number }): Promise<Rgb> => {
  if (image.width === to.width && image.height === to.height) return image;
  const { data, info } = await toBytes(image.data, null, image.width, image.height)
    .resize(to.width, to.height, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: Float32Array.from(data, (v: number) => v / 255) };
};

/** The figure's place on the page: its pixels' bounds, padded a little and snapped outward to thousandths. */
const boxOf = (alpha: Float32Array, width: number, height: number): Rect | null => {
  const bounds = alphaBounds(Float32Array.from(alpha, (a) => (a > 0.02 ? a : 0)), width, height, Math.round(Math.max(width, height) * 0.01));
  if (!bounds) return null;
  return [
    Math.floor((bounds[0] * 1000) / width),
    Math.floor((bounds[1] * 1000) / height),
    Math.min(1000, Math.ceil((bounds[2] * 1000) / width)),
    Math.min(1000, Math.ceil((bounds[3] * 1000) / height)),
  ];
};

/** How much of a pixel to take from the model's edit: everything under what was removed, fading out over a few pixels. */
const feather = (removed: Float32Array, width: number, height: number) => {
  const r = Math.max(2, Math.round(Math.max(width, height) / 512));
  const grown = dilate(Uint8Array.from(removed, (a) => (a > 0.02 ? 1 : 0)), width, height, r);
  const blurred = boxSum(Float64Array.from(grown), 1, width, height, r);
  const area = (2 * r + 1) ** 2;
  return Float32Array.from(blurred, (s, p) => Math.max(removed[p]!, Math.min(1, (s / area) * 2)));
};

/** Aligns and colour-matches the model's `edit` to `original` outside `zone` (the original's pixels never move). */
const alignTo = (original: Rgb, edit: Rgb, zone: PixelRect) => {
  const shift = findShift(original, colourMatch(original, edit, zone).image, zone);
  return colourMatch(original, shiftImage(edit, shift[0], shift[1]), zone).image;
};

const mix = (a: Float32Array, b: Float32Array, weight: Float32Array) => {
  const out = new Float32Array(a.length);
  for (let p = 0; p < weight.length; p++) for (let c = 0; c < 3; c++) out[p * 3 + c] = a[p * 3 + c]! * (1 - weight[p]!) + b[p * 3 + c]! * weight[p]!;
  return out;
};

/** Colour of a layer with `alpha` drawn over `under`: F = (C − (1 − a)·under) / a, the picture itself where alpha is tiny. */
const unmix = (picture: Float32Array, under: Float32Array | readonly [number, number, number], alpha: Float32Array) => {
  const out = new Float32Array(picture.length);
  for (let p = 0; p < alpha.length; p++) {
    const a = alpha[p]!;
    for (let c = 0; c < 3; c++) {
      const i = p * 3 + c;
      const u = under.length === 3 ? under[c]! : under[i]!;
      out[i] = a > 0.05 ? Math.min(1, Math.max(0, (picture[i]! - (1 - a) * u) / a)) : picture[i]!;
    }
  }
  return out;
};

export interface Separated {
  readonly plate: Uint8Array;
  readonly foreground: Uint8Array | null;
  /** The figure's box on the page, in thousandths. */
  readonly box: Rect;
  /** Each as an RGBA PNG on the box's canvas. */
  readonly figure: Uint8Array;
  readonly hair: Uint8Array | null;
  readonly overlay: Uint8Array | null;
  readonly occluder: Uint8Array | null;
  readonly notes: ReadonlyArray<string>;
}

/**
 * A layered file's layers (bottom to top, full-canvas PNGs, each with its use) stacked into the plate (flattened,
 * JPEG), the foreground, and the figure's own layers cropped to its box: the figure itself, its hair, its blush and
 * lips, and what's in front of its face.
 */
export const stackLayers = async (layers: ReadonlyArray<{ readonly png: Uint8Array; readonly use: string; readonly name: string }>): Promise<Separated | { error: string }> => {
  const used = layers.filter((layer) => layer.use !== "ignore");
  const plates = used.filter((layer) => layer.use === "plate");
  if (plates.length === 0) return { error: "Mark at least one layer as the plate (the scene behind the character)." };
  if (!used.some((layer) => layer.use === "figure")) return { error: "Mark the character's layer (or layers) as the figure." };
  const first = await sharp(plates[0]!.png).metadata();
  const scale = Math.min(1, PLATE_SIZE / Math.max(first.width!, first.height!));
  const size = { width: Math.round(first.width! * scale), height: Math.round(first.height! * scale) };
  const notes: Array<string> = [];
  const stack = async (use: string) => {
    const group = used.filter((layer) => layer.use === use);
    if (group.length === 0) return null;
    const inputs = await Promise.all(group.map(async (layer) => ({ input: await sharp(layer.png).resize(size.width, size.height, { fit: "fill" }).png().toBuffer() })));
    const png = await sharp({ create: { ...size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(inputs).png().toBuffer();
    return readRaster(new Uint8Array(png), PLATE_SIZE);
  };
  for (const layer of used) {
    const meta = await sharp(layer.png).metadata();
    if (Math.abs(meta.width! / meta.height! - first.width! / first.height!) > 0.01) notes.push(`${layer.name}: a different size from the plate; stretched to fit.`);
  }
  const [plate, foreground, figure, hair, overlay, occluder] = await Promise.all([stack("plate"), stack("foreground"), stack("figure"), stack("hair"), stack("overlay"), stack("occluder")]);
  const union = new Float32Array(size.width * size.height);
  for (const part of [figure, hair, overlay, occluder]) if (part) for (let p = 0; p < union.length; p++) union[p] = Math.max(union[p]!, part.alpha[p]!);
  const box = boxOf(union, size.width, size.height);
  if (!box) return { error: "The figure's layers are empty." };
  const rect = rectToPixels(box, size.width, size.height);
  const crop = async (raster: Raster | null) => {
    if (!raster) return null;
    const cropped = await fit(cropRaster(raster, rect), FIGURE_SIZE);
    return encodePng(cropped.rgb, cropped.alpha, cropped.width, cropped.height);
  };
  const plateRgb = new Float32Array(plate!.rgb.length);
  for (let p = 0; p < plate!.alpha.length; p++) for (let c = 0; c < 3; c++) plateRgb[p * 3 + c] = plate!.alpha[p]! * plate!.rgb[p * 3 + c]! + (1 - plate!.alpha[p]!);
  return {
    plate: await encodeJpeg(plateRgb, size.width, size.height),
    foreground: foreground ? await encodePng(foreground.rgb, foreground.alpha, size.width, size.height) : null,
    box,
    figure: (await crop(figure))!,
    hair: await crop(hair),
    overlay: await crop(overlay),
    occluder: await crop(occluder),
    notes,
  };
};

/** The geometry prepareBase recorded for an input, to undo its padding. */
export interface Prepared {
  readonly width: number;
  readonly height: number;
  readonly padding: Padding;
}

/**
 * Separates the character inside `box` from a flat page, given the model's `edit` of the page with the character
 * removed (D30's provider; matting as in D36, with the edit as the known background). The plate keeps the page's own
 * pixels everywhere but under the character, where the edit fills in; the figure is unmixed against that fill.
 */
export const separateFlat = async (page: Uint8Array, prepared: Prepared & { readonly base: Uint8Array }, edit: Uint8Array, box: Rect, removalBox?: Rect) => {
  const original = await toRgb(sharp(prepared.base));
  const { width, height } = original;
  const zoneRect: Rect = [Math.max(0, box[0] - 15), Math.max(0, box[1] - 15), Math.min(1000, box[2] + 15), Math.min(1000, box[3] + 15)];
  const zone = rectToPixels(zoneRect, width, height);
  const alignmentBox: Rect = removalBox ? [Math.max(0, removalBox[0] - 15), Math.max(0, removalBox[1] - 15), Math.min(1000, removalBox[2] + 15), Math.min(1000, removalBox[3] + 15)] : zoneRect;
  const aligned = alignTo(original, await unpadEdit(edit, prepared.padding, width, height), rectToPixels(alignmentBox, width, height));
  // A shared edit removed other people too. They are not unchanged calibration pixels, and must not become
  // part of this figure's cut-out. Match outside the whole cast, then restore the original outside this zone.
  if (removalBox) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= zone[0] && x < zone[2] && y >= zone[1] && y < zone[3]) continue;
    const p = (y * width + x) * 3;
    aligned.data.set(original.data.subarray(p, p + 3), p);
  }
  const cut = cutOutPart(aligned, original, zone);
  const alpha = fillFigureHoles(cut.alpha, width, height);

  const full = await readRaster(page, PLATE_SIZE);
  const fullSize = { width: full.width, height: full.height };
  const alphaFull = await resizeChannel(alpha, { width, height }, fullSize);
  const behind = (await resizeRgb(aligned, fullSize)).data;
  const plate = mix(full.rgb, behind, feather(alphaFull, full.width, full.height));
  const figure = { ...full, rgb: unmix(full.rgb, behind, alphaFull), alpha: alphaFull };
  const figureBox = boxOf(alphaFull, full.width, full.height);
  if (!figureBox) return { error: "Nothing changed inside the box: the model didn't remove the character. Try another attempt, or describe them differently." } as const;
  const cropped = await fit(cropRaster(figure, rectToPixels(figureBox, full.width, full.height)), FIGURE_SIZE);
  return {
    plate: await encodeJpeg(plate, full.width, full.height),
    box: figureBox,
    figure: await encodePng(cropped.rgb, cropped.alpha, cropped.width, cropped.height),
    metrics: cut.metrics,
  } as const;
};

/** Where the figure's paper shows through: how far a colour is from the paper it was drawn on. */
const paperDistance = (rgb: Float32Array, p: number) =>
  Math.max(Math.abs(rgb[p * 3]! - PAPER_RGB[0]), Math.abs(rgb[p * 3 + 1]! - PAPER_RGB[1]), Math.abs(rgb[p * 3 + 2]! - PAPER_RGB[2]));

/** An RGBA layer cropped to its pixels and where it sits in its canvas, in thousandths. */
const encodeCrop = async (rgb: Float32Array, alpha: Float32Array, width: number, height: number) => {
  const bounds = alphaBounds(Float32Array.from(alpha, (a) => (a > 0.02 ? a : 0)), width, height);
  if (!bounds) return null;
  const at: Rect = [
    Math.floor((bounds[0] * 1000) / width),
    Math.floor((bounds[1] * 1000) / height),
    Math.min(1000, Math.ceil((bounds[2] * 1000) / width)),
    Math.min(1000, Math.ceil((bounds[3] * 1000) / height)),
  ];
  const cropped = cropRaster({ width, height, rgb, alpha }, rectToPixels(at, width, height));
  return { png: await encodePng(cropped.rgb, cropped.alpha, cropped.width, cropped.height), at };
};

/**
 * Takes the drawn hair off a figure, given the model's bald `edit` of it: the hair is matted against the bald head
 * within `zone` (thousandths of the figure) and becomes a part in neutral tones for the hair palette (D36); the bald
 * figure keeps the author's pixels except under the hair.
 */
export const takeOffHair = async (figure: Uint8Array, prepared: Prepared & { readonly base: Uint8Array }, edit: Uint8Array, zone: Rect) => {
  const original = await toRgb(sharp(prepared.base));
  const { width, height } = original;
  const zonePx = rectToPixels(zone, width, height);
  const bald = alignTo(original, await unpadEdit(edit, prepared.padding, width, height), zonePx);
  const cut = cutOutPart(bald, original, zonePx);
  const figureAlpha = (await readRaster(figure, FIGURE_SIZE, { width, height })).alpha;
  const under = feather(cut.alpha, width, height);
  const rgb = mix(original.data, bald.data, under);
  // Where hair stood out against the paper, the bald figure has paper there: not part of it.
  const alpha = Float32Array.from(figureAlpha, (a, p) => a * (1 - under[p]!) + under[p]! * Math.min(1, paperDistance(bald.data, p) / 0.1));
  const hair = await encodeCrop(neutralize(cut.colour, cut.alpha), cut.alpha, width, height);
  return {
    colourFigure: await encodePng(unmix(rgb, PAPER_RGB, alpha), alpha, width, height),
    hair,
    metrics: cut.metrics,
  };
};

/** A figure the model drew on paper (another face type), matted off the paper. */
export const figureOffPaper = async (prepared: Prepared, edit: Uint8Array) => {
  const { width, height } = prepared;
  const drawn = await unpadEdit(edit, prepared.padding, width, height);
  // The paper as the model returned it: the median of the picture's border.
  const border: Array<Array<number>> = [[], [], []];
  for (let x = 0; x < width; x++) for (const y of [0, height - 1]) for (let c = 0; c < 3; c++) border[c]!.push(drawn.data[(y * width + x) * 3 + c]!);
  for (let y = 0; y < height; y++) for (const x of [0, width - 1]) for (let c = 0; c < 3; c++) border[c]!.push(drawn.data[(y * width + x) * 3 + c]!);
  const paper = border.map((values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!) as [number, number, number];
  const background: Rgb = { width, height, data: new Float32Array(width * height * 3).map((_, i) => paper[i % 3]!) };
  const cut = cutOutPart(background, drawn, [0, 0, width, height]);
  const alpha = fillFigureHoles(cut.alpha, width, height);
  return encodePng(unmix(drawn.data, paper, alpha), alpha, width, height);
};

export interface FigureFiles {
  readonly base: Uint8Array;
  readonly skinMask: Uint8Array;
  readonly overlay: Uint8Array | null;
  readonly occluder: { readonly asset: Uint8Array; readonly skinMask: Uint8Array } | null;
  /** The coloured figure with its skin mask tinted, for review. */
  readonly maskReview: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly notes: ReadonlyArray<string>;
}

/**
 * A base from a coloured, bald figure (figure.ts): the skin found by colour and masked with the features it encloses
 * and its outline, blush and lips into the overlay (or the author's own overlay layer, as drawn), the skin in neutral
 * tones; an occluder gets its own skin mask from the same skin colour.
 */
export const makeBase = async (
  colourFigure: Uint8Array,
  layers: { readonly overlay: Uint8Array | null; readonly occluder: Uint8Array | null },
): Promise<FigureFiles | { error: string }> => {
  const figure = await readRaster(colourFigure, FIGURE_SIZE);
  const { width, height } = figure;
  const scale = Math.max(width, height) / 1024;
  const lab = toLab(figure.rgb);
  const model = findSkin(lab, figure.alpha, width);
  if (!model) return { error: "No skin colour found on the figure. Upload its skin mask instead." };
  const mask = skinMask(lab, figure.alpha, width, height, model, scale);
  const notes: Array<string> = [];
  let overlay: Uint8Array | null = null;
  let skinTone: Float32Array = Float32Array.from(figure.alpha, (_, p) => tone(figure.rgb, p));
  if (layers.overlay) {
    overlay = new Uint8Array(await sharp(layers.overlay).resize(width, height, { fit: "fill" }).png().toBuffer());
  } else {
    const split = splitFace(figure.rgb, lab, mask, width, height, model, scale);
    skinTone = split.skinTone;
    const overlayAlpha = Float32Array.from(split.overlayAlpha, (o, p) => o * figure.alpha[p]!);
    const covered = overlayAlpha.reduce((sum, o) => sum + (o > 0.1 ? 1 : 0), 0);
    if (covered > 0) overlay = await encodePng(split.overlayColour, overlayAlpha, width, height);
    if (covered > 0.06 * mask.reduce((sum, m) => sum + (m > 0.5 ? 1 : 0), 0)) notes.push("A lot of the skin went to the overlay: check the review on dark skin.");
  }
  const neutral = neutralSkin(figure.rgb, mask, skinTone);
  let occluder: FigureFiles["occluder"] = null;
  if (layers.occluder) {
    const front = await readRaster(layers.occluder, FIGURE_SIZE, { width, height });
    const frontLab = toLab(front.rgb);
    const frontMask = skinMask(frontLab, front.alpha, width, height, model, scale);
    const frontTone = Float32Array.from(front.alpha, (_, p) => tone(front.rgb, p));
    const frontNeutral = neutralSkin(front.rgb, frontMask, frontTone, { median: neutral.median });
    occluder = { asset: await encodePng(frontNeutral.rgb, front.alpha, width, height), skinMask: await encodeMask(frontMask, width, height) };
  }
  // Review: the figure in its colours on white, with the skin mask tinted red.
  const tinted = new Float32Array(figure.rgb.length);
  for (let p = 0; p < mask.length; p++) {
    const a = figure.alpha[p]!;
    const t = mask[p]! * 0.5;
    const tintColour = [0.9, 0.15, 0.1];
    for (let c = 0; c < 3; c++) tinted[p * 3 + c] = (figure.rgb[p * 3 + c]! * (1 - t) + tintColour[c]! * t) * a + (1 - a);
  }
  return {
    base: await encodePng(neutral.rgb, figure.alpha, width, height),
    skinMask: await encodeMask(mask, width, height),
    overlay,
    occluder,
    maskReview: await encodePng(tinted, new Float32Array(mask.length).fill(1), width, height),
    width,
    height,
    notes,
  };
};

export interface ReviewFigure {
  readonly base: Uint8Array;
  readonly skinMask: Uint8Array;
  readonly overlay: Uint8Array | null;
  readonly parts: ReadonlyArray<{ readonly png: Uint8Array; readonly at: Rect; readonly palette: "skin" | "hairColour" | "none" }>;
  readonly occluder: { readonly asset: Uint8Array; readonly skinMask?: Uint8Array } | null;
}

/** The figure as a book composes it, on transparency so the same review can be placed back into its scene. */
export const composeForReview = async (figure: ReviewFigure, look: { readonly skin: Palette; readonly hair: Palette }, width: number, height: number) => {
  const sized = async (png: Uint8Array, rect: Rect = [0, 0, 1000, 1000]) => {
    const [x0, y0, x1, y1] = rectToPixels(rect, width, height);
    return { input: await sharp(png).resize(x1 - x0, y1 - y0, { fit: "fill" }).png().toBuffer(), left: x0, top: y0 };
  };
  const layers = [
    await sized(await recolour(figure.base, [{ mask: figure.skinMask, palette: look.skin }])),
    ...(figure.overlay ? [await sized(figure.overlay)] : []),
    ...(await Promise.all(
      figure.parts.map(async (part) =>
        sized(part.palette === "none" ? part.png : await recolour(part.png, [{ palette: part.palette === "skin" ? look.skin : look.hair }]), part.at),
      ),
    )),
    ...(figure.occluder ? [await sized(figure.occluder.skinMask ? await recolour(figure.occluder.asset, [{ mask: figure.occluder.skinMask, palette: look.skin }]) : figure.occluder.asset)] : []),
  ];
  const png = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
  return new Uint8Array(png);
};

/** An author's own hair layer (on the figure's canvas) as a part: neutral tones for the hair palette (D36), cropped. */
export const hairLayerPart = async (png: Uint8Array) => {
  const layer = await readRaster(png, FIGURE_SIZE);
  return encodeCrop(neutralize(layer.rgb, layer.alpha), layer.alpha, layer.width, layer.height);
};
