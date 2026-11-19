// Cutting a part out of an in-place edit (docs/plan.md, "Cutting parts out"; D30). The provider redraws the base B
// with the part added, giving the edit C. Where the part covers the base, C = a·F + (1 − a)·B, so with B known the
// part's alpha a and colour F follow per pixel once F's colour is estimated nearby (known-background matting).
// Thresholding |C − B| instead loses thin glasses frames and baby wisps and keeps a band of the old skin.
//
// Steps, all deterministic: align C to B by the integer shift that best matches outside the zone; colour-match C to
// B outside the zone (a linear fit per channel, since the model re-tones the whole picture); segment the part (the
// change region as a prior); matte inside the segment against B; unmix F. Pure functions over RGB float arrays, so
// they're testable without images; server-only only because callers decode with sharp.

/** An RGB image, channels interleaved, values 0..1. */
export interface Rgb {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

/** [x0, y0, x1, y1] in pixels, end-exclusive. */
export type PixelRect = readonly [number, number, number, number];

export interface CutOut {
  /** Alpha 0..1 per pixel, on the base's canvas. */
  readonly alpha: Float32Array;
  /** The part's own colour per pixel (RGB 0..1); meaningful where alpha > 0. */
  readonly colour: Float32Array;
  readonly metrics: CutOutMetrics;
}

export interface CutOutMetrics {
  /** The shift applied to the edit, in pixels. */
  readonly shift: readonly [number, number];
  /** Per channel [gain, offset] mapping the edit's colours onto the base's. */
  readonly colourFit: ReadonlyArray<readonly [number, number]>;
  /** Mean |C − B| outside the zone after alignment and colour match, in 0..255: how much the model redrew. */
  readonly outsideChange: number;
  /** Mean |a·F + (1 − a)·B − C| inside the zone, in 0..255: how well the layer reproduces the edit. */
  readonly recompositeError: number;
  /** Pixels with any alpha, and with alpha ≥ 0.95. */
  readonly alphaPixels: number;
  readonly opaquePixels: number;
  /** Share of the zone's border where the part is opaque: above a few percent the part was cut off, so widen the zone. */
  readonly zoneEdgeContact: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Thresholds in 0..1 colour units and radii at 1024 px; radii scale with the image (assessment, 2026-11-19). */
const CHANGED = 24 / 255;
const SURE = 60 / 255;
const NEAR = 14 / 255;

const inRect = (rect: PixelRect, x: number, y: number) => x >= rect[0] && x < rect[2] && y >= rect[1] && y < rect[3];

/** Samples `image` shifted by (dx, dy), clamping at the edges. */
export const shiftImage = (image: Rgb, dx: number, dy: number): Rgb => {
  if (dx === 0 && dy === 0) return image;
  const { width, height, data } = image;
  const out = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(height - 1, Math.max(0, y - dy));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(width - 1, Math.max(0, x - dx));
      const i = (y * width + x) * 3;
      const j = (sy * width + sx) * 3;
      out[i] = data[j]!;
      out[i + 1] = data[j + 1]!;
      out[i + 2] = data[j + 2]!;
    }
  }
  return { width, height, data: out };
};

/** The integer shift of `edit` (within ±range) that best matches `base` outside `zone`, by mean absolute difference. */
export const findShift = (base: Rgb, edit: Rgb, zone: PixelRect, range = 6): readonly [number, number] => {
  const { width, height } = base;
  const stride = Math.max(1, Math.round(Math.max(width, height) / 400));
  const cost = (dx: number, dy: number) => {
    let sum = 0;
    let n = 0;
    for (let y = range; y < height - range; y += stride) {
      for (let x = range; x < width - range; x += stride) {
        if (inRect(zone, x, y)) continue;
        const i = (y * width + x) * 3;
        const j = ((y - dy) * width + (x - dx)) * 3;
        sum += Math.abs(base.data[i]! - edit.data[j]!) + Math.abs(base.data[i + 1]! - edit.data[j + 1]!) + Math.abs(base.data[i + 2]! - edit.data[j + 2]!);
        n++;
      }
    }
    return n === 0 ? 0 : sum / n;
  };
  let best: [number, number, number] = [0, 0, cost(0, 0)];
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const c = cost(dx, dy);
      // Prefer no shift unless one is clearly better: re-rendered texture shouldn't move the part by a pixel.
      if (c < best[2] * 0.97) best = [dx, dy, c];
    }
  }
  return [best[0], best[1]];
};

