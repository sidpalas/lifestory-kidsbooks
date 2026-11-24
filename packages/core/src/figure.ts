// Drawing one figure of a page (D56), the image work around the model call: the page reference it sees, and the
// checks on what it drew. Every figure is drawn on a canvas of the generation size covering the figure's window, and
// stored at that size; `composePage` lays it over the window.
import sharp from "sharp";

import type { ArtArea, Rect, Trim } from "./book-format/manifest.ts";

/** The checks' settings (D56): spike defaults, configuration rather than structure. */
export const figureRules = {
  /** Alpha below this share of opaque is treated as transparent: the model's faint haze around a figure. */
  alphaFloor: 0.1,
  /** Rescale the drawn figure onto the bald one when their overlap is below this (p04's lying hero fitted at 0.596). */
  rescaleBelowIoU: 0.5,
  /** The keep zone: the bald figure's alpha dilated by this share of its larger side... */
  keepDilate: 0.08,
  /** ...plus the head's box grown by this share of its size up and to the sides, for hair. */
  hairGrow: 0.4,
  /** Contrast scale of the tint, clamped. */
  tintContrast: [0.6, 1.2] as const,
  /** The review queue flags a page whose figure lost more than this share of its pixels to the clip. */
  flagClippedShare: 0.05,
} as const;

/** The illustration's aspect, width over height: the whole page with bleed, or its left half. */
export const illustrationAspect = (trim: Trim, art: ArtArea) =>
  ((art === "left-half" ? trim.widthIn / 2 : trim.widthIn) + 2 * trim.bleedIn) / (trim.heightIn + 2 * trim.bleedIn);

/** The generation size of a window: 1024×1536 when it is taller than wide in page pixels, else 1536×1024. */
export const generationSize = (window: Rect, aspect: number) => {
  const tall = window[3] - window[1] > (window[2] - window[0]) * aspect;
  return tall ? { width: 1024, height: 1536 } : { width: 1536, height: 1024 };
};

/** A rect inside the window, in the canvas's pixels. */
const inWindow = (rect: Rect, window: Rect, size: { width: number; height: number }) => {
  const sx = size.width / (window[2] - window[0]);
  const sy = size.height / (window[3] - window[1]);
  const left = Math.round((rect[0] - window[0]) * sx);
  const top = Math.round((rect[1] - window[1]) * sy);
  return {
    left,
    top,
    width: Math.max(1, Math.round((rect[2] - window[0]) * sx) - left),
    height: Math.max(1, Math.round((rect[3] - window[1]) * sy) - top),
  };
};

/** The bald figure as an RGBA canvas over the window. */
export const placeReference = async (
  reference: Uint8Array,
  box: Rect,
  window: Rect,
  size: { width: number; height: number },
) => {
  const at = inWindow(box, window, size);
  const input = await sharp(reference).resize(at.width, at.height, { fit: "fill" }).ensureAlpha().png().toBuffer();
  return sharp({ create: { ...size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input, left: at.left, top: at.top }])
    .raw()
    .toBuffer();
};

/**
 * What the model sees for one figure: the plate with every figure of the page bald on it (D56: back to front, each
 * seeing the others bald; no occluders), cropped to the window and scaled to the generation size.
 */
export const pageReference = async (
  plate: Uint8Array,
  figures: ReadonlyArray<{ readonly reference: Uint8Array; readonly box: Rect }>,
  window: Rect,
  size: { width: number; height: number },
) => {
  const whole: Rect = [0, 0, 1000, 1000];
  // Scale the whole plate so the window fills the canvas, then crop.
  const scaleX = 1000 / (window[2] - window[0]);
  const scaleY = 1000 / (window[3] - window[1]);
  const full = { width: Math.round(size.width * scaleX), height: Math.round(size.height * scaleY) };
  const plateLayer = await sharp(plate).resize(full.width, full.height, { fit: "fill" }).png().toBuffer();
  const layers = await Promise.all(
    figures.map(async (figure) => {
      const at = inWindow(figure.box, whole, full);
      const input = await sharp(figure.reference).resize(at.width, at.height, { fit: "fill" }).png().toBuffer();
      return { input, left: at.left, top: at.top };
    }),
  );
  const composed = await sharp(plateLayer).composite(layers).png().toBuffer();
  const crop = inWindow(window, whole, full);
  return new Uint8Array(
    await sharp(composed)
      .extract({
        left: Math.min(crop.left, full.width - 1),
        top: Math.min(crop.top, full.height - 1),
        width: Math.min(size.width, full.width - crop.left),
        height: Math.min(size.height, full.height - crop.top),
      })
      .resize(size.width, size.height, { fit: "fill" })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer(),
  );
};

type Mask = Uint8Array;

const maskOf = (rgba: Buffer | Uint8Array, floor: number) => {
  const mask = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3]! >= floor ? 1 : 0;
  return mask;
};

const bounds = (mask: Mask, width: number) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % width,
      y = (i / width) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
};

export const iou = (a: Mask, b: Mask) => {
  let both = 0,
    either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either === 0 ? 0 : both / either;
};

