// The image files around a part's cut-out (server-only, sharp): the base as the provider sees it, the cut-out of
// the provider's edit into an RGBA layer placed in the base, and the review images on the lightest and darkest skin.
// Every function is deterministic, so a rerun step writes the same bytes.
import sharp, { type Sharp } from "sharp";
import type { Palette, Rect } from "../book-format/manifest.ts";
import { paletteAt, rasterize, recolour } from "../looks/recolour.ts";
import { alphaBounds, coverOutline, crownGap, cutOutPart, type CutOutMetrics, findShift, neutralize, type PixelRect, type Rgb, shiftImage, skinPixels } from "./cutout.ts";

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
export const encodeLayer = async (region: LayerRegion, alpha: Float32Array, colour: Float32Array, width: number, height: number): Promise<PartLayer | null> => {
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
  options: CutOutOptions,
): Promise<{ readonly layers: ReadonlyArray<PartLayer>; readonly metrics: CutOutMetrics & { readonly skinPixels: number; readonly crownGap?: number; readonly outlineCovered?: number } }> => {
  const { width, height, padding } = prepared;
  const base = await toRgb(sharp(prepared.base));
  const aligned = await unpadEdit(edit, padding, width, height);
  return splitLayers(base, cutOutPart(base, aligned, rectToPixels(zone, width, height)), skinMask, options);
};

/**
 * How to cut a part out. `neutral`: the part's colours become the neutral tones its palette recolours (hair, facial
 * hair), else it keeps the colours drawn (glasses). `figure`: the base as stored, whose alpha is the figure's
 * silhouette; a neutral part reaches it where it stops just short (coverOutline).
 */
export type CutOutOptions = { readonly neutral: true; readonly figure: Uint8Array } | { readonly neutral: false };

/** A cut-out split by region into the part and any skin drawn in it (cutOutLayer). */
const splitLayers = async <M extends CutOutMetrics>(
  base: Rgb,
  { alpha, colour, metrics }: { readonly alpha: Float32Array; readonly colour: Float32Array; readonly metrics: M },
  skinMask: Uint8Array,
  options: CutOutOptions,
): Promise<{ readonly layers: ReadonlyArray<PartLayer>; readonly metrics: M & { readonly skinPixels: number; readonly crownGap?: number; readonly outlineCovered?: number } }> => {
  const { width, height } = base;
  const mask = await (await rasterize(skinMask)).resize(width, height, { fit: "fill" }).extractChannel(3).raw().toBuffer();
  // Hair can't carry skin-coloured highlights away as skin, but an accessory has no skin of its own: skin the model
  // redrew under glasses is the base's skin with its eye and nose lines moved, so the base shows there instead.
  const skin = skinPixels(colour, alpha, base, new Uint8Array(mask), Math.max(12, Math.round((40 * Math.max(width, height)) / 1024)), !options.neutral);
  const skinAlpha = options.neutral ? alpha.map((a, p) => (skin[p] ? a : 0)) : new Float32Array(alpha.length);
  const cut = alpha.map((a, p) => (skin[p] ? 0 : a));
  // Hair reaches the head's outline, which the matte leaves out (coverOutline).
  const figure = options.neutral ? await (await rasterize(options.figure)).resize(width, height, { fit: "fill" }).extractChannel(3).raw().toBuffer() : null;
  const outline = figure ? coverOutline(cut, colour, Float32Array.from(figure, (v) => v / 255), new Uint8Array(mask), width, height) : null;
  const partAlpha = outline?.alpha ?? cut;
  const partColour = outline?.colour ?? colour;
  const layers = await Promise.all([
    encodeLayer("part", partAlpha, options.neutral ? neutralize(partColour, partAlpha) : colour, width, height),
    encodeLayer("skin", skinAlpha, colour, width, height),
  ]);
  return {
    layers: layers.filter((layer): layer is PartLayer => layer !== null),
    // Hair only: bald scalp left above it (CROWN_GAP_LIMIT).
    metrics: { ...metrics, skinPixels: skin.reduce((sum, v) => sum + v, 0), ...(outline ? { outlineCovered: outline.covered } : {}), ...(options.neutral ? { crownGap: crownGap(partAlpha, new Uint8Array(mask), width, height) } : {}) },
  };
};

/**
 * The reference for an edit: an approved part on its own base, both as drawn (neutral grey, not recoloured: a
 * peach-skinned reference recoloured the edited face, 2026-11-19), flattened on paper and cropped to a square
 * around the part with the face under it, at 1024 px. The edit copies its style from this.
 */
