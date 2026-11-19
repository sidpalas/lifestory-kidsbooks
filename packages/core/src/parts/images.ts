// The image files around a part's cut-out (server-only, sharp): the base as the provider sees it, the cut-out of
// the provider's edit into an RGBA layer placed in the base, and the review images on the lightest and darkest skin.
// Every function is deterministic, so a rerun step writes the same bytes.
import sharp, { type Sharp } from "sharp";
import type { Palette, Rect } from "../book-format/manifest.ts";
import { paletteAt, rasterize, recolour } from "../looks/recolour.ts";
import { alphaBounds, cutOutPart, type CutOutMetrics, neutralize, type PixelRect, type Rgb, skinPixels } from "./cutout.ts";

/** The cut-out runs at most at this size; provider outputs are 1536 px at most, so more adds nothing. */
const WORKING_SIZE = 1536;

/** Where a base has no pixels, the provider sees this light neutral, like paper. */
export const PAPER = { r: 243, g: 239, b: 231 };

/** Output sizes the image APIs accept, by aspect (D30: a portrait base is padded to 2:3). */
const providerSize = (width: number, height: number) => {
  const aspect = width / height;
  if (aspect < 0.83) return { width: 1024, height: 1536 };
  if (aspect > 1.2) return { width: 1536, height: 1024 };
  return { width: 1024, height: 1024 };
};

/** How the base sits in the image sent to the provider, to undo it on the way back. */
export interface Padding {
  readonly left: number;
  readonly top: number;
  readonly paddedWidth: number;
  readonly paddedHeight: number;
}

export interface PreparedBase {
  /** The base flattened onto paper at working size: the known background of the matting. */
  readonly base: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** The base padded (edges extended, so the model sees no border) to the provider's size. */
  readonly input: Uint8Array;
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly padding: Padding;
}

export const prepareBase = async (asset: Uint8Array): Promise<PreparedBase> => {
  const raster = await (await rasterize(asset)).png().toBuffer();
  const meta = await sharp(raster).metadata();
  const fit = Math.min(1, WORKING_SIZE / Math.max(meta.width!, meta.height!));
  const width = Math.round(meta.width! * fit);
  const height = Math.round(meta.height! * fit);
  const base = await sharp(raster).resize(width, height, { fit: "fill" }).flatten({ background: PAPER }).png().toBuffer();

  const target = providerSize(width, height);
  const targetAspect = target.width / target.height;
  const paddedWidth = Math.max(width, Math.round(height * targetAspect));
  const paddedHeight = Math.max(height, Math.round(width / targetAspect));
  const left = Math.floor((paddedWidth - width) / 2);
  const top = Math.floor((paddedHeight - height) / 2);
  const padded = await sharp(base)
    .extend({ left, right: paddedWidth - width - left, top, bottom: paddedHeight - height - top, extendWith: "copy" })
    .png()
    .toBuffer();
  const input = await sharp(padded).resize(target.width, target.height, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  return {
    base: new Uint8Array(base),
    width,
    height,
    input: new Uint8Array(input),
    inputWidth: target.width,
    inputHeight: target.height,
    padding: { left, top, paddedWidth, paddedHeight },
  };
};

export const toRgb = async (image: Sharp): Promise<Rgb> => {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: Float32Array.from(data, (v: number) => v / 255) };
};