/** Square dilation by `r` pixels, separable, with running counts: linear in the pixels whatever `r` is. */
export const dilate = (mask: Mask, width: number, height: number, r: number) => {
  const pass = (src: Mask, along: "x" | "y") => {
    const out = new Uint8Array(src.length);
    const [n, m] = along === "x" ? [width, height] : [height, width];
    const at =
      along === "x" ? (line: number, i: number) => line * width + i : (line: number, i: number) => i * width + line;
    for (let line = 0; line < m; line++) {
      let count = 0;
      for (let i = 0; i < Math.min(r, n); i++) count += src[at(line, i)]!;
      for (let i = 0; i < n; i++) {
        if (i + r < n) count += src[at(line, i + r)]!;
        if (i - r - 1 >= 0) count -= src[at(line, i - r - 1)]!;
        out[at(line, i)] = count > 0 ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(mask, "x"), "y");
};

export interface FittedFigure {
  readonly png: Uint8Array;
  readonly iou: number;
  readonly rescaled: boolean;
  /** Share of the drawn figure's pixels outside the keep zone, which the clip removed. */
  readonly clippedShare: number;
}

/** The model drew no transparency, or nothing at all: retry the generation. */
export class FigureUnusable extends Error {}

/**
 * The checks on a drawn figure (D56), in order: an alpha floor, the fit against the bald figure (rescale onto its
 * box when the overlap is low), the keep-zone clip, then the tint that matches the bald figure's colour and contrast.
 */
export const fitFigure = async (input: {
  readonly output: Uint8Array;
  /** The bald figure placed on the canvas (placeReference). */
  readonly bald: Buffer;
  readonly head: Rect;
  readonly window: Rect;
  readonly size: { readonly width: number; readonly height: number };
  readonly tint: boolean;
}): Promise<FittedFigure> => {
  const { width, height } = input.size;
  const floor = Math.ceil(figureRules.alphaFloor * 255);
  let rgba = await sharp(input.output).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  let drawn = maskOf(rgba, floor);
  const opaque = drawn.reduce((sum, v) => sum + v, 0);
  if (opaque === 0 || opaque === drawn.length)
    throw new FigureUnusable("the drawn figure has no transparent background");
  for (let i = 0; i < drawn.length; i++) if (!drawn[i]) rgba[i * 4 + 3] = 0;

  const bald = maskOf(input.bald, floor);
  const baldBox = bounds(bald, width)!;
  let overlap = iou(drawn, bald);
  let rescaled = false;
  if (overlap < figureRules.rescaleBelowIoU) {
    const box = bounds(drawn, width)!;
    const piece = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .extract({ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 })
      .resize(baldBox.x1 - baldBox.x0, baldBox.y1 - baldBox.y0, { fit: "fill" })
      .png()
      .toBuffer();
    const moved = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: piece, left: baldBox.x0, top: baldBox.y0 }])
      .raw()
      .toBuffer();
    const movedMask = maskOf(moved, floor);
    const movedIoU = iou(movedMask, bald);
    if (movedIoU > overlap) {
      rgba = moved;
      drawn = movedMask;
      overlap = movedIoU;
      rescaled = true;
    }
  }

  const radius = Math.round(figureRules.keepDilate * Math.max(baldBox.x1 - baldBox.x0, baldBox.y1 - baldBox.y0));
  const keep = dilate(bald, width, height, radius);
  const head = inWindow(input.head, input.window, input.size);
  const grow = figureRules.hairGrow;
  const hx0 = Math.max(0, Math.floor(head.left - head.width * grow));
  const hx1 = Math.min(width, Math.ceil(head.left + head.width * (1 + grow)));
  const hy0 = Math.max(0, Math.floor(head.top - head.height * grow));
  const hy1 = Math.min(height, head.top + head.height);
  for (let y = hy0; y < hy1; y++) for (let x = hx0; x < hx1; x++) keep[y * width + x] = 1;
  let kept = 0,
    clipped = 0;
  for (let i = 0; i < drawn.length; i++) {
    if (!drawn[i]) continue;
    if (keep[i]) kept++;
    else {
      clipped++;
      rgba[i * 4 + 3] = 0;
      drawn[i] = 0;
    }
  }

  if (input.tint && kept > 0) {
    const stats = (pixels: Buffer, mask: Mask) => {
      const sum = [0, 0, 0],
        sq = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        n++;
        for (let c = 0; c < 3; c++) {
          const v = pixels[i * 4 + c]!;
          sum[c]! += v;
          sq[c]! += v * v;
        }
      }
      const mean = sum.map((s) => s / n);
      const std = Math.sqrt(sq.reduce((total, s, c) => total + s / n - mean[c]! ** 2, 0) / 3);
      return { mean, std };
    };
    const target = stats(input.bald, bald);
    const layer = stats(rgba, drawn);
    const [lo, hi] = figureRules.tintContrast;
    const k = layer.std === 0 ? 1 : Math.min(hi, Math.max(lo, target.std / layer.std));
    for (let i = 0; i < drawn.length; i++) {
      if (!drawn[i]) continue;
      for (let c = 0; c < 3; c++) {
        const v = (rgba[i * 4 + c]! - layer.mean[c]!) * k + target.mean[c]!;
        rgba[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }

  const png = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return {
    png: new Uint8Array(png),
    iou: Math.round(overlap * 1000) / 1000,
    rescaled,
    clippedShare: Math.round((clipped / (kept + clipped)) * 10000) / 10000,
  };
};
