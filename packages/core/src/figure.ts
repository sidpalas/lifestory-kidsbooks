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
  /**
   * What counts as the figure: each connected part of the drawing that comes within this share of the bald figure's
   * larger side. Separate parts further away (a second Tiny, scenery) are dropped whole, never cut through.
   */
  keepDilate: 0.08,
  /**
   * The backstop for attached parts: the bald figure dilated by this share of its larger side, plus the hair zone. A
   * real child is rarely the bald drawing's exact shape (a toddler's bigger head, a helmet sized to it, long hair).
   */
  outerDilate: 0.25,
  /** The hair zone: an ellipse round the head's box, grown by this share of its size in every direction. */
  hairGrow: 0.6,
  /** The backstop's edge fades over this many pixels of the generation canvas, so a cut is never a straight line. */
  featherPx: 4,
  /** Contrast scale of the tint, clamped. */
  tintContrast: [0.6, 1.2] as const,
  /**
   * A figure that lost more than this share of its pixels to the clip, or runs off its window, is drawn again; after
   * the last try the best one is kept and the review queue flags the page.
   */
  flagClippedShare: 0.05,
  /** Running off the window: drawn pixels on the canvas edge, where the bald figure isn't, over this share of it. */
  edgeShare: 0.01,
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
type Box = NonNullable<ReturnType<typeof bounds>>;

/**
 * Where to put the drawing when it's rescaled onto the bald figure: one scale for both axes, between the two that
 * would match the bald box's width or its height, and an alignment to the box's start, centre or end on each axis,
 * whichever overlaps the bald figure most (sampled on a coarse grid).
 */
