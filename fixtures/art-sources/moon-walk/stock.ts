// Draws each stock character's figure on every page the way a book draws a family's (packages/core/src/tasks/
// photo-books.ts, drawPageFigures): the page reference (the plate and every bald figure, cropped to the figure's
// window), the photo-hero-v3 figure prompt with that role's stock sheet from the story directory, one OpenAI edit,
// then fitFigure. Writes <out>/pNN-<slotId>.png (for story-from-export's --stock), the raw drawings, and
// <out>/pages/pNN.jpg: the page composed as the app does it. Skips figures whose raw drawing exists.
//   node fixtures/art-sources/moon-walk/stock.ts <story dir> <out dir> [pNN ...]
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
const [storyDir, out, ...only] = process.argv.slice(2);
if (!storyDir || !out) throw new Error("usage: stock.ts <story dir> <out dir> [pNN ...]");
const MODEL = "gpt-image-2.5-sunburst"; // the production default (OPENAI_PHOTO_MODEL)
const manifest = JSON.parse(readFileSync(join(storyDir, "manifest.json"), "utf8")) as StoryManifest;
mkdirSync(join(out, "raw"), { recursive: true });
mkdirSync(join(out, "pages"), { recursive: true });
const sheets = Object.fromEntries(
  manifest.characterSlots.map((slot) => [slot.slotId, readFileSync(join(storyDir, slot.stockSheet!))]),
);
const prompt = photoPrompts["photo-hero-v3"].figure({ style: manifest.photo! });
let spent = 0;

await Promise.all(
  manifest.pages.map(async (page) => {
    if (only.length && !only.includes(page.pageId)) return;
    const layers = page.illustration.layers;
    const plate = readFileSync(join(storyDir, (layers[0] as { asset: string }).asset));
    const figures = layers.filter((l) => l.kind === "photoFigure");
    const bald = figures.map((f) => ({ reference: readFileSync(join(storyDir, f.reference!)), box: f.box }));
    const aspect = illustrationAspect(manifest.trim, page.art);
    const placed: Array<{ input: Buffer; left: number; top: number }> = [];
    const meta = await sharp(plate).metadata();
    const W = meta.width!;
    const H = meta.height!;
    for (const [index, figure] of figures.entries()) {
      const name = `${page.pageId}-${figure.slotId}`;
      const size = generationSize(figure.window, aspect);
      const rawPath = join(out, "raw", `${name}.png`);
      if (!existsSync(rawPath)) {
        const input = await pageReference(plate, bald, figure.window, size);
        writeFileSync(join(out, "raw", `${name}-reference.png`), input);
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
        form.append("image[]", new Blob([sheets[figure.slotId]!], { type: "image/png" }), "ref-1.png");
        const response = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: form,
        });
        const body = (await response.json()) as { data?: Array<{ b64_json: string }>; usage?: never };
        if (!response.ok) return console.error(name, JSON.stringify(body).slice(0, 400));
        writeFileSync(rawPath, Buffer.from(body.data![0]!.b64_json, "base64"));
        const cost = openAICost(MODEL, body.usage) ?? 0;
        spent += cost;
        console.log(name, `$${cost.toFixed(3)}`);
      }
      const fitted = await fitFigure({
        output: readFileSync(rawPath),
        bald: await placeReference(bald[index]!.reference, figure.box, figure.window, size),
        head: figure.head,
        window: figure.window,
        size,
        tint: true,
      });
      writeFileSync(join(out, `${name}.png`), fitted.png);
      console.log(
        name,
        `iou ${fitted.iou.toFixed(2)} clipped ${(fitted.clippedShare * 100).toFixed(1)}%`,
        fitted.rescaled ? "rescaled" : "",
        fitted.offWindow ? "off window" : "",
      );
      const [x0, y0, x1, y1] = figure.window.map((v, i) => Math.round((v * (i % 2 ? H : W)) / 1000));
      placed.push({
        input: await sharp(fitted.png)
          .resize(x1! - x0!, y1! - y0!, { fit: "fill" })
          .png()
          .toBuffer(),
        left: x0!,
        top: y0!,
      });
    }
    // The page as the app composes it, at the plate's size.
    const composed = await sharp(plate).composite(placed).png().toBuffer();
    await sharp(composed)
      .resize(1200, 1200)
      .jpeg({ quality: 88 })
      .toFile(join(out, "pages", `${page.pageId}.jpg`));
  }),
);
console.log(`total $${spent.toFixed(3)}`);
