// Turning an author's coloured figure into a base the book format can recolour (D24, D26): find the skin, take the
// colour a gradient map can't keep (blush, lips, a tongue) into the overlay, and turn the skin into neutral tones.
// Pure functions over float arrays (RGB 0..1, interleaved; alpha 0..1), so they're testable without images.
import { boxSum, components, dilate, enclosed, type Rgb } from "../parts/cutout.ts";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** CIE Lab (D65) per pixel: L 0..100, a and b roughly −100..100. */
export const toLab = (rgb: Float32Array) => {
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    const r = linear(rgb[i]!), g = linear(rgb[i + 1]!), b = linear(rgb[i + 2]!);
    const x = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    out[i] = 116 * y - 16;
    out[i + 1] = 500 * (x - y);
    out[i + 2] = 200 * (y - z);
  }
  return out;
};

/** The tone a gradient map reads (recolour.ts): luminance of the stored sRGB values. */
export const tone = (rgb: Float32Array, p: number) => 0.2126 * rgb[p * 3]! + 0.7152 * rgb[p * 3 + 1]! + 0.0722 * rgb[p * 3 + 2]!;

/** A Gaussian model of the figure's skin colour in Lab: its mean and inverse covariance. */
export interface SkinModel {
  readonly mean: readonly [number, number, number];
  readonly inverse: ReadonlyArray<number>;
}

/** Mahalanobis distance squared of pixel `p` from the skin model. */
export const skinDistance = (lab: Float32Array, p: number, model: SkinModel) => {
  const v = [lab[p * 3]! - model.mean[0], lab[p * 3 + 1]! - model.mean[1], lab[p * 3 + 2]! - model.mean[2]];
  let d2 = 0;
  for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) d2 += v[r]! * model.inverse[r * 3 + s]! * v[s]!;
  return d2;
};

const fitModel = (lab: Float32Array, pixels: ReadonlyArray<number>): SkinModel | null => {
  if (pixels.length < 50) return null;
  const mean = [0, 0, 0];
  for (const p of pixels) for (let c = 0; c < 3; c++) mean[c]! += lab[p * 3 + c]!;
  for (let c = 0; c < 3; c++) mean[c]! /= pixels.length;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pixels) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j]! += (lab[p * 3 + i]! - mean[i]!) * (lab[p * 3 + j]! - mean[j]!);
  // Floors: shading spreads skin over many lightnesses, and a flat colour would make every texture an outlier.
  const floor = [8 * 8, 0, 0, 0, 2.5 * 2.5, 0, 0, 0, 2.5 * 2.5];
  for (let k = 0; k < 9; k++) cov[k] = cov[k]! / pixels.length + floor[k]!;
  const [a, b, c, d, e, f, g, h, i] = cov as [number, number, number, number, number, number, number, number, number];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inverse = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d].map((v) => v / det);
  return { mean: [mean[0]!, mean[1]!, mean[2]!], inverse };
};

/** Lab values a skin of any tone can have, drawn in any medium: warm hues, some colour, not black or paper white. */
const skinLike = (L: number, a: number, b: number) => {
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return L > 15 && L < 97 && a > 1 && b > 3 && Math.hypot(a, b) > 6 && hue > 18 && hue < 82;
};

/**
 * The figure's skin colour. Without a hint it's the most common warm colour among the figure's opaque pixels (a
 * histogram peak in a and b), refined twice to the pixels within 3σ; with `seed` (a pixel the author clicked) it
 * starts from the colour around it. Null when the figure has no skin-like colour.
 */
export const findSkin = (lab: Float32Array, alpha: Float32Array, width: number, seed?: number): SkinModel | null => {
  const n = alpha.length;
  const candidates: Array<number> = [];
  for (let p = 0; p < n; p++) if (alpha[p]! > 0.9 && skinLike(lab[p * 3]!, lab[p * 3 + 1]!, lab[p * 3 + 2]!)) candidates.push(p);
  let start: ReadonlyArray<number>;
  if (seed !== undefined) {
    const sx = seed % width, sy = Math.floor(seed / width);
    const around = candidates.filter((p) => Math.abs((p % width) - sx) <= 4 && Math.abs(Math.floor(p / width) - sy) <= 4);
    start = around.length > 0 ? around : [seed];
  } else {
    // Peak of a 2-unit histogram over (a, b), smoothed over its neighbours.
    const bins = new Map<number, number>();
    const key = (p: number) => Math.round(lab[p * 3 + 1]! / 2) * 1000 + Math.round(lab[p * 3 + 2]! / 2);
    for (const p of candidates) bins.set(key(p), (bins.get(key(p)) ?? 0) + 1);
    let best = 0, peak = 0;
    for (const [k, _] of bins) {
      let sum = 0;
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) sum += bins.get(k + da * 1000 + db) ?? 0;
      if (sum > best) [best, peak] = [sum, k];
    }
    const pa = Math.round(peak / 1000) * 2, pb = (peak - Math.round(peak / 1000) * 1000) * 2;
    start = candidates.filter((p) => Math.hypot(lab[p * 3 + 1]! - pa, lab[p * 3 + 2]! - pb) < 6);
  }
  let model = fitModel(lab, start.length >= 50 ? start : candidates);
  for (let pass = 0; pass < 2 && model; pass++) {
    const m: SkinModel = model;
    model = fitModel(lab, candidates.filter((p) => skinDistance(lab, p, m) < 9)) ?? model;
  }
  return model;
};