/**
 * Per channel least-squares fit edit → base over the pixels outside `zone`, refit without outliers (pixels the
 * model changed for real). Returns the corrected edit and the fit.
 */
export const colourMatch = (base: Rgb, edit: Rgb, zone: PixelRect) => {
  const { width, height } = base;
  const fit: Array<readonly [number, number]> = [];
  const out = new Float32Array(edit.data.length);
  for (let c = 0; c < 3; c++) {
    let gain = 1;
    let offset = 0;
    for (let pass = 0; pass < 2; pass++) {
      let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          if (inRect(zone, x, y)) continue;
          const i = (y * width + x) * 3 + c;
          const e = edit.data[i]!;
          const b = base.data[i]!;
          if (pass === 1 && Math.abs(gain * e + offset - b) > 0.1) continue;
          n++; sx += e; sy += b; sxx += e * e; sxy += e * b;
        }
      }
      const denominator = n * sxx - sx * sx;
      if (n < 16 || Math.abs(denominator) < 1e-9) break;
      gain = (n * sxy - sx * sy) / denominator;
      offset = (sy - gain * sx) / n;
    }
    fit.push([gain, offset]);
    for (let p = c; p < edit.data.length; p += 3) out[p] = clamp01(gain * edit.data[p]! + offset);
  }
  return { image: { width, height, data: out } satisfies Rgb, fit };
};

// Binary morphology through a Euclidean distance transform (Felzenszwalb & Huttenlocher), so a disk of any radius
// costs the same.
const INF = 1e20;
const edt1d = (f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) => {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
};

/** Squared distance from each pixel to the nearest set pixel of `mask`. */
export const distanceSquared = (mask: Uint8Array, width: number, height: number) => {
  const out = new Float64Array(width * height);
  for (let p = 0; p < out.length; p++) out[p] = mask[p] ? 0 : INF;
  const n = Math.max(width, height);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = out[y * width + x]!;
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) out[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = out[y * width + x]!;
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) out[y * width + x] = d[x]!;
  }
  return out;
};

export const dilate = (mask: Uint8Array, width: number, height: number, radius: number) => {
  const d = distanceSquared(mask, width, height);
  return Uint8Array.from(d, (v) => (v <= radius * radius ? 1 : 0));
};

export const erode = (mask: Uint8Array, width: number, height: number, radius: number) =>
  Uint8Array.from(dilate(Uint8Array.from(mask, (m) => 1 - m), width, height, radius), (m) => 1 - m);

/** The 8-connected components of `mask`, as lists of pixel indices. */
export const components = (mask: Uint8Array, width: number, height: number) => {
  const found: Array<Array<number>> = [];
  const seen = new Uint8Array(mask.length);
  const stack: Array<number> = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.push(start);
    seen[start] = 1;
    const component: Array<number> = [];
    while (stack.length > 0) {
      const p = stack.pop()!;
      component.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    found.push(component);
  }
  return found;
};

/**
 * The part's own pieces of a change mask. The model redraws a little of everything (a face's line work moves by a
 * pixel), and those changes are small next to the part, so a piece is kept when it is at least `share` of the
 * largest piece, or reaches within `reach` pixels of such a piece (a wisp off the hairline, a glasses arm by the
 * frame). Pieces under `minPixels` are speckle.
 */
export const partPieces = (mask: Uint8Array, width: number, height: number, options: { minPixels: number; share: number; reach: number }) => {
  const pieces = components(mask, width, height).filter((piece) => piece.length >= options.minPixels);
  const largest = Math.max(0, ...pieces.map((piece) => piece.length));
  const major = new Uint8Array(mask.length);
  const minor: Array<Array<number>> = [];
  for (const piece of pieces) {
    if (piece.length >= largest * options.share) for (const p of piece) major[p] = 1;
    else minor.push(piece);
  }
  const near = dilate(major, width, height, options.reach);
  const out = Uint8Array.from(major);
  for (const piece of minor) if (piece.some((p) => near[p])) for (const p of piece) out[p] = 1;
  return out;
};

