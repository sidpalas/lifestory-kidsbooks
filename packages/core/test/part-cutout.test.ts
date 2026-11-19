import { describe, expect, it } from "vitest";
import { cutOutPart, type PixelRect, type Rgb } from "../src/parts/cutout.ts";

// A synthetic edit with a known answer: a textured base B with a face, and a part with known alpha and colour (a
// hair cap with soft edges, thin opaque glasses frames, half-transparent wisps). The "model" output is
// a·F + (1 − a)·B, then shifted by (2, −1) px and re-toned (gain 0.96, offset +0.03), as providers do. The model also
// redraws a little of the face: its mouth line comes back 2 px lower, which is not part of the part.
const W = 320;
const H = 400;
const zone: PixelRect = [70, 20, 250, 260];

const scene = () => {
  const base = new Float32Array(W * H * 3);
  const alpha = new Float32Array(W * H);
  const colour = new Float32Array(W * H * 3);
  const glasses = new Uint8Array(W * H);
  const wisps = new Uint8Array(W * H);
  const mouth = new Uint8Array(W * H);
  const redrawn = new Float32Array(W * H * 3);
  const head = { x: 160, y: 140, r: 70 };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const i = p * 3;
      // Background texture, so alignment has something to lock onto.
      let rgb = [0.35 + 0.1 * Math.sin(x / 7) * Math.cos(y / 11), 0.45 + 0.08 * Math.sin((x + y) / 9), 0.7 + 0.05 * Math.cos(x / 5)];
      const inHead = Math.hypot(x - head.x, y - head.y) < head.r;
      if (inHead) rgb = [0.82, 0.68, 0.58];
      if (inHead && (Math.hypot(x - 135, y - 150) < 5 || Math.hypot(x - 185, y - 150) < 5)) rgb = [0.15, 0.1, 0.08];
      base.set(rgb, i);
      // The mouth: rows 184–185 in the base, 186–187 as the model redraws it.
      if (inHead && x >= 140 && x < 180 && y >= 182 && y < 190) mouth[p] = 1;
      const mouthLine = (top: number) => inHead && x >= 140 && x < 180 && (y === top || y === top + 1);
      if (mouthLine(184)) base.set([0.3, 0.12, 0.1], i);
      redrawn.set(mouthLine(186) ? [0.3, 0.12, 0.1] : mouthLine(184) ? [0.82, 0.68, 0.58] : base.subarray(i, i + 3), i);

      // Hair cap: the top of the head and a bit around it, with a 4 px soft edge, some texture in its colour.
      const capDistance = Math.max(Math.hypot(x - head.x, y - head.y) - (head.r + 6), y - 115);
      let a = Math.min(1, Math.max(0, (0 - capDistance) / 4 + 0.5));
      // Glasses: two rings 2 px thick around the eyes, opaque and dark.
      const ring = Math.min(Math.abs(Math.hypot(x - 135, y - 150) - 16), Math.abs(Math.hypot(x - 185, y - 150) - 16));
      if (ring < 1) {
        glasses[p] = 1;
        a = 1;
      }
      // Wisps: one-pixel strands hanging below the cap at half opacity.
      if (y > 118 && y < 135 && (x === 110 || x === 210 || x === 112)) {
        wisps[p] = 1;
        a = Math.max(a, 0.5);
      }
      alpha[p] = a;
      colour.set(glasses[p] ? [0.08, 0.08, 0.1] : [0.3 + 0.05 * Math.sin(y / 3), 0.22, 0.18], i);
    }
  }
  const raw = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // The model's output at (x, y) shows the scene at (x − 2, y + 1).
      const sx = Math.min(W - 1, Math.max(0, x - 2));
      const sy = Math.min(H - 1, Math.max(0, y + 1));
      const s = sy * W + sx;
      for (let c = 0; c < 3; c++) {
        const composite = alpha[s]! * colour[s * 3 + c]! + (1 - alpha[s]!) * redrawn[s * 3 + c]!;
        raw[(y * W + x) * 3 + c] = 0.96 * composite + 0.03;
      }
    }
  }
  return { base: { width: W, height: H, data: base } satisfies Rgb, edit: { width: W, height: H, data: raw } satisfies Rgb, alpha, colour, glasses, wisps, mouth };
};

const mean = (values: ReadonlyArray<number>) => values.reduce((a, b) => a + b, 0) / values.length;

describe("cutOutPart", () => {
  const truth = scene();
  const result = cutOutPart(truth.base, truth.edit, zone);
  const pixels = [...Array(W * H).keys()];
  const inZone = (p: number) => {
    const x = p % W, y = Math.floor(p / W);
    return x >= zone[0] && x < zone[2] && y >= zone[1] && y < zone[3];
  };

  it("undoes the model's shift and re-toning", () => {
    expect(result.metrics.shift).toEqual([-2, 1]);
    for (const [gain, offset] of result.metrics.colourFit) {
      expect(gain).toBeCloseTo(1 / 0.96, 2);
      expect(offset).toBeCloseTo(-0.03 / 0.96, 2);
    }
    expect(result.metrics.outsideChange).toBeLessThan(1);
  });

  it("recovers soft alpha, thin frames, and half-transparent wisps that a threshold would lose or harden", () => {
    // Away from the image edge the shift clamps, every zone pixel's alpha is close to the truth.
    const error = mean(pixels.filter((p) => inZone(p) && !truth.mouth[p]).map((p) => Math.abs(result.alpha[p]! - truth.alpha[p]!)));
    expect(error).toBeLessThan(0.02);
    expect(mean(pixels.filter((p) => truth.glasses[p]).map((p) => result.alpha[p]!))).toBeGreaterThan(0.9);
    const wispAlpha = mean(pixels.filter((p) => truth.wisps[p] && truth.alpha[p] === 0.5).map((p) => result.alpha[p]!));
    expect(wispAlpha).toBeGreaterThan(0.35);
    expect(wispAlpha).toBeLessThan(0.65);
    const softEdge = pixels.filter((p) => truth.alpha[p]! > 0.2 && truth.alpha[p]! < 0.8 && !truth.wisps[p]);
    expect(mean(softEdge.map((p) => Math.abs(result.alpha[p]! - truth.alpha[p]!)))).toBeLessThan(0.08);
  });

  it("keeps the face and the old skin out of the layer", () => {
    const strayAlpha = pixels.filter((p) => inZone(p) && truth.alpha[p] === 0 && result.alpha[p]! > 0.1);
    expect(strayAlpha.length).toBeLessThan(pixels.filter(inZone).length * 0.005);
    // The redrawn mouth changed as much as the hair did, but it is the model's noise, not the part.
    expect(Math.max(...pixels.filter((p) => truth.mouth[p]).map((p) => result.alpha[p]!))).toBe(0);
    // Unmixed colour is the part's, not skin blended in, even at the soft edge.
    const edge = pixels.filter((p) => truth.alpha[p]! >= 0.3 && truth.alpha[p]! < 1 && !truth.wisps[p] && !truth.glasses[p]);
    const colourError = mean(edge.map((p) => Math.abs(result.colour[p * 3]! - truth.colour[p * 3]!)));
    expect(colourError).toBeLessThan(0.05);
    expect(result.metrics.recompositeError).toBeLessThan(2);
  });

  it("finds nothing outside the zone even where the picture changed", () => {
    const outside = pixels.filter((p) => !inZone(p) && result.alpha[p]! > 0);
    expect(outside).toEqual([]);
  });
});
