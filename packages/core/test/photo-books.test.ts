import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { lookOf, type PhotoReport } from "../src/contracts.ts";
import { fitFigure } from "../src/figure.ts";
import { judgePhoto } from "../src/photo-check.ts";
import { hairWords, lookWords, photoPrompts } from "../src/photo-prompts.ts";
import { uploadRefusal } from "../src/photo-uploads.ts";

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
const codes = (result: ReturnType<typeof judgePhoto>) => ({
  status: result.status,
  refusals: result.refusals.map((issue) => issue.code),
  warnings: result.warnings.map((issue) => issue.code),
});

describe("judgePhoto", () => {
  it("passes a photo with bystanders, and refuses a second prominent face", () => {
    expect(codes(judgePhoto(report({ backgroundFaces: 6 }), child))).toEqual({
      status: "passed",
      refusals: [],
      warnings: [],
    });
    expect(codes(judgePhoto(report({ prominentFaces: 2 }), child)).refusals).toEqual(["two-faces"]);
  });

  it("refuses at the per-category moderation thresholds, not below them", () => {
    // The spike's pool table: violence 0.40 is fine; sexual refuses from 0.3, violence and self-harm from 0.8.
    expect(judgePhoto(report({ moderation: { sexual: 0.29, violence: 0.79, selfHarm: 0.4 } }), child).status).toBe(
      "passed",
    );
    for (const moderation of [
      { sexual: 0.3, violence: 0, selfHarm: 0 },
      { sexual: 0, violence: 0.8, selfHarm: 0 },
      { sexual: 0, violence: 0, selfHarm: 0.8 },
    ])
      expect(codes(judgePhoto(report({ moderation }), child)).refusals).toEqual(["moderation"]);
  });

  it("refuses a face under 150 px or blurred, with no minimum image size", () => {
    expect(judgePhoto(report({ mainFaceWidthPx: 150 }), child).status).toBe("passed");
    expect(codes(judgePhoto(report({ mainFaceWidthPx: 149 }), child)).refusals).toEqual(["small-face"]);
    expect(codes(judgePhoto(report({ sharpness: "blurred" }), child)).refusals).toEqual(["blurred"]);
    expect(judgePhoto(report({ sharpness: "soft" }), child).status).toBe("passed");
  });

  it("refuses an extra photo of someone else, and says nothing when there was no main photo to compare", () => {
    expect(codes(judgePhoto(report({ samePerson: false }), child)).refusals).toEqual(["other-person"]);
    expect(judgePhoto(report({ samePerson: true }), child).status).toBe("passed");
    expect(judgePhoto(report(), child).status).toBe("passed");
  });

  it("warns on an age far from the role's", () => {
    // An adult's photo for a child's role still passes (the sheet draws them as a child), with a warning.
    expect(codes(judgePhoto(report({ apparentAge: "adult" }), child))).toEqual({
      status: "passed",
      refusals: [],
      warnings: ["age"],
    });
  });

  it("warns when the photo looks like another age the role accepts than the one chosen (a toddler chosen as six)", () => {
    const wide = { ages: ["toddler", "young-child", "older-child"] as const };
    const toddler = judgePhoto(report({ apparentAge: "toddler" }), { ...wide, chosen: "young-child" });
    expect(codes(toddler).warnings).toEqual(["age"]);
    expect(toddler.warnings[0]!.message).toContain("looks like a toddler (1–3), but you chose young child (3–7)");
    expect(codes(judgePhoto(report({ apparentAge: "toddler" }), { ...wide, chosen: "toddler" })).warnings).toEqual([]);
    // One step off but outside the role's ages: no nudge to an age the role can't take.
    expect(codes(judgePhoto(report({ apparentAge: "toddler" }), { ...child, chosen: "young-child" })).warnings).toEqual(
      [],
    );
  });
});

describe("the look a sheet draws", () => {
  const photo = {
    hairColour: "blond",
    hairLength: "long",
    hairTexture: null,
    eyeColour: "blue",
    skinTone: "light",
    glasses: true,
    freckles: null,
  } as const;

  it("takes the parent's choice over the photo, a false one included, and keeps unknowns unknown", () => {
    // Lucy's case: the photo read long hair, the parent says short; and the parent says no glasses.
    const look = lookOf(photo, { hairLength: "short", glasses: false });
    expect(look).toEqual({ ...photo, hairLength: "short", glasses: false });
    // A report stored before the look was read has only the hair colour.
    expect(lookOf({ hairColour: "brown" }, {})).toMatchObject({
      hairColour: "brown",
      hairLength: null,
      eyeColour: null,
    });
    expect(lookOf(null, { freckles: true }).freckles).toBe(true);
  });

  it("names the extra photos in the sheet prompt only when there are some", () => {
    const style = { styleReference: "style.png", styleWords: "pencil", promptVersion: "photo-hero-v3" } as const;
    const base = { style, age: "toddler", outfit: "pyjamas", look: lookOf(null, {}) } as const;
    const sheet = photoPrompts["photo-hero-v3"].sheet;
    expect(sheet(base)).toMatch(/^The first image is a photo of a person\. The second image/);
    expect(sheet({ ...base, extraPhotos: 2 })).toMatch(/^The first 3 images are photos of the same person/);
    expect(sheet({ ...base, extraPhotos: 2 })).toContain("from the photos so");
  });

  it("says only what's known, and a bald head without colour", () => {
    const look = lookOf(photo, { hairLength: "short", glasses: false });
    expect(hairWords(look)).toBe("short, blond hair");
    expect(lookWords(look)).toBe(" Eyes: blue. Skin tone: light. No glasses.");
    expect(hairWords(lookOf(photo, { hairLength: "none" }))).toBe("no hair (bald)");
    expect(hairWords(lookOf(null, {}))).toBe("the hair as in the photo");
    expect(lookWords(lookOf(null, {}))).toBe("");
  });
});