/**
 * Every visible bit of skin (D26) as a soft mask 0..1: pixels within 3σ of the skin model, without specks; the
 * features skin encloses (eyes, the mouth, blush, lips: the gradient map keeps their tone, the overlay their colour)
 * up to a share of the skin, so a shirt between two arms stays out; and the outline drawn around the skin, which
 * must take the skin's palette or it shows a seam. `scale` is the figure's size over 1024 px.
 */
export const skinMask = (lab: Float32Array, alpha: Float32Array, width: number, height: number, model: SkinModel, scale: number) => {
  const n = alpha.length;
  const r = (radius: number) => Math.max(1, Math.round(radius * scale));
  const raw = Uint8Array.from(alpha, (a, p) => (a > 0.5 && skinDistance(lab, p, model) < 9 ? 1 : 0));
  const mask = new Uint8Array(n);
  for (const piece of components(raw, width, height)) if (piece.length >= 60 * scale * scale) for (const p of piece) mask[p] = 1;
  const skinPixels = mask.reduce((sum, v) => sum + v, 0);
  for (const hole of components(enclosed(mask, width, height), width, height)) {
    if (hole.length > 0.03 * skinPixels) continue;
    // A hole that reaches past the figure's edge is background, not a feature.
    if (hole.some((p) => alpha[p]! <= 0.5)) continue;
    for (const p of hole) mask[p] = 1;
  }
  // The outline: dark or greyish pixels around the skin, grown a pixel at a time through them, so an ink line of
  // any weight up to ~6 px (at 1024) goes with the skin and nothing beyond it does.
  const outline = Uint8Array.from(alpha, (a, p) => {
    const L = lab[p * 3]!, chroma = Math.hypot(lab[p * 3 + 1]!, lab[p * 3 + 2]!);
    return a >= 0.2 && (L < 50 || (chroma < 12 && L < 75)) ? 1 : 0;
  });
  for (let step = 0; step < Math.max(3, r(6)); step++) {
    const near = dilate(mask, width, height, 1);
    let grew = false;
    for (let p = 0; p < n; p++) {
      if (!mask[p] && near[p] && outline[p]) {
        mask[p] = 1;
        grew = true;
      }
    }
    if (!grew) break;
  }
  // A one-pixel soft edge, inside the figure's own alpha.
  const soft = boxSum(Float64Array.from(mask), 1, width, height, 1);
  return Float32Array.from(soft, (s, p) => clamp01(Math.min(s / 9, 1) * (mask[p] ? 1 : 0.5)) * Math.min(1, alpha[p]! * 1.05));
};

export interface FaceSplit {
  /** The overlay: colour inside the skin that's redder than the skin around it, unmixed against that skin. */
  readonly overlayAlpha: Float32Array;
  readonly overlayColour: Float32Array;
  /** The skin's own tone under the overlay, per pixel, for the base. */
  readonly skinTone: Float32Array;
}

/**
 * What a gradient map can't keep (D24, "Face overlays"): blush, lips, a tongue are redder than the skin around them,
 * and a recolour would turn them into darker or lighter skin. Per pixel inside the skin, the local skin colour S is
 * the mean of plain skin nearby; the redness over it (Δa* in Lab) gives the overlay's alpha (a pigment ~35 a* over
 * skin is opaque), and its colour is unmixed: R = (C − (1 − o)·S) / o, so o·R + (1 − o)·S is the drawing again. The
 * base then takes S's tone under the overlay, so a blush doesn't darken twice.
 */