/** The pixels outside `mask` that the zone's border can't reach without crossing it: the mask's holes (8-connected walls). */
export const enclosed = (mask: Uint8Array, width: number, height: number) => {
  const reached = new Uint8Array(mask.length);
  const stack: Array<number> = [];
  const visit = (p: number) => {
    if (mask[p] || reached[p]) return;
    reached[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (y > 0) visit(p - width);
    if (y < height - 1) visit(p + width);
  }
  return Uint8Array.from(mask, (m, p) => (m || reached[p] ? 0 : 1));
};

/** Box sums through an integral image: the mean of `values` (stride `channels`) in a (2r+1)² window, clamped. */
export const boxSum = (values: Float64Array, channels: number, width: number, height: number, r: number) => {
  const W = width + 1;
  const integral = new Float64Array(W * (height + 1) * channels);
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < channels; c++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        row += values[(y * width + x) * channels + c]!;
        integral[((y + 1) * W + x + 1) * channels + c] = integral[(y * W + x + 1) * channels + c]! + row;
      }
    }
  }
  const out = new Float64Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(width, x + r + 1);
      for (let c = 0; c < channels; c++) {
        out[(y * width + x) * channels + c] =
          integral[(y1 * W + x1) * channels + c]! - integral[(y0 * W + x1) * channels + c]! - integral[(y1 * W + x0) * channels + c]! + integral[(y0 * W + x0) * channels + c]!;
      }
    }
  }
  return out;
};

/**
 * Cuts the part out of `edit` (already the base's size) within `zone`. See the file comment for the steps.
 */
/**
 * Segments, mattes, and unmixes the part inside the zone: `base` and `edit` are the zone's crops, the edit aligned
 * and colour-matched. `r` scales a radius given at 1024 px to the full picture.
 */