describe("v3 figure prompts", () => {
  it("name the expressions image only when the person has one, so an older sheet's call isn't told of a missing image", () => {
    const style = { styleReference: "style.png", styleWords: "pencil", promptVersion: "photo-hero-v3" } as const;
    const figure = photoPrompts["photo-hero-v3"].figure;
    expect(figure({ style, expressions: true })).toContain("the third shows the same character's face");
    expect(figure({ style })).not.toContain("third");
    expect(figure({ style })).not.toContain("expression");
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

  it("keeps long hair below the head, fades an arm reaching past the backstop, and reports running off the window", async () => {
    const bald = await sharp(await canvas(size, [{ ...baldRect, rgb: [100, 80, 60] }]))
      .raw()
      .toBuffer();
    const output = await canvas(size, [
      { ...baldRect, rgb: [200, 200, 200] },
      // Long hair hanging beside the body, well below the head: attached, outside the bald outline.
      { left: 50, top: 60, width: 20, height: 120, rgb: [200, 200, 200] },
      // An arm reaching to the canvas edge, past the backstop (bald figure + 25% of its larger side = x 180).
      { left: 130, top: 100, width: 70, height: 20, rgb: [200, 200, 200] },
    ]);
    const fitted = await fitFigure({ output, bald, head: [...head], window: [...window], size, tint: false });
    const pixels = await sharp(fitted.png).raw().toBuffer();
    const alpha = (x: number, y: number) => pixels[(y * size.width + x) * 4 + 3]!;

    expect(alpha(52, 170)).toBe(255);
    expect(alpha(150, 110)).toBe(255);
    expect(alpha(195, 110)).toBe(0);
    // No straight cut: the arm fades out across the backstop's edge.
    expect([176, 177, 178, 179, 180, 181].some((x) => alpha(x, 110) > 0 && alpha(x, 110) < 255)).toBe(true);
    expect(fitted.offWindow).toBe(true);
    expect(fitted.clippedShare).toBeGreaterThan(0);
    expect(fitted.clippedShare).toBeLessThan(0.05);
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

describe("uploadRefusal", () => {
  // Small, uneven limits so each boundary is its own number: 3 in 10 minutes, 5 before a book qualifies, 4 more each.
  const limits = { burst: { count: 3, windowMs: 10 * 60_000 }, allowance: 5, perQualifyingBook: 4 } as const;
  const now = new Date("2026-11-25T12:00:00Z");
  const usage = (total: number, recent: number, qualifyingBooks = 0, oldestMinutesAgo = 7) => ({
    total,
    recent,
    oldestRecentAt: recent > 0 ? new Date(now.getTime() - oldestMinutesAgo * 60_000) : null,
    qualifyingBooks,
  });

  it("allows up to the burst, then says when the oldest upload in the window frees a slot", () => {
    expect(uploadRefusal(usage(2, 2), now, limits)).toBeNull();
    const refused = uploadRefusal(usage(3, 3, 0, 7.5), now, limits)!;
    // The oldest is 7.5 minutes old in a 10-minute window: free in 150 s, said as 3 minutes.
    expect(refused.retryAfterSeconds).toBe(150);
    expect(refused.message).toBe("You've added 3 photos in the last 10 minutes. Try again in 3 minutes.");
    expect(uploadRefusal(usage(3, 3, 0, 9.99), now, limits)!.message).toMatch(/Try again in a minute\.$/);
  });

  it("caps the total, raised by each qualifying book, and says so rather than to wait", () => {
    expect(uploadRefusal(usage(4, 0), now, limits)).toBeNull();
    const capped = uploadRefusal(usage(5, 3), now, limits)!;
    expect(capped.retryAfterSeconds).toBeNull();
    expect(capped.message).toMatch(/^You've used all 5 photo uploads this account has\. Each book we approve adds 4/);
    expect(uploadRefusal(usage(8, 0, 1), now, limits)).toBeNull();
    expect(uploadRefusal(usage(9, 0, 1), now, limits)!.message).toMatch(/all 9 photo uploads/);
    expect(uploadRefusal(usage(12, 0, 2), now, limits)).toBeNull();
  });
});
