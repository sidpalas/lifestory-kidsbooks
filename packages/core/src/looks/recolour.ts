// The recolour (D26): a gradient map from the illustrator's neutral tones to a palette, inside a mask. A pure,
// version-pinned function: the same inputs give the same bytes, and changing it means a new algorithm name, so
// approved art never changes silently. Server-only (sharp).
import sharp from "sharp";

import type { Palette } from "../book-format/manifest.ts";

export const RECOLOUR_ALGORITHM = "gradient-map-v1";

/** Vector placeholders are rasterized at print resolution. */
const DPI = 300;

/**
 * Decodes an asset to RGBA. Raster files keep their pixels. An SVG is rasterized at DPI from its physical size
 * (its 72-dpi width is inches × 72): librsvg applies `density` as the DPI and sharp then scales by density / 72
 * again, so DPI needs density √(72 · DPI), and the resize corrects SVGs sized in pixels rather than inches.
 */
export const rasterize = async (body: Uint8Array) => {
  const { format, width, height } = await sharp(body).metadata();
  if (format !== "svg" || !width || !height) return sharp(body).ensureAlpha();
  const scale = DPI / 72;
  return sharp(body, { density: Math.sqrt(72 * DPI) })
    .resize(Math.round(width * scale), Math.round(height * scale), { fit: "fill" })
    .ensureAlpha();
};

const hex = (colour: string) => [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)) as [number, number, number];

/** The palette's colour at tone `t` (0 = black, 1 = white), linear between stops and flat past the ends. */
export const paletteAt = (palette: Palette, t: number): readonly [number, number, number] => {
  const stops = palette.toSorted((a, b) => a.at - b.at);
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (t <= first.at) return hex(first.colour);
  if (t >= last.at) return hex(last.colour);
  const upper = stops.findIndex((stop) => stop.at >= t);
  const lo = stops[upper - 1]!;
  const hi = stops[upper]!;
  const f = (t - lo.at) / (hi.at - lo.at);
  const [a, b] = [hex(lo.colour), hex(hi.colour)];
  return [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * f) as unknown as [number, number, number];
};

/**
 * Recolours `asset` region by region and returns a PNG. Each pixel's tone is its luminance in the original, so
 * shading and texture carry over; a mask's alpha blends the new colour in, so soft mask edges stay soft. Pixels
 * outside every mask, and the asset's alpha, are unchanged.
 */
export const recolour = async (
  asset: Uint8Array,
  regions: ReadonlyArray<{ readonly mask?: Uint8Array; readonly palette: Palette }>,
): Promise<Uint8Array> => {
  const { data, info } = await (await rasterize(asset)).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const original = Uint8Array.from(data);
  const out = Uint8Array.from(data);
  for (const region of regions) {
    const mask = region.mask
      ? await sharp(await (await rasterize(region.mask)).png().toBuffer())
          .resize(width, height, { fit: "fill" })
          .extractChannel(3)
          .raw()
          .toBuffer()
      : null;
    const lut = Array.from({ length: 256 }, (_, tone) => paletteAt(region.palette, tone / 255));
    for (let p = 0; p < width * height; p++) {
      const m = mask ? mask[p]! : 255;
      if (m === 0) continue;
      const i = p * 4;
      const tone = Math.round(0.2126 * original[i]! + 0.7152 * original[i + 1]! + 0.0722 * original[i + 2]!);
      const colour = lut[tone]!;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(out[i + c]! + ((colour[c]! - out[i + c]!) * m) / 255);
    }
  }
  // zlib level 6, not 9: on textured raster art (the watercolour sample) level 9 took ~90% of a recolour (~0.8 s of
  // ~0.85 s for an 800 × 1600 figure) for files only 4–5% smaller. The pixels, and so the cache key, are the same.
  return new Uint8Array(
    await sharp(out, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 6 })
      .toBuffer(),
  );
};