/** The provider's edit of a padded input, back on the base's working canvas (undoing prepareBase's padding). */
export const unpadEdit = async (edit: Uint8Array, padding: Padding, width: number, height: number) => {
  const unpadded = await sharp(edit)
    .flatten({ background: PAPER })
    .resize(padding.paddedWidth, padding.paddedHeight, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  return toRgb(sharp(unpadded).extract({ left: padding.left, top: padding.top, width, height }));
};

/** A rect in thousandths of a width × height canvas, to pixels. */
export const rectToPixels = ([x0, y0, x1, y1]: Rect, width: number, height: number): PixelRect => [
  Math.round((x0 * width) / 1000),
  Math.round((y0 * height) / 1000),
  Math.round((x1 * width) / 1000),
  Math.round((y1 * height) / 1000),
];

/** Which palette recolours a layer at book time: the axis's own (hair colour, or none for glasses), or skin. */
export type LayerRegion = "part" | "skin";

export interface PartLayer {
  readonly region: LayerRegion;
  /** The RGBA layer, cropped to its pixels. */
  readonly png: Uint8Array;
  /** Where the crop sits in the base, in thousandths. */
  readonly at: Rect;
}

/** One region of a cut-out as a cropped RGBA PNG and its place in the base; null when the region is empty. */
const encodeLayer = async (region: LayerRegion, alpha: Float32Array, colour: Float32Array, width: number, height: number): Promise<PartLayer | null> => {
  const bounds = alphaBounds(alpha, width, height);
  if (!bounds) return null;
  // Snap the crop to the thousandths grid `at` is stored in, so the layer lands where it was cut from.
  const at: Rect = [
    Math.floor((bounds[0] * 1000) / width),
    Math.floor((bounds[1] * 1000) / height),
    Math.min(1000, Math.ceil((bounds[2] * 1000) / width)),
    Math.min(1000, Math.ceil((bounds[3] * 1000) / height)),
  ];
  const [x0, y0, x1, y1] = rectToPixels(at, width, height);
  const rgba = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      const o = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(colour[p * 3 + c]! * 255);
      rgba[o + 3] = Math.round(alpha[p]! * 255);
    }
  }
  const png = await sharp(rgba, { raw: { width: x1 - x0, height: y1 - y0, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return { region, png: new Uint8Array(png), at };
};

/**
 * Cuts the part out of the provider's `edit` of `prepared`'s input: undoes the padding, runs cutOutPart within
 * `zone` (thousandths of the base), and splits the result by region: the part, and any skin the model drew in it,
 * found by the colours under the base's `skinMask`. With `neutral`, the part's colours become the neutral tones its
 * palette recolours (hair); otherwise it keeps the colours drawn (glasses) and leaves out any skin. Skin keeps the
 * base's tones, which the skin palette recolours as it does the base. No layers when the edit added nothing in the zone.
 */
export const cutOutLayer = async (
  prepared: Pick<PreparedBase, "base" | "width" | "height" | "padding">,
  edit: Uint8Array,
  skinMask: Uint8Array,
  zone: Rect,
  options: { readonly neutral: boolean },
): Promise<{ readonly layers: ReadonlyArray<PartLayer>; readonly metrics: CutOutMetrics & { readonly skinPixels: number } }> => {
  const { width, height, padding } = prepared;
  const base = await toRgb(sharp(prepared.base));
  const aligned = await unpadEdit(edit, padding, width, height);
  const { alpha, colour, metrics } = cutOutPart(base, aligned, rectToPixels(zone, width, height));
  const mask = await (await rasterize(skinMask)).resize(width, height, { fit: "fill" }).extractChannel(3).raw().toBuffer();
  // Hair can't carry skin-coloured highlights away as skin, but an accessory has no skin of its own: skin the model
  // redrew under glasses is the base's skin with its eye and nose lines moved, so the base shows there instead.
  const skin = skinPixels(colour, alpha, base, new Uint8Array(mask), Math.max(12, Math.round((40 * Math.max(width, height)) / 1024)), !options.neutral);
  const partAlpha = alpha.map((a, p) => (skin[p] ? 0 : a));
  const skinAlpha = options.neutral ? alpha.map((a, p) => (skin[p] ? a : 0)) : new Float32Array(alpha.length);
  const layers = await Promise.all([
    encodeLayer("part", partAlpha, options.neutral ? neutralize(colour, partAlpha) : colour, width, height),
    encodeLayer("skin", skinAlpha, colour, width, height),
  ]);
  return {
    layers: layers.filter((layer): layer is PartLayer => layer !== null),
    metrics: { ...metrics, skinPixels: skin.reduce((sum, v) => sum + v, 0) },
  };
};

const luminance = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Palette IDs ordered from the lightest to the darkest, by their colour across the mid and light tones. */
export const byLightness = (palettes: Readonly<Record<string, Palette>>) =>
  Object.entries(palettes)
    .map(([id, palette]) => ({ id, lightness: [0.4, 0.5, 0.6, 0.7, 0.8].reduce((sum, t) => sum + luminance(paletteAt(palette, t)), 0) }))
    .toSorted((a, b) => b.lightness - a.lightness)
    .map((entry) => entry.id);

export interface ReviewInputs {
  /** The illustrator's base and its masks, as stored. */
  readonly base: Uint8Array;
  readonly skinMask: Uint8Array;
  readonly browMask?: Uint8Array;
  /** The part's layers, bottom to top, with the palette that recolours each. */
  readonly layers: ReadonlyArray<{ readonly png: Uint8Array; readonly at: Rect; readonly palette: "skin" | "hairColour" | "none" }>;
}

/** One look for a review image: a skin palette, and the hair colour for brows and a hair part. */
export interface ReviewLook {
  readonly skin: Palette;
  readonly hair: Palette;
}

/**
 * The part composed on the base the way a book composes it (recoloured base, then the part, recoloured, at `at`),
 * flattened onto paper. Width and height are the base's at working size.
 */
export const composeReview = async (inputs: ReviewInputs, look: ReviewLook, width: number, height: number) => {
  const base = await recolour(inputs.base, [
    { mask: inputs.skinMask, palette: look.skin },
    ...(inputs.browMask ? [{ mask: inputs.browMask, palette: look.hair }] : []),
  ]);
  const placed = await Promise.all(
    inputs.layers.map(async (layer) => {
      const palette = layer.palette === "skin" ? look.skin : layer.palette === "hairColour" ? look.hair : null;
      const png = palette ? await recolour(layer.png, [{ palette }]) : layer.png;
      const [x0, y0, x1, y1] = rectToPixels(layer.at, width, height);
      return { input: await sharp(png).resize(x1 - x0, y1 - y0, { fit: "fill" }).png().toBuffer(), left: x0, top: y0 };
    }),
  );
  const png = await sharp(await sharp(base).resize(width, height, { fit: "fill" }).png().toBuffer())
    .composite(placed)
    .flatten({ background: PAPER })
    .png()
    .toBuffer();
  return new Uint8Array(png);
};

/**
 * Side by side for review: the part on the lightest skin, on the darkest, and its layers alone on a checkerboard
 * with the zone outlined in red, so a part cut off at the zone's edge shows.
 */
export const reviewSheet = async (
  light: Uint8Array,
  dark: Uint8Array,
  layers: ReadonlyArray<{ readonly png: Uint8Array; readonly at: Rect }>,
  zone: Rect,
  width: number,
  height: number,
) => {
  const [zx0, zy0, zx1, zy1] = rectToPixels(zone, width, height);
  const alone = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(
      await Promise.all(
        layers.map(async (layer) => {
          const [x0, y0, x1, y1] = rectToPixels(layer.at, width, height);
          return { input: await sharp(layer.png).resize(x1 - x0, y1 - y0, { fit: "fill" }).png().toBuffer(), left: x0, top: y0 };
        }),
      ),
    )
    .png()
    .toBuffer();
  const tile = 16;
  const checker = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="c" width="${tile * 2}" height="${tile * 2}" patternUnits="userSpaceOnUse"><rect width="${tile * 2}" height="${tile * 2}" fill="#ffffff"/><rect width="${tile}" height="${tile}" fill="#d0d0d0"/><rect x="${tile}" y="${tile}" width="${tile}" height="${tile}" fill="#d0d0d0"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`,
  );
  const zoneOutline = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${zx0 + 1}" y="${zy0 + 1}" width="${zx1 - zx0 - 2}" height="${zy1 - zy0 - 2}" fill="none" stroke="#e0301e" stroke-width="2" stroke-dasharray="8 6"/></svg>`,
  );
  const checkerTile = await sharp(checker)
    .composite([
      { input: alone, left: 0, top: 0 },
      { input: zoneOutline, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  const gap = 12;
  const png = await sharp({ create: { width: width * 3 + gap * 4, height: height + gap * 2, channels: 3, background: "#ffffff" } })
    .composite([
      { input: Buffer.from(light), left: gap, top: gap },
      { input: Buffer.from(dark), left: width + gap * 2, top: gap },
      { input: checkerTile, left: width * 2 + gap * 3, top: gap },
    ])
    .png()
    .toBuffer();
  return new Uint8Array(png);
};
