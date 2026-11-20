import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { paletteAt, recolour } from "../src/looks/recolour.ts";

const png = (pixels: ReadonlyArray<readonly [number, number, number, number]>) =>
  sharp(Buffer.from(pixels.flat()), { raw: { width: pixels.length, height: 1, channels: 4 } })
    .png()
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));

const pixelsOf = async (body: Uint8Array) => {
  const data = await sharp(body).ensureAlpha().raw().toBuffer();
  return Array.from({ length: data.length / 4 }, (_, p) => Array.from(data.subarray(p * 4, p * 4 + 4)));
};

// Black to pure green: a pixel's grey tone t becomes (0, t, 0).
const green = [
  { at: 1, colour: "#00ff00" },
  { at: 0, colour: "#000000" },
] as const;

describe("recolour (gradient-map-v1)", () => {
  it("maps each pixel's tone through the palette inside the mask, blends soft mask edges, and keeps alpha", async () => {
    const asset = await png([
      [200, 200, 200, 255], // in the mask: tone 200 -> (0, 200, 0)
      [200, 200, 200, 255], // outside the mask: unchanged
      [100, 100, 100, 128], // half-covered by the mask: halfway from (100, 100, 100) to (0, 100, 0), alpha kept
    ]);
    const mask = await png([
      [255, 255, 255, 255],
      [0, 0, 0, 0],
      [255, 255, 255, 128],
    ]);

    expect(await pixelsOf(await recolour(asset, [{ mask, palette: green }]))).toEqual([
      [0, 200, 0, 255],
      [200, 200, 200, 255],
      [50, 100, 50, 128],
    ]);
  });

  it("gives the same bytes for the same inputs", async () => {
    const asset = await png([[90, 120, 150, 255]]);
    const [a, b] = await Promise.all([recolour(asset, [{ palette: green }]), recolour(asset, [{ palette: green }])]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("interpolates between unsorted stops and holds the end colours past them", () => {
    const palette = [
      { at: 0.75, colour: "#ffffff" },
      { at: 0.25, colour: "#000000" },
    ];
    expect(paletteAt(palette, 0.5)).toEqual([127.5, 127.5, 127.5]);
    expect(paletteAt(palette, 0.1)).toEqual([0, 0, 0]);
    expect(paletteAt(palette, 0.9)).toEqual([255, 255, 255]);
  });
});