export const splitFace = (rgb: Float32Array, lab: Float32Array, mask: Float32Array, width: number, height: number, model: SkinModel, scale: number): FaceSplit => {
  const n = mask.length;
  const plain = new Float64Array(n * 5);
  for (let p = 0; p < n; p++) {
    if (mask[p]! < 0.9 || skinDistance(lab, p, model) >= 4) continue;
    plain[p * 5] = 1;
    plain[p * 5 + 1] = rgb[p * 3]!;
    plain[p * 5 + 2] = rgb[p * 3 + 1]!;
    plain[p * 5 + 3] = rgb[p * 3 + 2]!;
    plain[p * 5 + 4] = lab[p * 3 + 1]!;
  }
  const local = boxSum(plain, 5, width, height, Math.max(4, Math.round(24 * scale)));
  const overlayAlpha = new Float32Array(n);
  const overlayColour = new Float32Array(n * 3);
  const skinTone = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    skinTone[p] = tone(rgb, p);
    if (mask[p]! < 0.5) continue;
    const w = local[p * 5]!;
    if (w < 1) continue;
    const S = [local[p * 5 + 1]! / w, local[p * 5 + 2]! / w, local[p * 5 + 3]! / w];
    const sa = local[p * 5 + 4]! / w;
    const L = lab[p * 3]!;
    const o = L > 25 ? clamp01((lab[p * 3 + 1]! - sa - 4) / 35) : 0;
    if (o < 0.03) continue;
    overlayAlpha[p] = o;
    for (let c = 0; c < 3; c++) overlayColour[p * 3 + c] = clamp01((rgb[p * 3 + c]! - (1 - o) * S[c]!) / o);
    // The overlay over S reproduces the drawing, so the base under it is S's tone, blended in at the overlay's soft edge.
    skinTone[p] = tone(rgb, p) + Math.min(1, o / 0.15) * (0.2126 * S[0]! + 0.7152 * S[1]! + 0.0722 * S[2]! - tone(rgb, p));
  }
  return { overlayAlpha, overlayColour, skinTone };
};

/**
 * The base's pixels: inside the skin mask, neutral greys whose tone the palettes expect (D26), outside it the
 * drawing as it is. Tones map piecewise linearly so the skin's median lands on `target` (the starter palettes put
 * the skin's own colour at 0.77) while black stays black and white stays white: line work keeps its contrast on
 * dark and light skin alike.
 */
export const neutralSkin = (rgb: Float32Array, mask: Float32Array, skinTone: Float32Array, options: { target?: number; median?: number } = {}) => {
  const target = options.target ?? 0.77;
  const n = mask.length;
  const tones: Array<number> = [];
  for (let p = 0; p < n; p++) if (mask[p]! >= 0.9) tones.push(skinTone[p]!);
  tones.sort((a, b) => a - b);
  // A little above the median: line work and shadows pull the plain median down. An occluder uses its figure's, so
  // a hand and a face of one skin get one tone.
  const median = options.median ?? (tones.length > 0 ? tones[Math.floor(tones.length * 0.6)]! : target);
  const map = (t: number) => (t < median ? (t * target) / Math.max(median, 1e-3) : target + ((t - median) * (1 - target)) / Math.max(1 - median, 1e-3));
  const out = new Float32Array(rgb.length);
  for (let p = 0; p < n; p++) {
    const m = mask[p]!;
    const g = clamp01(map(skinTone[p]!));
    for (let c = 0; c < 3; c++) out[p * 3 + c] = m * g + (1 - m) * rgb[p * 3 + c]!;
  }
  return { rgb: out, median };
};

/**
 * Fills the small holes of a figure's alpha with the picture's own pixels: features the matting took for background
 * because they look like it (eye whites on white paper, teeth). Holes bigger than `share` of the figure are real gaps
 * (between an arm and the body) and stay open.
 */
export const fillFigureHoles = (alpha: Float32Array, width: number, height: number, share = 0.01) => {
  const solid = Uint8Array.from(alpha, (a) => (a >= 0.5 ? 1 : 0));
  const total = solid.reduce((sum, v) => sum + v, 0);
  const out = Float32Array.from(alpha);
  for (const hole of components(enclosed(solid, width, height), width, height)) {
    if (hole.length > share * total) continue;
    for (const p of hole) out[p] = 1;
  }
  return out;
};

/** A flat image of one colour, the known background of a figure drawn on paper. */
export const flatImage = (width: number, height: number, colour: readonly [number, number, number]): Rgb => {
  const data = new Float32Array(width * height * 3);
  for (let p = 0; p < width * height; p++) data.set(colour, p * 3);
  return { width, height, data };
};
