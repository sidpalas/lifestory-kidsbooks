// Draws the example child's stock figure for each page the way a book draws a family's (packages/core/src/tasks/
// photo-books.ts): the page reference (plate and bald figure, cropped to the window), the photo-hero-v3 figure prompt
// with the stock sheet, one OpenAI edit, then fitFigure. Writes <out>/pNN.png (for story-from-export's --stock), the
// raw drawings, and <out>/pages/pNN.jpg: the page composed as the app does it (plate, figure, scenery occluders).
// Skips pages whose raw drawing exists.
//   node fixtures/art-sources/snow-fox/stock.ts <story dir> <stock sheet> <out dir> [pNN ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import type { StoryManifest } from "../../../packages/core/src/book-format/index.ts";
import {
  fitFigure,
  generationSize,
  illustrationAspect,
  pageReference,
  placeReference,
} from "../../../packages/core/src/figure.ts";
import { photoPrompts } from "../../../packages/core/src/photo-prompts.ts";
import { openAICost } from "../../../packages/core/src/providers/openai.ts";

const sharp = createRequire(new URL("../../../packages/core/x.js", import.meta.url).pathname)(
  "sharp",
) as typeof import("sharp");
const [storyDir, sheetPath, out, ...only] = process.argv.slice(2);
if (!storyDir || !sheetPath || !out) throw new Error("usage: stock.ts <story dir> <stock sheet> <out dir> [pNN ...]");
const MODEL = "gpt-image-2.5-sunburst"; // the production default (OPENAI_PHOTO_MODEL)
const manifest = JSON.parse(readFileSync(join(storyDir, "manifest.json"), "utf8")) as StoryManifest;
mkdirSync(join(out, "raw"), { recursive: true });
mkdirSync(join(out, "pages"), { recursive: true });
const sheet = readFileSync(sheetPath);
const prompt = photoPrompts["photo-hero-v3"].figure({ style: manifest.photo! });
let spent = 0;

await Promise.all(
  manifest.pages.map(async (page) => {
    if (only.length && !only.includes(page.pageId)) return;
    const layers = page.illustration.layers;
    const plate = readFileSync(join(storyDir, (layers[0] as { asset: string }).asset));
    const figure = layers.find((l) => l.kind === "photoFigure")!;
    const reference = readFileSync(join(storyDir, figure.reference!));
    const size = generationSize(figure.window, illustrationAspect(manifest.trim, page.art));
    const rawPath = join(out, "raw", `${page.pageId}.png`);
    if (!existsSync(rawPath)) {
      const input = await pageReference(plate, [{ reference, box: figure.box }], figure.window, size);
      writeFileSync(join(out, "raw", `${page.pageId}-reference.png`), input);
      const form = new FormData();
      for (const [k, v] of Object.entries({
        model: MODEL,
        prompt,
        size: `${size.width}x${size.height}`,
        quality: "medium",
        output_format: "png",
        n: "1",
        background: "transparent",
      }))
        form.set(k, v);
      form.append("image[]", new Blob([input], { type: "image/png" }), "ref-0.png");
      form.append("image[]", new Blob([sheet], { type: "image/png" }), "ref-1.png");
      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });
      const body = (await response.json()) as { data?: Array<{ b64_json: string }>; usage?: never };
      if (!response.ok) return console.error(page.pageId, JSON.stringify(body).slice(0, 400));
      writeFileSync(rawPath, Buffer.from(body.data![0]!.b64_json, "base64"));
      const cost = openAICost(MODEL, body.usage) ?? 0;
      spent += cost;
      console.log(page.pageId, `$${cost.toFixed(3)}`);
    }
    const bald = await placeReference(reference, figure.box, figure.window, size);
    const fitted = await fitFigure({
      output: readFileSync(rawPath),
      bald,
      head: figure.head,
      window: figure.window,
      size,
      tint: true,
    });
    writeFileSync(join(out, `${page.pageId}.png`), fitted.png);
    console.log(
      page.pageId,
      `iou ${fitted.iou.toFixed(2)} clipped ${(fitted.clippedShare * 100).toFixed(1)}%`,
      fitted.rescaled ? "rescaled" : "",
      fitted.offWindow ? "off window" : "",
    );
    // The page as the app composes it, at the plate's size.
    const meta = await sharp(plate).metadata();
    const W = meta.width!;
    const H = meta.height!;
    const [x0, y0, x1, y1] = figure.window.map((v, i) => Math.round((v * (i % 2 ? H : W)) / 1000));
    const placed = await sharp(fitted.png)
      .resize(x1! - x0!, y1! - y0!, { fit: "fill" })
      .png()
      .toBuffer();
    const scenery = layers.slice(1).filter((l) => l.kind === "art") as Array<{ asset: string }>;
    await sharp(plate)
      .composite([
        { input: placed, left: x0!, top: y0! },
        ...scenery.map((l) => ({ input: join(storyDir, l.asset), left: 0, top: 0 })),
      ])
      .png()
      .toBuffer()
      .then((composed) => sharp(composed).resize(1200, 1200))
      .then((small) => small.jpeg({ quality: 88 }).toFile(join(out, "pages", `${page.pageId}.jpg`)));
  }),
);
console.log(`total $${spent.toFixed(3)}`);
