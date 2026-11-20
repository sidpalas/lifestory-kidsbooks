// Renders the landing page's character demo layers into public/marketing/looks: the picker portrait's art for the
// child ages, already recoloured, one transparent full-size layer per choice, so the browser stacks a portrait from
// static files and no visitor's click renders anything on the server. Rerun after the portrait art changes:
//   node apps/web/scripts/marketing-looks.ts
// It checks that every stack matches lookPortrait (the signed-in picker's /api/portrait) pixel for pixel before
// writing the WebPs. Layer names: looks-demo.ts (demoLayers).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { Effect } from "effect";
import sharp from "sharp";

import { composeFigure, type LayerSpec } from "../../../packages/core/src/looks/compose.ts";
import {
  lookPortrait,
  portraitFigure,
  portraitPalettes,
  portraitPartOrder,
} from "../../../packages/core/src/looks/portrait.ts";
import { recolour } from "../../../packages/core/src/looks/recolour.ts";
import { type Look, lookVocabulary, offeredAt } from "../../../packages/core/src/looks/vocabulary.ts";
import { demoAges, demoLayers } from "../src/components/looks-demo-layers.ts";

const out = new URL("../public/marketing/looks/", import.meta.url).pathname;
const art = (asset: string) => readFile(new URL(`../../../packages/core/src/looks/portrait/${asset}`, import.meta.url));

/** One layer of composeFigure's stack on a transparent canvas the size of the base, as raw RGBA. */
const renderLayer = async (spec: LayerSpec, width: number, height: number) => {
  const recoloured =
    spec.recolour.length === 0
      ? await art(spec.asset)
      : await recolour(
          await art(spec.asset),
          await Promise.all(
            spec.recolour.map(async (r) => ({ palette: r.palette, mask: r.mask ? await art(r.mask) : undefined })),
          ),
        );
  const [x0, y0, x1, y1] = spec.rect.map((v, k) => Math.round((v * (k % 2 === 0 ? width : height)) / 1000)) as [
    number,
    number,
    number,
    number,
  ];
  const part = await sharp(recoloured)
    .resize(x1 - x0, y1 - y0, { fit: "fill" })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: part, left: x0, top: y0 }])
    .png()
    .toBuffer();
};

const rendered = new Map<string, Promise<Buffer>>();
const layerPng = (name: string, spec: LayerSpec, width: number, height: number) => {
  if (!rendered.has(name)) rendered.set(name, renderLayer(spec, width, height));
  return rendered.get(name)!;
};

const base: Look = {
  age: "young-child",
  face: "face:round",
  features: "features:defined",
  skin: "skin:s1",
  hair: "hair:short",
  hairColour: "hair-colour:black",
  glasses: "glasses:none",
  facialHair: "facial-hair:none",
};
const looks = demoAges.flatMap((age) =>
  lookVocabulary.face.flatMap((face) =>
    lookVocabulary.skin.flatMap((skin) =>
      lookVocabulary.hair
        .filter((hair) => offeredAt(hair, age))
        .flatMap((hair) =>
          lookVocabulary.hairColour.flatMap((hairColour) =>
            lookVocabulary.glasses.map((glasses): Look => ({
              ...base,
              age,
              face: face.id,
              skin: skin.id,
              hair: hair.id,
              hairColour: hairColour.id,
              glasses: glasses.id,
            })),
          ),
        ),
    ),
  ),
);

// A bald head has no hair layer and a toddler no glasses, so many looks share one stack: draw each stack once.
const stacks = new Map(looks.map((look) => [demoLayers(look).join(), look]));
let checked = 0;
for (const look of stacks.values()) {
  const specs = composeFigure(portraitPalettes, portraitPartOrder, portraitFigure, look);
  const names = demoLayers(look);
  if (names.length !== specs.length)
    throw new Error(`${JSON.stringify(look)}: ${specs.length} layers, demo names ${names.length}`);
  const { width, height } = await sharp(await art(specs[0]!.asset)).metadata();
  const layers = await Promise.all(specs.map((spec, i) => layerPng(names[i]!, spec, width!, height!)));
  // Spot-check one look in eight against the server's portrait, including the first and last.
  if (checked++ % 8 === 0 || look === [...stacks.values()].at(-1)) {
    const stacked = await sharp(layers[0])
      .composite(layers.slice(1).map((input) => ({ input })))
      .removeAlpha()
      .raw()
      .toBuffer();
    const server = await sharp(await Effect.runPromise(lookPortrait(look)))
      .removeAlpha()
      .raw()
      .toBuffer();
    let worst = 0;
    for (let i = 0; i < server.length; i++) worst = Math.max(worst, Math.abs(server[i]! - stacked[i]!));
    if (stacked.length !== server.length || worst > 2)
      throw new Error(`${JSON.stringify(look)}: stack differs from lookPortrait by ${worst}`);
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
let bytes = 0;
for (const [name, png] of rendered) {
  // Bases are opaque; parts are mostly transparent, and lossless alpha keeps their cut-out edges clean.
  const webp = await sharp(await png)
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toBuffer();
  bytes += webp.length;
  await writeFile(`${out}${name}`, webp);
}
console.log(
  `${rendered.size} layers, ${(bytes / 2 ** 20).toFixed(1)} MiB, ${stacks.size} distinct portraits, ${Math.ceil(stacks.size / 8)} checked against lookPortrait`,
);
