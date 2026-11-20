// The picker's portrait: one story-independent figure that shows every option in the look vocabulary, so a parent
// sees each choice while building a look. Books then draw the same option IDs with each story's own parts (D26).
// It is composed exactly like a story figure (composeFigure, then the gradient-map recolour), from art shipped
// with the code, because the vocabulary it must cover ships with the code too.
//
// Art (portrait/, 488 × 560 px, shown at 244 × 280): gouache with an ink outline, drawn with OpenAI
// gpt-image-2.6-sunburst (D28, D30). One base per age and face type (bases/<age>-<face>.png), each an edit of the style
// sample Sid chose (from teen up also one with softer features, D40, an edit of the defined one), with a skin mask found by colour and the skin's median luminance set to 0.684; then each base's
// hairstyles, glasses and, for adults, facial hair (parts.json, parts/) made and cut out like story parts (D36) and reviewed on the lightest and
// darkest skin. Axes an age has no parts for (a baby's hairstyle, a toddler's glasses) are left out, as in books.
// Server-only (sharp, node:fs).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Effect } from "effect";
import sharp from "sharp";
import type { FigureLayer, Part, StoryManifest } from "../book-format/manifest.ts";
import { composeFigure } from "./compose.ts";
import { recolour } from "./recolour.ts";
import partsByBase from "./portrait/parts.json" with { type: "json" };
import { ageOptions, faceOptions, featuresOptions, hasFeatures, type Look } from "./vocabulary.ts";

const FULL = [0, 0, 1000, 1000] as const;

/** Tones map on the base's luminance; every base's skin has its median at 0.684. */
const skinPalette = (shadow: string, tone: string, light: string) => [
  { at: 0, colour: shadow },
  { at: 0.684, colour: tone },
  { at: 1, colour: light },
];
/** Hair parts are neutral greys with their median at 0.40 (the cut-out's neutral tones), so the swatch is the hair's main colour. */
const hairPalette = (dark: string, mid: string, light: string) => [
  { at: 0.1, colour: dark },
  { at: 0.4, colour: mid },
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
    "hair-colour:red": hairPalette("#3a140a", "#8c3a1c", "#d8875a"),
  },
};

/** Facial hair at the bottom; glasses go under the hair, which falls over their arms. */
export const portraitPartOrder: StoryManifest["partOrder"] = ["facialHair", "glasses", "hair"];

const atEveryAge = ageOptions.flatMap((age) =>
  faceOptions.flatMap((face) =>
    hasFeatures(age.id)
      ? featuresOptions.map((features) => ({ age: age.id, face: face.id, features: features.id }))
      : [{ age: age.id, face: face.id }],
  ),
);

const baseName = (at: (typeof atEveryAge)[number]) =>
  `${at.age}-${at.face.slice("face:".length)}${"features" in at && at.features === "features:soft" ? "-soft" : ""}`;

export const portraitFigure: FigureLayer = {
  kind: "figure",
  slotId: "portrait",
  box: FULL,
  bases: atEveryAge.map((at) => ({
    ...at,
    asset: `bases/${baseName(at)}.png`,
    skinMask: `bases/${baseName(at)}-skin.png`,
  })),
  parts: atEveryAge.flatMap((at): ReadonlyArray<Part> =>
    Object.entries(
      (partsByBase as unknown as Record<string, Record<string, ReadonlyArray<Pick<Part, "asset" | "at" | "palette">>>>)[
        baseName(at)
      ] ?? {},
    ).flatMap(([option, layers]) =>
      layers.map((layer) => ({
        ...at,
        axis: option.startsWith("hair:") ? "hair" : option.startsWith("facial-hair:") ? "facialHair" : "glasses",
        option,
        ...layer,
        approved: true,
      })),
    ),
  ),
};

// Resolved through the package, not relative to this file: the web build bundles this module into apps/web/dist,
// while the files stay in packages/core (which the production image ships as source).
const require = createRequire(import.meta.url);
const read = (asset: string) => readFile(require.resolve(`@lifestory/core/portrait/${asset}`));

const render = async (look: Look): Promise<Uint8Array> => {
  const specs = composeFigure(portraitPalettes, portraitPartOrder, portraitFigure, look);
  const layers = await Promise.all(
    specs.map(async (layer) =>
      layer.recolour.length === 0
        ? read(layer.asset)
        : recolour(
            await read(layer.asset),
            await Promise.all(
              layer.recolour.map(async (region) => ({
                palette: region.palette,
                mask: region.mask ? await read(region.mask) : undefined,
              })),
            ),
          ),
    ),
  );
  // The base fills the canvas; each part is cropped to its pixels and placed at its rect.
  const [base, ...rest] = layers;
  const { width, height } = await sharp(base!).metadata();
  const placed = await Promise.all(
    rest.map(async (input, i) => {
      const [x0, y0, x1, y1] = specs[i + 1]!.rect.map((v, k) =>
        Math.round((v * (k % 2 === 0 ? width! : height!)) / 1000),
      );
      return {
        input: await sharp(input)
          .resize(x1! - x0!, y1! - y0!, { fit: "fill" })
          .png()
          .toBuffer(),
        left: x0!,
        top: y0!,
      };
    }),
  );
  return new Uint8Array(await sharp(base!).composite(placed).png().toBuffer());
};

// The vocabulary allows ~2,400 looks (features double the teen and older ages) of ~400 KB each, too many to keep
// every one in the web process, so only the 300 most recently made stay (~120 MB); a picker shows ~15 at a time.
const CACHED = 300;
const cache = new Map<string, Promise<Uint8Array>>();

/** The portrait of `look` as a PNG. Deterministic, so a recent look is served from memory. */
export const lookPortrait = Effect.fn("looks.portrait")(function* (look: Look) {
  const key = JSON.stringify([
    look.age,
    look.face,
    look.features,
    look.skin,
    look.hair,
    look.hairColour,
    look.glasses,
    look.facialHair,
  ]);
  let png = cache.get(key);
  if (!png) {
    png = render(look);
    cache.set(key, png);
    if (cache.size > CACHED) cache.delete(cache.keys().next().value!);
    png.catch(() => cache.delete(key));
  }
  return yield* Effect.promise(() => png);
});