export const referenceImage = async (base: Uint8Array, layers: ReadonlyArray<{ readonly png: Uint8Array; readonly at: Rect }>) => {
  const { base: flat, width, height } = await prepareBase(base);
  const placed = await Promise.all(
    layers.map(async (layer) => {
      const [x0, y0, x1, y1] = rectToPixels(layer.at, width, height);
      return { rect: [x0, y0, x1, y1] as const, input: await (await rasterize(layer.png)).resize(x1 - x0, y1 - y0, { fit: "fill" }).png().toBuffer(), left: x0, top: y0 };
    }),
  );
  const drawn = await sharp(flat).composite(placed).png().toBuffer();
  const [bx0, by0, bx1, by1] = placed.reduce<readonly [number, number, number, number]>(
    ([a, b, c, d], { rect }) => [Math.min(a, rect[0]), Math.min(b, rect[1]), Math.max(c, rect[2]), Math.max(d, rect[3])],
    [width, height, 0, 0],
  );
  const side = Math.round(1.5 * Math.max(bx1 - bx0, by1 - by0, 1));
  const x0 = Math.round((bx0 + bx1) / 2 - side / 2);
  const y0 = Math.round(by0 - 0.15 * side);
  const square = await (await windowOf(drawn, width, height, [x0, y0, x0 + side, y0 + side])).png().toBuffer();
  return new Uint8Array(await sharp(square).resize(1024, 1024, { kernel: "lanczos3" }).png().toBuffer());
};

// ---- Tiled edits (D44) -----------------------------------------------------------------------------------------
// One edit draws an option on several bases: each base's head, cropped to a window around the part's zone, is a
// tile of the image sent to the provider, and each tile of the edit is cut out against its own window.

/** Room above each head in a tile, in the provider's pixels: with 30 px the model moved heads down and clipped curls. */
export const TILE_HEADROOM = 110;
/** Four tiles of 512 × 768 in a 1024 × 1536 edit, or two of 768 × 1024 in a 1536 × 1024 one for large figures. */
const LAYOUTS = {
  four: { width: 1024, height: 1536, tile: { width: 512, height: 768 }, columns: 2 },
  two: { width: 1536, height: 1024, tile: { width: 768, height: 1024 }, columns: 2 },
} as const;
type TileLayout = (typeof LAYOUTS)[keyof typeof LAYOUTS];
/** A head whose window is wider than this many base pixels loses too much in a 512 px tile, so it goes two to an edit. */
const LARGE = 640;

/** Where one base sits in a tiled edit. */
export interface TilePlacement {
  /** The tile in the provider's image, in its pixels. */
  readonly slot: PixelRect;
  /** The part of the base (working pixels) the tile shows; it may reach past the base, where paper shows. */
  readonly window: PixelRect;
}

/** The highest row of the base's skin (a bald scalp) in the zone's columns, or the zone's top without skin there. */
export const headTop = async (skinMask: Uint8Array, width: number, height: number, zone: PixelRect) => {
  const alpha = await (await rasterize(skinMask)).resize(width, height, { fit: "fill" }).extractChannel(3).raw().toBuffer();
  const [x0, y0, x1, y1] = [Math.max(0, zone[0]), Math.max(0, zone[1]), Math.min(width, zone[2]), Math.min(height, zone[3])];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (alpha[y * width + x]! >= 128) return y;
  }
  return y0;
};

/**
 * The window of a base a tile shows: the zone's width, and from TILE_HEADROOM above the head to the zone's bottom,
 * widened to the tile's aspect and never smaller than the tile (no upscaling). Centred on the zone.
 */
const tileWindow = (zone: PixelRect, top: number, tile: { readonly width: number; readonly height: number }): PixelRect => {
  const width = Math.ceil(Math.max(neededWidth(zone, top, tile), tile.width));
  const height = Math.round((width * tile.height) / tile.width);
  const x0 = Math.round((zone[0] + zone[2]) / 2 - width / 2);
  const y0 = Math.round(top - (TILE_HEADROOM * width) / tile.width);
  return [x0, y0, x0 + width, y0 + height];
};
const neededWidth = (zone: PixelRect, top: number, tile: { readonly width: number; readonly height: number }) =>
  Math.max(zone[2] - zone[0], ((zone[3] - top) * tile.width) / (tile.height - TILE_HEADROOM));

export interface TiledImage {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Indexes into the bases given to tileBases, in tile order. */
  readonly bases: ReadonlyArray<number>;
  readonly tiles: ReadonlyArray<TilePlacement>;
}

/** The base's pixels in `window`, with paper where the window reaches past it. */
const windowOf = async (base: Uint8Array, width: number, height: number, [x0, y0, x1, y1]: PixelRect) => {
  const left = Math.max(0, -x0);
  const top = Math.max(0, -y0);
  const right = Math.max(0, x1 - width);
  const bottom = Math.max(0, y1 - height);
  const extended = await sharp(base).extend({ left, top, right, bottom, background: PAPER }).png().toBuffer();
  return sharp(extended).extract({ left: x0 + left, top: y0 + top, width: x1 - x0, height: y1 - y0 });
};

/**
 * The images for one tiled edit of `bases` (each prepareBase's flattened base, its zone, and the top of its head):
 * four to an image, or two when any head is large, in order. Deterministic, so a rerun writes the same bytes.
 */
