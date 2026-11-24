import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { PhotoReport } from "../src/contracts.ts";
import { fitFigure } from "../src/figure.ts";
import { judgePhoto } from "../src/photo-check.ts";

const report = (overrides: Partial<PhotoReport> = {}): PhotoReport => ({
  moderation: { sexual: 0, violence: 0, selfHarm: 0 },
  prominentFaces: 1,
  backgroundFaces: 0,
  mainFaceVisible: true,
  mainFaceWidthPx: 300,
  sharpness: "sharp",
  lighting: "good",
  occlusions: [],
  apparentAge: "young-child",
  hairColour: "brown",
  facialHair: "none",
  tip: "",
  ...overrides,
});
const child = { ages: ["young-child", "older-child"] as const };
const brown = { colour: "brown", length: "short", texture: "straight" } as const;
const codes = (result: ReturnType<typeof judgePhoto>) => ({
  status: result.status,
  refusals: result.refusals.map((issue) => issue.code),
  warnings: result.warnings.map((issue) => issue.code),
});

describe("judgePhoto", () => {
  it("passes a photo with bystanders, and refuses a second prominent face", () => {
    expect(codes(judgePhoto(report({ backgroundFaces: 6 }), child, brown))).toEqual({
      status: "passed",
      refusals: [],
      warnings: [],
    });
    expect(codes(judgePhoto(report({ prominentFaces: 2 }), child, brown)).refusals).toEqual(["two-faces"]);
  });

  it("refuses at the per-category moderation thresholds, not below them", () => {
    // The spike's pool table: violence 0.40 is fine; sexual refuses from 0.3, violence and self-harm from 0.8.
    expect(
      judgePhoto(report({ moderation: { sexual: 0.29, violence: 0.79, selfHarm: 0.4 } }), child, brown).status,
    ).toBe("passed");
    for (const moderation of [
      { sexual: 0.3, violence: 0, selfHarm: 0 },
      { sexual: 0, violence: 0.8, selfHarm: 0 },
      { sexual: 0, violence: 0, selfHarm: 0.8 },
    ])
      expect(codes(judgePhoto(report({ moderation }), child, brown)).refusals).toEqual(["moderation"]);
  });

  it("refuses a face under 150 px or blurred, with no minimum image size", () => {
    expect(judgePhoto(report({ mainFaceWidthPx: 150 }), child, brown).status).toBe("passed");
    expect(codes(judgePhoto(report({ mainFaceWidthPx: 149 }), child, brown)).refusals).toEqual(["small-face"]);
    expect(codes(judgePhoto(report({ sharpness: "blurred" }), child, brown)).refusals).toEqual(["blurred"]);
    expect(judgePhoto(report({ sharpness: "soft" }), child, brown).status).toBe("passed");
  });

  it("warns on hair two steps from the chips, not one, and on an age far from the role's", () => {
    // Lighting moves hair a step: light brown next to brown passes quietly; blond is three steps off.
    expect(codes(judgePhoto(report({ hairColour: "light-brown" }), child, brown)).warnings).toEqual([]);
    expect(codes(judgePhoto(report({ hairColour: "blond" }), child, brown)).warnings).toEqual(["hair"]);
    expect(codes(judgePhoto(report({ hairColour: "auburn" }), child, brown)).warnings).toEqual([]);
    // An adult's photo for a child's role still passes (the sheet draws them as a child), with a warning.
    expect(codes(judgePhoto(report({ apparentAge: "adult" }), child, brown))).toEqual({
      status: "passed",
      refusals: [],
      warnings: ["age"],
    });
  });
});

/** An RGBA canvas with opaque rectangles of a colour, as raw pixels or PNG. */
const canvas = async (
  size: { width: number; height: number },
  rects: ReadonlyArray<{ left: number; top: number; width: number; height: number; rgb: [number, number, number] }>,
) => {
  const layers = await Promise.all(
    rects.map(async ({ left, top, width, height, rgb: [r, g, b] }) => ({
      input: await sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } } })
        .png()
        .toBuffer(),
      left,
      top,
    })),
  );
  return sharp({ create: { ...size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
};

describe("fitFigure", () => {
  const size = { width: 200, height: 300 };
  const window = [0, 0, 1000, 1000] as const;
  // The bald figure: a 60×200 body at (70, 60); its head the top 50 px.
  const baldRect = { left: 70, top: 60, width: 60, height: 200 };
  const head = [350, 200, 650, 367] as const;

  it("clips what the model drew outside the keep zone, keeps the hair zone, and tints to the bald figure", async () => {
    const bald = await sharp(await canvas(size, [{ ...baldRect, rgb: [100, 80, 60] }]))
      .raw()
      .toBuffer();
    const output = await canvas(size, [
      // The figure itself, in another colour.
      { ...baldRect, rgb: [200, 200, 200] },
      // Hair above the head, inside the hair zone (head box grown 40% up).
      { left: 80, top: 45, width: 40, height: 15, rgb: [200, 200, 200] },
      // A second Tiny: inside the figure's box margin but well away from its body.
      { left: 160, top: 220, width: 30, height: 30, rgb: [200, 200, 200] },
    ]);
    const fitted = await fitFigure({ output, bald, head: [...head], window: [...window], size, tint: true });
    const pixels = await sharp(fitted.png).raw().toBuffer();
    const at = (x: number, y: number) => [...pixels.subarray((y * size.width + x) * 4, (y * size.width + x) * 4 + 4)];

    expect(at(175, 235)[3]).toBe(0);
    expect(at(100, 50)[3]).toBe(255);
    expect(fitted.clippedShare).toBeCloseTo(900 / (12000 + 600 + 900), 3);
    expect(fitted.rescaled).toBe(false);
    // A flat figure has no contrast to scale, so the tint moves it onto the bald figure's mean colour.
    expect(at(100, 150).slice(0, 3)).toEqual([100, 80, 60]);
  });

  it("rescales a figure drawn too small onto the bald figure's box, and refuses one without transparency", async () => {
    const bald = await sharp(await canvas(size, [{ ...baldRect, rgb: [100, 80, 60] }]))
      .raw()
      .toBuffer();
    const small = await canvas(size, [{ left: 85, top: 160, width: 30, height: 100, rgb: [100, 80, 60] }]);
    const fitted = await fitFigure({ output: small, bald, head: [...head], window: [...window], size, tint: false });
    expect(fitted.rescaled).toBe(true);
    expect(fitted.iou).toBeGreaterThan(0.95);

    const opaque = await sharp({ create: { ...size, channels: 4, background: "#fff" } })
      .png()
      .toBuffer();
    await expect(
      fitFigure({ output: opaque, bald, head: [...head], window: [...window], size, tint: true }),
    ).rejects.toThrow("no transparent background");
  });
});