const matteZone = (base: Rgb, edit: Rgb, scale: number) => {
  const { width, height } = base;
  const n = width * height;
  const r = (radius: number) => Math.max(1, Math.round(radius * scale));
  const B = base.data;
  const C = edit.data;
  const diff = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 3;
    diff[p] = Math.max(Math.abs(C[i]! - B[i]!), Math.abs(C[i + 1]! - B[i + 1]!), Math.abs(C[i + 2]! - B[i + 2]!));
  }
  const above = (threshold: number) => Uint8Array.from(diff, (d) => (d > threshold ? 1 : 0));

  // Segment: what changed clearly (the prior), what certainly belongs to the part, and what may.
  // Pieces of the change, not an opening, separate the part from noise: an opening erases glasses frames two pixels
  // wide, while redrawn face lines are thin too but far smaller than the part and apart from it.
  // A pixel is new only if nothing within a couple of pixels of it in the base looks like it: line work the model
  // moved by a pixel or two exists nearby, a hairstyle drawn over skin doesn't.
  const reachBack = Math.max(2, r(2));
  const changed = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (diff[p]! <= CHANGED) continue;
    const x = p % width;
    const y = (p - x) / width;
    let nearest = Infinity;
    for (let dy = -reachBack; dy <= reachBack && nearest > CHANGED; dy++) {
      const qy = y + dy;
      if (qy < 0 || qy >= height) continue;
      for (let dx = -reachBack; dx <= reachBack; dx++) {
        const qx = x + dx;
        if (qx < 0 || qx >= width) continue;
        const i = p * 3, j = (qy * width + qx) * 3;
        const d = Math.max(Math.abs(C[i]! - B[j]!), Math.abs(C[i + 1]! - B[j + 1]!), Math.abs(C[i + 2]! - B[j + 2]!));
        if (d < nearest) nearest = d;
      }
    }
    changed[p] = nearest > CHANGED ? 1 : 0;
  }
  const pieces = partPieces(changed, width, height, { minPixels: Math.max(8, Math.round(40 * scale * scale)), share: 0.03, reach: Math.max(4, r(8)) });
  // Two pixels at least: an anti-aliased edge is that wide at any resolution, and its pixels are not opaque.
  const sure = erode(above(SURE), width, height, Math.max(2, r(2)));
  const near = dilate(above(NEAR), width, height, r(3));
  // The part's opaque mass with its narrow gaps closed: where the part covers base line work of nearly its own colour
  // (dark hair over a dark outline), the change is too small to measure, but the part is still there.
  const mass = erode(dilate(sure, width, height, r(8)), width, height, r(8));
  // The base shows through the part's own holes (a glasses lens, a loop of hair), so what the model redrew there
  // (the eyes behind the lenses, moved by a few pixels) isn't the part: drop the pieces the part encloses, and matte
  // inside a hole only right at its rim.
  const solid = Uint8Array.from(pieces, (c, p) => (c || mass[p] ? 1 : 0));
  const holes = enclosed(solid, width, height);
  const outside = dilate(Uint8Array.from(solid, (s, p) => (s || holes[p] ? 0 : 1)), width, height, 1);
  const core = new Uint8Array(n);
  for (const island of components(solid, width, height)) {
    const open = island.some((p) => outside[p]);
    for (const p of island) {
      if (open) core[p] = pieces[p]!;
      else holes[p] = 1;
    }
  }
  const rim = dilate(core, width, height, Math.max(2, r(2)));
  const allowed = Uint8Array.from(dilate(core, width, height, r(8)), (a, p) => (a && (!holes[p] || rim[p]) ? 1 : 0));

  // The part's colour near each pixel, filled outward at growing radii (normalized convolution). Opaque interior
  // pixels come first: a thin half-transparent strand's own colour is a blend, and taking it as the part's colour
  // would make the strand opaque. Only where no interior is near (a lone glasses frame) do pixels that changed a
  // lot stand in.
  const estimate = new Float32Array(n * 3);
  const estimated = new Uint8Array(n);
  const fill = (sampleWeight: (p: number) => number) => {
    const weight = new Float64Array(n);
    const weighted = new Float64Array(n * 3);
    for (let p = 0; p < n; p++) {
      const w = core[p] ? sampleWeight(p) : 0;
      weight[p] = w;
      for (let c = 0; c < 3; c++) weighted[p * 3 + c] = w * C[p * 3 + c]!;
    }
    for (const radius of [4, 12, 36, 108].map(r)) {
      const sums = boxSum(weighted, 3, width, height, radius);
      const weights = boxSum(weight, 1, width, height, radius);
      for (let p = 0; p < n; p++) {
        if (estimated[p] || weights[p]! < 0.5) continue;
        for (let c = 0; c < 3; c++) estimate[p * 3 + c] = sums[p * 3 + c]! / weights[p]!;
        estimated[p] = 1;
      }
    }
  };
  // The body comes before the rest of the interior: strands at a hairline are fine dark lines blended with the skin
  // behind them, and sampled there the part's colour would come out as pale as they are (Paper Boat v3, 2026-11-19).
  const body = erode(sure, width, height, r(6));
  fill((p) => (body[p] ? 1 : 0));
  fill((p) => (sure[p] ? 1 : 0));
  fill((p) => clamp01((diff[p]! - CHANGED) / (SURE - CHANGED)) ** 2);

  // Matte: project the change onto the direction from the base to the part's colour.
  const alpha = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    if (!allowed[p]) continue;
    if (sure[p] && core[p]) {
      alpha[p] = 1;
      continue;
    }
    const i = p * 3;
    if (mass[p] && estimated[p]) {
      const likePart = Math.max(Math.abs(C[i]! - estimate[i]!), Math.abs(C[i + 1]! - estimate[i + 1]!), Math.abs(C[i + 2]! - estimate[i + 2]!));
      if (likePart < 0.2) {
        alpha[p] = 1;
        continue;
      }
    }
    if (!near[p]) continue;
    if (!estimated[p]) {
      alpha[p] = core[p] ? 1 : 0;
      continue;
    }
    let dot = 0;
    let norm = 0;
    for (let c = 0; c < 3; c++) {
      const e = estimate[i + c]! - B[i + c]!;
      dot += (C[i + c]! - B[i + c]!) * e;
      norm += e * e;
    }
    // The part looks like the base here: the change can't be told from noise, so trust the segmentation.
    const a = norm < 0.06 * 0.06 ? (core[p] ? 1 : 0) : clamp01(dot / norm);
    alpha[p] = a < 0.03 ? 0 : a;
  }

  // Near the part's edge, outside its body, alpha is the projection alone. The rules above call a strand opaque
  // when it changed clearly or looks like the part nearby, but a hairline strand blended with the skin behind it is
  // only partly the part: kept opaque, its light tone becomes a grey line under a dark hair colour on dark skin.
  const edge = Uint8Array.from(dilate(Uint8Array.from(alpha, (a) => (a === 0 ? 1 : 0)), width, height, Math.max(3, r(12))), (e, p) => (e && !body[p] ? 1 : 0));
  for (let p = 0; p < n; p++) {
    if (!edge[p] || alpha[p] === 0 || !estimated[p]) continue;
    const i = p * 3;
    let dot = 0;
    let norm = 0;
    for (let c = 0; c < 3; c++) {
      const e = estimate[i + c]! - B[i + c]!;
      dot += (C[i + c]! - B[i + c]!) * e;
      norm += e * e;
    }
    if (norm < 0.06 * 0.06) continue;
    const a = clamp01(dot / norm);
    alpha[p] = a < 0.03 ? 0 : a;
  }

  // Unmix: F = (C − (1 − a)·B) / a, with the estimate where alpha is too small to divide by.
  const colour = new Float32Array(n * 3);
  let recompositeSum = 0;
  let alphaPixels = 0;
  let opaquePixels = 0;
  for (let p = 0; p < n; p++) {
    const a = alpha[p]!;
    const i = p * 3;
    if (a > 0) {
      alphaPixels++;
      if (a >= 0.95) opaquePixels++;
      for (let c = 0; c < 3; c++) {
        colour[i + c] = a > 0.05 ? clamp01((C[i + c]! - (1 - a) * B[i + c]!) / a) : estimated[p] ? estimate[i + c]! : C[i + c]!;
      }
    }
    for (let c = 0; c < 3; c++) recompositeSum += Math.abs(a * colour[i + c]! + (1 - a) * B[i + c]! - C[i + c]!);
  }

  return { alpha, colour, recompositeError: (recompositeSum / Math.max(1, n * 3)) * 255, alphaPixels, opaquePixels };
};