export const tileBases = async (
  bases: ReadonlyArray<{ readonly base: Uint8Array; readonly width: number; readonly height: number; readonly zone: Rect; readonly headTop: number }>,
): Promise<ReadonlyArray<TiledImage>> => {
  const zones = bases.map((base) => rectToPixels(base.zone, base.width, base.height));
  const large = bases.some((base, i) => neededWidth(zones[i]!, base.headTop, LAYOUTS.four.tile) > LARGE);
  const layout: TileLayout = large || bases.length <= 2 ? LAYOUTS.two : LAYOUTS.four;
  const perImage = (layout.width / layout.tile.width) * (layout.height / layout.tile.height);
  const images: Array<TiledImage> = [];
  for (let first = 0; first < bases.length; first += perImage) {
    const indexes = bases.map((_, i) => i).slice(first, first + perImage);
    const tiles = indexes.map((index, k): TilePlacement => {
      const x = (k % layout.columns) * layout.tile.width;
      const y = Math.floor(k / layout.columns) * layout.tile.height;
      return { slot: [x, y, x + layout.tile.width, y + layout.tile.height], window: tileWindow(zones[index]!, bases[index]!.headTop, layout.tile) };
    });
    const composites = await Promise.all(
      tiles.map(async (tile, k) => {
        const base = bases[indexes[k]!]!;
        const crop = await (await windowOf(base.base, base.width, base.height, tile.window)).png().toBuffer();
        const input = await sharp(crop).resize(layout.tile.width, layout.tile.height, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
        return { input, left: tile.slot[0], top: tile.slot[1] };
      }),
    );
    const png = await sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: PAPER } }).composite(composites).png().toBuffer();
    images.push({ png: new Uint8Array(png), width: layout.width, height: layout.height, bases: indexes, tiles });
  }
  return images;
};

/** Every `factor`-th pixel of `image`, for a coarse search. */
const subsample = (image: Rgb, factor: number): Rgb => {
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * factor * image.width + x * factor) * 3;
      data.set(image.data.subarray(from, from + 3), (y * width + x) * 3);
    }
  }
  return { width, height, data };
};

/**
 * cutOutLayer for one tile of a tiled edit: the tile, scaled back to its window, is cut out against the base's
 * window (cutOutPart, after a coarse alignment of up to ±48 tile pixels on the body below the head, since the model
 * may move a head), and the result is put back on the base's canvas. The zone stays 16 tile pixels inside the
 * tile's sides and 8 above its bottom, where the neighbouring tile begins.
 */
export const cutOutTile = async (
  prepared: Pick<PreparedBase, "base" | "width" | "height">,
  edit: Uint8Array,
  placement: TilePlacement,
  skinMask: Uint8Array,
  zone: Rect,
  options: CutOutOptions,
) => {
  const { width, height } = prepared;
  const [wx0, wy0, wx1, wy1] = placement.window;
  const [sx0, sy0, sx1, sy1] = placement.slot;
  const windowWidth = wx1 - wx0;
  const windowHeight = wy1 - wy0;
  const scale = windowWidth / (sx1 - sx0);
  const windowBase = await toRgb(await windowOf(prepared.base, width, height, placement.window));
  const tile = await sharp(await sharp(edit).flatten({ background: PAPER }).extract({ left: sx0, top: sy0, width: sx1 - sx0, height: sy1 - sy0 }).png().toBuffer())
    .resize(windowWidth, windowHeight, { fit: "fill", kernel: "lanczos3" });
  const rawTile = await toRgb(tile);

  const [zx0, zy0, zx1, zy1] = rectToPixels(zone, width, height);
  const inWindow: PixelRect = [
    Math.max(zx0 - wx0, Math.round(16 * scale)),
    Math.max(zy0 - wy0, 0),
    Math.min(zx1 - wx0, windowWidth - Math.round(16 * scale)),
    Math.min(zy1 - wy0, windowHeight - Math.round(8 * scale)),
  ];
  const factor = Math.max(1, Math.round(4 * scale));
  const band = Math.round((TILE_HEADROOM + 0.25 * (sy1 - sy0)) * scale);
  const [cx, cy] = findShift(subsample(windowBase, factor), subsample(rawTile, factor), [0, 0, windowWidth, Math.round(band / factor)], 12);
  const coarseShift = [cx * factor, cy * factor] as const;
  const cut = cutOutPart(windowBase, shiftImage(rawTile, coarseShift[0], coarseShift[1]), inWindow);

  const alpha = new Float32Array(width * height);
  const colour = new Float32Array(width * height * 3);
  for (let y = Math.max(0, wy0); y < Math.min(height, wy1); y++) {
    for (let x = Math.max(0, wx0); x < Math.min(width, wx1); x++) {
      const from = (y - wy0) * windowWidth + (x - wx0);
      alpha[y * width + x] = cut.alpha[from]!;
      colour.set(cut.colour.subarray(from * 3, from * 3 + 3), (y * width + x) * 3);
    }
  }
  const base = await toRgb(sharp(prepared.base));
  return splitLayers(base, { alpha, colour, metrics: { ...cut.metrics, coarseShift } }, skinMask, options);
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
