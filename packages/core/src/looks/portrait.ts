// The picker's portrait: one story-independent figure that shows every option in the look vocabulary, so a parent
// sees each choice while building a look. Books then draw the same option IDs with each story's own parts (D26).
// It is composed exactly like a story figure (composeFigure, then the gradient-map recolour), from art shipped
// with the code, because the vocabulary it must cover ships with the code too.
//
// Placeholder art (portrait/, 244 × 280 px): rebuilt by portrait/extract.py from the FLUX 3 Klein experiment in
// thread T-01a1f012-4acc-7483-a9a5-8d5c5353cdee (its 24-combination grid): a bald base, its skin mask, and in-place
// hairstyle and glasses parts. That experiment drew one grown-up base only, so every face option shows that base
// until the illustrator draws the others; hair:short is its bob, hair:curly its coily afro, hair:long its braids.
// Server-only (sharp, node:fs).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Effect } from "effect";
import sharp from "sharp";
import type { FigureLayer, Part, StoryManifest } from "../book-format/manifest.ts";
import { composeFigure } from "./compose.ts";
import { recolour } from "./recolour.ts";
import { faceOptions, hairOptions, type Look } from "./vocabulary.ts";

const FULL = [0, 0, 1000, 1000] as const;

/** Tones map on the base's luminance (its skin's median is 0.684), like the experiment's multiplicative shift. */
const skinPalette = (shadow: string, tone: string, light: string) => [
  { at: 0, colour: shadow },
  { at: 0.684, colour: tone },
  { at: 1, colour: light },
];
/** Hair parts are neutral greys stretched to 0.1-0.85, so one three-stop map per colour fits every hairstyle. */
const hairPalette = (dark: string, mid: string, light: string) => [
  { at: 0.1, colour: dark },
  { at: 0.475, colour: mid },
  { at: 0.85, colour: light },
];

export const portraitPalettes: StoryManifest["palettes"] = {
  // Mid tones match the sample story's skin palettes, so a tone reads the same in the picker and in the book.
  skin: {
    "skin:s1": skinPalette("#1e1a18", "#f6dcc8", "#ffffff"),
    "skin:s2": skinPalette("#1d1814", "#eec6a8", "#fffff5"),
    "skin:s3": skinPalette("#1a130f", "#d6a07a", "#ffeab2"),
    "skin:s4": skinPalette("#150e09", "#b07548", "#ffab69"),
    "skin:s5": skinPalette("#0d0805", "#6e4428", "#a1633a"),
  },
  hairColour: {
    "hair-colour:black": hairPalette("#121014", "#342c2e", "#70666a"),
    "hair-colour:brown": hairPalette("#281810", "#624028", "#aa825e"),
    "hair-colour:blonde": hairPalette("#785628", "#cea660", "#f6e2aa"),
    "hair-colour:grey": hairPalette("#46464c", "#96969c", "#e4e4e8"),
  },
};

/** The experiment drew glasses under the hair. */
const partOrder: StoryManifest["partOrder"] = ["glasses", "hair"];

export const portraitFigure: FigureLayer = {
  kind: "figure",
  slotId: "portrait",
  box: FULL,
  bases: faceOptions.map((face) => ({ face: face.id, asset: "base.png", skinMask: "skin-mask.png" })),
  parts: faceOptions.flatMap((face): ReadonlyArray<Part> => [
    ...hairOptions.map((hair) => ({
      face: face.id,
      axis: "hair" as const,
      option: hair.id,
      asset: `hair-${hair.id.slice("hair:".length)}.png`,
      at: FULL,
      palette: "hairColour" as const,
      approved: true,
    })),
    { face: face.id, axis: "glasses", option: "glasses:round", asset: "glasses-round.png", at: FULL, palette: "none", approved: true },
  ]),
};

// Resolved through the package, not relative to this file: the web build bundles this module into apps/web/dist,
// while the files stay in packages/core (which the production image ships as source).
const require = createRequire(import.meta.url);
const read = (asset: string) => readFile(require.resolve(`@lifestory/core/portrait/${asset}`));

const render = async (look: Look): Promise<Uint8Array> => {
  // Every portrait layer fills the canvas, so they stack without offsets.
  const layers = await Promise.all(
    composeFigure(portraitPalettes, partOrder, portraitFigure, look).map(async (layer) =>
      layer.recolour.length === 0
        ? read(layer.asset)
        : recolour(
            await read(layer.asset),
            await Promise.all(layer.recolour.map(async (region) => ({ palette: region.palette, mask: region.mask ? await read(region.mask) : undefined }))),
          ),
    ),
  );
  const [base, ...rest] = layers;
  return new Uint8Array(
    await sharp(base!)
      .composite(rest.map((input) => ({ input: Buffer.from(input) })))
      .png()
      .toBuffer(),
  );
};

// Bounded by the vocabulary: 4 faces × 5 tones × 3 hairstyles × 4 colours × 2 = 480 looks of ~100 KB at most.
const cache = new Map<string, Promise<Uint8Array>>();

/** The portrait of `look` as a PNG. Deterministic, so it is made once per look and process. */
export const lookPortrait = Effect.fn("looks.portrait")(function* (look: Look) {
  const key = JSON.stringify([look.face, look.skin, look.hair, look.hairColour, look.glasses]);
  let png = cache.get(key);
  if (!png) {
    png = render(look);
    cache.set(key, png);
    png.catch(() => cache.delete(key));
  }
  return yield* Effect.promise(() => png);
});
