// Importing art made outside the app: the base made from a coloured figure, and an import applied to a page.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { Page } from "../src/book-format/manifest.ts";
import { applyImport, type ImportResult } from "../src/imports/contract.ts";
import { makeBase } from "../src/imports/images.ts";

/**
 * A figure on transparency, 400 × 600: a warm-skinned face with dark eyes and two rose cheeks, a blue shirt, arms in
 * skin on both sides of the shirt, and a brown outline round the face.
 */
const figure = () =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">
  <circle cx="200" cy="150" r="104" fill="#6b4a30"/>
  <circle cx="200" cy="150" r="100" fill="#e0a77e"/>
  <circle cx="165" cy="130" r="9" fill="#1c1410"/><circle cx="235" cy="130" r="9" fill="#1c1410"/>
  <circle cx="150" cy="185" r="18" fill="#e3787a"/><circle cx="250" cy="185" r="18" fill="#e3787a"/>
  <rect x="60" y="270" width="50" height="220" fill="#e0a77e"/><rect x="290" y="270" width="50" height="220" fill="#e0a77e"/>
  <rect x="110" y="260" width="180" height="300" fill="#2e6fd0"/>
</svg>`),
  )
    .png()
    .toBuffer();

const pixels = async (png: Uint8Array) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { at: (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)], width: info.width };
};

describe("makeBase", () => {
  it("masks the skin and what it encloses but not the clothes, and moves blush to the overlay", async () => {
    const made = await makeBase(new Uint8Array(await figure()), { overlay: null, occluder: null });
    if ("error" in made) throw new Error(made.error);
    const mask = await pixels(made.skinMask);
    const base = await pixels(made.base);
    const overlay = await pixels(made.overlay!);
    const alpha = (image: Awaited<ReturnType<typeof pixels>>, x: number, y: number) => image.at(x, y)[3]!;

    // Skin: forehead, both arms; the eyes and cheeks it encloses (the gradient map keeps their tone); the outline.
    for (const [x, y] of [[200, 90], [85, 400], [315, 400], [165, 130], [150, 185], [200, 252]] as const) expect(alpha(mask, x, y), `${x},${y}`).toBeGreaterThan(200);
    // Not skin: the shirt between the arms, and the transparent paper.
    for (const [x, y] of [[200, 400], [150, 500], [20, 20]] as const) expect(alpha(mask, x, y), `${x},${y}`).toBeLessThan(30);

    // The skin is neutral grey at the palettes' skin tone (0.77, the starter palettes' stop), the shirt untouched.
    const [r, g, b] = base.at(200, 90);
    expect(Math.max(Math.abs(r! - g!), Math.abs(g! - b!))).toBeLessThan(3);
    expect(Math.abs(r! / 255 - 0.77)).toBeLessThan(0.03);
    expect(base.at(200, 400).slice(0, 3)).toEqual([0x2e, 0x6f, 0xd0]);

    // Blush is in the overlay, rose-coloured, and evened out in the base, so it doesn't darken twice on dark skin.
    expect(alpha(overlay, 150, 185)).toBeGreaterThan(80);
    const [or, og] = overlay.at(150, 185);
    expect(or! - og!).toBeGreaterThan(60);
    expect(alpha(overlay, 200, 90)).toBe(0);
    expect(alpha(overlay, 85, 400)).toBe(0);
    expect(Math.abs(base.at(150, 185)[0]! - base.at(200, 90)[0]!)).toBeLessThan(10);
  });
});

const result = (overrides: Partial<ImportResult>): ImportResult => ({
  storyId: "s",
  request: { kind: "page", pageId: "p01", slotId: "hero", age: "young-child", face: "face:round", hair: "hair:curly", bald: false, hairZone: [0, 0, 1000, 400], source: { kind: "flat", asset: "pages/p01/import/a.png", box: [0, 0, 500, 500], description: "her" }, seed: 1 },
  plate: "pages/p01/hero/import-1-plate.jpg",
  foreground: null,
  box: [100, 200, 400, 900],
  base: { age: "young-child", face: "face:round", asset: "new-base.png", skinMask: "new-skin.png" },
  parts: [{ age: "young-child", face: "face:round", axis: "hair", option: "hair:curly", asset: "new-curly.png", at: [0, 0, 1000, 300], palette: "hairColour", approved: false }],
  colourFigure: "c.png",
  review: { light: "l.png", dark: "d.png", mask: "m.png", plate: null },
  costUsd: 0,
  notes: [],
  ...overrides,
});

const adult = (features?: "features:soft") => ({ age: "adult" as const, face: "face:round" as const, asset: features ? "soft.png" : "defined.png", skinMask: "s.png", ...(features ? { features } : {}) });

describe("applyImport", () => {
  const page: Page = {
    pageId: "p01",
    layout: "full-bleed-art/text-bottom",
    text: [],
    illustration: {
      layers: [
        { kind: "art", asset: "old-plate.jpg" },
        {
          kind: "figure",
          slotId: "hero",
          box: [0, 0, 100, 100],
          bases: [
            { age: "young-child", face: "face:round", asset: "old-base.png", skinMask: "old-skin.png" },
            { age: "young-child", face: "face:oval", asset: "oval.png", skinMask: "oval-skin.png" },
          ],
          parts: [
            { age: "young-child", face: "face:round", axis: "hair", option: "hair:curly", asset: "old-curly.png", at: [0, 0, 10, 10], palette: "hairColour", approved: true },
            { age: "young-child", face: "face:oval", axis: "hair", option: "hair:curly", asset: "oval-curly.png", at: [0, 0, 10, 10], palette: "hairColour", approved: true },
          ],
        },
        { kind: "art", asset: "reeds.webp" },
      ],
    },
  };

  it("replaces the plate and this base's drawing and part, and keeps the other face's", () => {
    const [plate, hero, front] = applyImport(page, result({})).illustration.layers;
    expect(plate).toEqual({ kind: "art", asset: "pages/p01/hero/import-1-plate.jpg" });
    expect(front).toEqual({ kind: "art", asset: "reeds.webp" });
    if (hero?.kind !== "figure") throw new Error("no figure");
    expect(hero.box).toEqual([100, 200, 400, 900]);
    expect(hero.bases.map((base) => base.asset).toSorted()).toEqual(["new-base.png", "oval.png"]);
    expect(hero.parts.map((part) => part.asset).toSorted()).toEqual(["new-curly.png", "oval-curly.png"]);
  });

  it("puts a new role's figure above the plate and below the foreground, and a derived base keeps the box", () => {
    const empty: Page = { ...page, illustration: { layers: [{ kind: "art", asset: "old-plate.jpg" }] } };
    const withForeground = applyImport(empty, result({ foreground: "fg.png" })).illustration.layers;
    expect(withForeground.map((layer) => (layer.kind === "art" ? layer.asset : layer.slotId))).toEqual(["pages/p01/hero/import-1-plate.jpg", "hero", "fg.png"]);
    const derived = applyImport(
      page,
      result({
        request: { kind: "derive", pageId: "p01", slotId: "hero", age: "young-child", face: "face:oval", from: "c.png", seed: 1 },
        plate: null,
        box: null,
        parts: [],
        base: { age: "young-child", face: "face:oval", asset: "oval-2.png", skinMask: "s.png" },
      }),
    );
    const hero = derived.illustration.layers[1];
    if (hero?.kind !== "figure") throw new Error("no figure");
    expect(hero.box).toEqual([0, 0, 100, 100]);
    expect(derived.illustration.layers[0]).toEqual({ kind: "art", asset: "old-plate.jpg" });
    expect(hero.bases.map((base) => base.asset).toSorted()).toEqual(["old-base.png", "oval-2.png"]);
  });

  it("leaves an adult's softer base alone: an import draws defined features (D40)", () => {
    const grownUp: Page = { ...page, illustration: { layers: [{ kind: "figure", slotId: "hero", box: [0, 0, 100, 100], bases: [adult(), adult("features:soft")], parts: [] }] } };
    const imported = result({ base: { age: "adult", face: "face:round", asset: "new.png", skinMask: "n.png" }, parts: [], plate: null });
    const request = { ...imported.request, age: "adult" as const };
    const hero = applyImport(grownUp, { ...imported, request }).illustration.layers[0];
    if (hero?.kind !== "figure") throw new Error("no figure");
    expect(hero.bases.map((base) => base.asset).toSorted()).toEqual(["new.png", "soft.png"]);
  });
});