const crop = (image: Rgb, [x0, y0, x1, y1]: PixelRect): Rgb => {
  const width = x1 - x0;
  const data = new Float32Array(width * (y1 - y0) * 3);
  for (let y = y0; y < y1; y++) data.set(image.data.subarray((y * image.width + x0) * 3, (y * image.width + x1) * 3), (y - y0) * width * 3);
  return { width, height: y1 - y0, data };
};

/**
 * Cuts the part out of `edit` (already the base's size) within `zone`. See the file comment for the steps. Only
 * alignment and colour matching look at the whole picture; the rest runs on the zone, which keeps memory and time
 * down at print sizes.
 */
export const cutOutPart = (base: Rgb, rawEdit: Rgb, zone: PixelRect): CutOut => {
  const { width, height } = base;
  if (rawEdit.width !== width || rawEdit.height !== height) throw new Error("cutOutPart: the edit must be the base's size");
  const scale = Math.max(width, height) / 1024;

  // Match colours first so a global re-tone doesn't hide the shift, then refit on the aligned edit.
  const shift = findShift(base, colourMatch(base, rawEdit, zone).image, zone);
  const { image: edit, fit } = colourMatch(base, shiftImage(rawEdit, shift[0], shift[1]), zone);

  let outsideSum = 0;
  let outsideCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inRect(zone, x, y)) continue;
      const i = (y * width + x) * 3;
      outsideSum += (Math.abs(edit.data[i]! - base.data[i]!) + Math.abs(edit.data[i + 1]! - base.data[i + 1]!) + Math.abs(edit.data[i + 2]! - base.data[i + 2]!)) / 3;
      outsideCount++;
    }
  }

  const [zx0, zy0, zx1, zy1] = [Math.max(0, zone[0]), Math.max(0, zone[1]), Math.min(width, zone[2]), Math.min(height, zone[3])];
  const inside = matteZone(crop(base, [zx0, zy0, zx1, zy1]), crop(edit, [zx0, zy0, zx1, zy1]), scale);
  const alpha = new Float32Array(width * height);
  const colour = new Float32Array(width * height * 3);
  const zoneWidth = zx1 - zx0;
  for (let y = zy0; y < zy1; y++) {
    alpha.set(inside.alpha.subarray((y - zy0) * zoneWidth, (y - zy0 + 1) * zoneWidth), y * width + zx0);
    colour.set(inside.colour.subarray((y - zy0) * zoneWidth * 3, (y - zy0 + 1) * zoneWidth * 3), (y * width + zx0) * 3);
  }

  let border = 0;
  let touching = 0;
  for (let y = zy0; y < zy1; y++) {
    for (let x = zx0; x < zx1; x++) {
      // Edges of the zone that are also edges of the picture can't cut a part off.
      const onBorder = (x === zx0 && zx0 > 0) || (x === zx1 - 1 && zx1 < width) || (y === zy0 && zy0 > 0) || (y === zy1 - 1 && zy1 < height);
      if (!onBorder) continue;
      border++;
      if (alpha[y * width + x]! >= 0.5) touching++;
    }
  }

  return {
    alpha,
    colour,
    metrics: {
      shift,
      colourFit: fit.map(([gain, offset]) => [Number(gain.toFixed(4)), Number(offset.toFixed(4))] as const),
      outsideChange: Number(((outsideSum / Math.max(1, outsideCount)) * 255).toFixed(2)),
      recompositeError: Number(inside.recompositeError.toFixed(2)),
      alphaPixels: inside.alphaPixels,
      opaquePixels: inside.opaquePixels,
      zoneEdgeContact: Number((touching / Math.max(1, border)).toFixed(3)),
    },
  };
};