const evenFit = (drawn: Mask, bald: Mask, width: number, height: number, box: Box, baldBox: Box) => {
  const bw = box.x1 - box.x0,
    bh = box.y1 - box.y0;
  const tw = baldBox.x1 - baldBox.x0,
    th = baldBox.y1 - baldBox.y0;
  const [lo, hi] = [Math.min(tw / bw, th / bh), Math.max(tw / bw, th / bh)];
  const step = Math.max(1, Math.round(Math.max(width, height) / 300));
  let best = { left: baldBox.x0, top: baldBox.y0, width: tw, height: th, score: -1 };
  for (let k = 0; k <= 8; k++) {
    const s = lo + ((hi - lo) * k) / 8;
    const w = Math.max(1, Math.round(bw * s)),
      h = Math.max(1, Math.round(bh * s));
    for (const left of [baldBox.x0, Math.round((baldBox.x0 + baldBox.x1 - w) / 2), baldBox.x1 - w])
      for (const top of [baldBox.y0, Math.round((baldBox.y0 + baldBox.y1 - h) / 2), baldBox.y1 - h]) {
        let both = 0,
          either = 0;
        for (let y = 0; y < height; y += step)
          for (let x = 0; x < width; x += step) {
            const u = x - left,
              v = y - top;
            const d =
              u >= 0 && v >= 0 && u < w && v < h
                ? drawn[
                    (box.y0 + Math.min(bh - 1, Math.floor(v / s))) * width +
                      box.x0 +
                      Math.min(bw - 1, Math.floor(u / s))
                  ]!
                : 0;
            const b = bald[y * width + x]!;
            both += d & b;
            either += d | b;
          }
        const score = either ? both / either : 0;
        if (score > best.score) best = { left, top, width: w, height: h, score };
      }
  }
  return best;
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

/** The drawing's parts (4-connected) that come within the `near` mask; the rest is cleared. Returns the kept mask. */
const attachedParts = (mask: Mask, near: Mask, width: number) => {
  const kept = new Uint8Array(mask.length);
  const seen = new Uint8Array(mask.length);
  const stack: Array<number> = [];
  const part: Array<number> = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let touches = false;
    part.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      part.push(i);
      if (near[i]) touches = true;
      const x = i % width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j < 0 || j >= mask.length || seen[j] || !mask[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (touches) for (const i of part) kept[i] = 1;
  }
  return kept;
};

export interface FittedFigure {
  readonly png: Uint8Array;
  readonly iou: number;
  readonly rescaled: boolean;
  /** Share of the drawn figure's pixels the clip removed: detached parts and what reached past the backstop. */
  readonly clippedShare: number;
  /** The drawing runs off its window where the bald figure doesn't: part of the child is missing. */
  readonly offWindow: boolean;
}

/** Whether a fitted figure is good enough to keep without another try (figureRules.flagClippedShare). */
export const figureAcceptable = (figure: Pick<FittedFigure, "clippedShare" | "offWindow">) =>
  figure.clippedShare <= figureRules.flagClippedShare && !figure.offWindow;

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
  const side = Math.max(baldBox.x1 - baldBox.x0, baldBox.y1 - baldBox.y0);

  // Drop parts of the drawing that don't belong to the figure, whole.
  const attached = attachedParts(drawn, dilate(bald, width, height, Math.round(figureRules.keepDilate * side)), width);
  let detached = 0;
  for (let i = 0; i < drawn.length; i++)
    if (drawn[i] && !attached[i]) {
      rgba[i * 4 + 3] = 0;
      drawn[i] = 0;
      detached++;
    }

  let overlap = iou(drawn, bald);
  let rescaled = false;
  if (overlap < figureRules.rescaleBelowIoU) {
    const box = bounds(drawn, width);
    if (box) {
      // One scale for both axes, so a face keeps its proportions: a top knot or a figure the window cuts off makes the
      // drawing's box another shape than the bald figure's, and stretching it to fit squashed the face.
      const at = evenFit(drawn, bald, width, height, box, baldBox);
      const piece = await sharp(rgba, { raw: { width, height, channels: 4 } })
        .extract({ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 })
        .resize(at.width, at.height, { fit: "fill" })
        .raw()
        .toBuffer();
      const moved = Buffer.alloc(width * height * 4);
      for (let y = Math.max(0, at.top); y < Math.min(height, at.top + at.height); y++) {
        const x0 = Math.max(0, at.left);
        const x1 = Math.min(width, at.left + at.width);
        if (x1 <= x0) break;
        piece.copy(
          moved,
          (y * width + x0) * 4,
          ((y - at.top) * at.width + x0 - at.left) * 4,
          ((y - at.top) * at.width + x1 - at.left) * 4,
        );
      }
      const movedMask = maskOf(moved, floor);
      const movedIoU = iou(movedMask, bald);
      if (movedIoU > overlap) {
        rgba = moved;
        drawn = movedMask;
        overlap = movedIoU;
        rescaled = true;
      }
    }
  }

  // The backstop: the bald figure dilated generously, plus an ellipse round the head for hair, hats and helmets.
  const backstop = dilate(bald, width, height, Math.round(figureRules.outerDilate * side));
  const head = inWindow(input.head, input.window, input.size);
  const cx = head.left + head.width / 2;
  const cy = head.top + head.height / 2;
  const rx = head.width / 2 + head.width * figureRules.hairGrow;
  const ry = head.height / 2 + head.height * figureRules.hairGrow;
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(height, Math.ceil(cy + ry)); y++)
    for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(width, Math.ceil(cx + rx)); x++)
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) backstop[y * width + x] = 1;

  // Off the window: drawn pixels on the canvas edge where the backstop doesn't reach it.
  let edge = 0;
  const border = [
    ...Array.from({ length: width }, (_, x) => [x, (height - 1) * width + x]),
    ...Array.from({ length: height - 2 }, (_, y) => [(y + 1) * width, (y + 1) * width + width - 1]),
  ].flat();
  for (const i of border) if (drawn[i] && !backstop[i]) edge++;
  const offWindow = edge > figureRules.edgeShare * 2 * (width + height);

  // Fade across the backstop's edge instead of cutting on it.
  const soft = await sharp(Buffer.from(backstop.map((v) => v * 255)), { raw: { width, height, channels: 1 } })
    .blur(Math.max(0.3, figureRules.featherPx / 2))
    .extractChannel(0)
    .raw()
    .toBuffer();
  let kept = 0,
    faded = 0;
  for (let i = 0; i < drawn.length; i++) {
    if (!drawn[i]) continue;
    const factor = Math.min(1, (soft[i]! / 255) * 2);
    if (factor < 0.5) {
      rgba[i * 4 + 3] = 0;
      drawn[i] = 0;
      faded++;
      continue;
    }
    if (factor < 1) rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3]! * factor);
    kept++;
  }
  // Measured after any rescale, so a figure drawn at another size counts its own pixels.
  const clipped = detached + faded;

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
    clippedShare: Math.round((clipped / (clipped + kept)) * 10000) / 10000,
    offWindow,
  };
};