/**
 * crownGap above this leaves bald scalp a reader sees on the page. Measured 2026-11-19 on every hair part of the
 * sample stories: those above 9 (10.0–27.6) all show scalp on the lightest or darkest skin; the rest are at most 7.6.
 */
export const CROWN_GAP_LIMIT = 9;

/**
 * Bald scalp a hair part leaves showing above it, where the model drew the hair smaller than the bald head (the
 * edit left the crown as it was, so the cut-out has nothing there). In each column the part covers, the run of the
 * base's skin directly above the part's top, less an outline's width (1% of the part's width); the mean run per
 * column, in thousandths of the part's width. A hairline isn't counted (the part lies above the forehead), nor
 * ears or hands beside the hair (no part under them in the column), nor runs longer than 15% of the part's width.
 * `skinMask` is the base's mask at the part's canvas size, 0..255.
 */
export const crownGap = (alpha: Float32Array, skinMask: Uint8Array, width: number, height: number) => {
  const tops: Array<number> = [];
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height && alpha[y * width + x]! < 0.5) y++;
    if (y < height) tops.push(y * width + x);
  }
  if (tops.length === 0) return 0;
  const partWidth = (tops.at(-1)! % width) - (tops[0]! % width) + 1;
  const outline = 0.01 * partWidth;
  const longest = 0.15 * partWidth;
  let sum = 0;
  for (const top of tops) {
    let run = 0;
    while (top - (run + 1) * width >= 0 && skinMask[top - (run + 1) * width]! >= 128) run++;
    if (run <= longest) sum += Math.max(0, run - outline);
  }
  return Number(((1000 * sum) / tops.length / partWidth).toFixed(2));
};

/** The bounding box of the pixels with alpha, grown by `pad` and clipped; null when there are none. */
export const alphaBounds = (alpha: Float32Array, width: number, height: number, pad = 2): PixelRect | null => {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]! <= 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(width, x1 + 1 + pad), Math.min(height, y1 + 1 + pad)];
};

/**
 * Turns a part's colours into the neutral tones a gradient-map palette expects (D26): luminance, shifted so the
 * part's median tone lands on `target` (0.40 is where the hair palettes put the hair colour), keeping its contrast.
 */
export const neutralize = (colour: Float32Array, alpha: Float32Array, target = 0.4) => {
  const tones = new Float32Array(alpha.length);
  const opaque: Array<number> = [];
  for (let p = 0; p < alpha.length; p++) {
    const i = p * 3;
    tones[p] = 0.2126 * colour[i]! + 0.7152 * colour[i + 1]! + 0.0722 * colour[i + 2]!;
    if (alpha[p]! >= 0.5) opaque.push(tones[p]!);
  }
  opaque.sort((a, b) => a - b);
  const median = opaque.length > 0 ? opaque[Math.floor(opaque.length / 2)]! : target;
  const out = new Float32Array(colour.length);
  for (let p = 0; p < alpha.length; p++) {
    const t = clamp01(tones[p]! + target - median);
    out[p * 3] = t;
    out[p * 3 + 1] = t;
    out[p * 3 + 2] = t;
  }
  return out;
};

/**
 * Which of a part's pixels are skin (D26, "split by region"): the model sometimes redraws skin inside a part, such as
 * an ear over a glasses arm or a forehead between strands, and those pixels must take the look's skin palette
 * like the base's skin does, or they show the base's tone on every skin. A pixel is skin when its unmixed colour is
 * within 3 standard deviations (Mahalanobis) of the colours inside the base's skin mask. The mask is eroded first:
 * its edge holds outline pixels, and a brown outline would make brown hair look like skin. Only pixels inside the
 * mask can be skin, and specks and thin streaks of skin colour (highlights) are left to the part unless `everySpeck`.
 */
export const skinPixels = (
  colour: Float32Array,
  alpha: Float32Array,
  base: Rgb,
  skinMask: Uint8Array,
  minPixels: number,
  everySpeck = false,
): Uint8Array => {
  const { width, height } = base;
  const n = alpha.length;
  const interior = erode(Uint8Array.from(skinMask, (m) => (m >= 128 ? 1 : 0)), width, height, Math.max(3, Math.round((3 * Math.max(width, height)) / 1024)));
  const mean = [0, 0, 0];
  let count = 0;
  for (let p = 0; p < n; p++) {
    if (!interior[p]) continue;
    for (let c = 0; c < 3; c++) mean[c]! += base.data[p * 3 + c]!;
    count++;
  }
  if (count < 100) return new Uint8Array(n);
  for (let c = 0; c < 3; c++) mean[c]! /= count;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let p = 0; p < n; p++) {
    if (!interior[p]) continue;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j]! += (base.data[p * 3 + i]! - mean[i]!) * (base.data[p * 3 + j]! - mean[j]!);
  }
  // A floor on the variance: flat colour would otherwise make every re-rendered skin pixel an outlier.
  for (let k = 0; k < 9; k++) cov[k] = cov[k]! / count + (k % 4 === 0 ? 0.03 * 0.03 : 0);
  const [a, b, c, d, e, f, g, h, i] = cov as [number, number, number, number, number, number, number, number, number];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inv = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d].map((v) => v / det);
  const found = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    // Skin the model redraws is skin the base had: highlights in hair above the scalp are hair, whatever their colour.
    if (alpha[p]! < 0.3 || skinMask[p]! < 128) continue;
    const v = [colour[p * 3]! - mean[0]!, colour[p * 3 + 1]! - mean[1]!, colour[p * 3 + 2]! - mean[2]!];
    let d2 = 0;
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) d2 += v[r]! * inv[r * 3 + s]! * v[s]!;
    found[p] = d2 < 9 ? 1 : 0;
  }
  if (everySpeck) return found;
  // Redrawn skin comes in patches (an ear, a forehead between strands); thin streaks of skin colour are highlights
  // in the part. A piece counts when it is big enough and thick enough to survive an erosion.
  const thick = erode(found, width, height, Math.max(3, Math.round((3 * Math.max(width, height)) / 1024)));
  const kept = new Uint8Array(n);
  for (const piece of components(found, width, height)) {
    if (piece.length >= minPixels && piece.some((p) => thick[p])) for (const p of piece) kept[p] = 1;
  }
  return kept;
};
