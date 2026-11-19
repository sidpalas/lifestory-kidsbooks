// Builds the art-import fixtures (fixtures/imports) from the generated art in raw/ (not committed; gen.mjs makes it):
//   kite.psd        a layered file as an illustrator's tool exports it: Background, Kid (drawn bald), Hair, and a
//                   hidden Sketch layer; 768 px square.
//   kite-flat.jpg   one flat picture of a page with the girl in it; 768 px square.
// The Kid and Hair layers come from p02-kid.png placed on the plate and split with the import's own cut-out against
// an OpenAI bald edit (raw/kid-bald.png, made once with imports/task.ts's baldPrompt).
// usage (from the repo root): node fixtures/art-sources/kite/build.ts <raw dir>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const core = new URL("../../../packages/core/src/", import.meta.url).pathname;
const require = createRequire(`${core}x.js`);
const sharp = require("sharp");
const { writePsdBuffer } = createRequire(new URL("../../../apps/web/x.js", import.meta.url).pathname)("ag-psd");
const { prepareBase } = await import(`${core}parts/images.ts`);
const { figureOffPaper, takeOffHair } = await import(`${core}imports/images.ts`);

const raw = process.argv[2]!;
const SIZE = 768;
const out = new URL("../../imports/", import.meta.url).pathname;

const kid = await prepareBase(new Uint8Array(readFileSync(`${raw}/p02-kid.png`)));
const matted = await figureOffPaper(kid, kid.input);
const prepared = await prepareBase(matted);
const { baldPrompt } = await import(`${core}imports/task.ts`);
if (!existsSync(`${raw}/kid-bald.png`)) {
  // The area from 0% to 100% across and the top 40% of the figure, placed in the 2:3 input as the task words it.
  const { padding } = prepared;
  const pct = (v: number, size: number, offset: number, padded: number) => Math.round(((offset + (v * size) / 1000) / padded) * 100);
  const where = `from ${pct(0, prepared.width, padding.left, padding.paddedWidth)}% to ${pct(1000, prepared.width, padding.left, padding.paddedWidth)}% across and ${pct(0, prepared.height, padding.top, padding.paddedHeight)}% to ${pct(400, prepared.height, padding.top, padding.paddedHeight)}% down`;
  const form = new FormData();
  for (const [k, v] of Object.entries({ model: "gpt-image-2.6-sunburst", prompt: baldPrompt(where), size: `${prepared.inputWidth}x${prepared.inputHeight}`, quality: "medium", output_format: "png", n: "1" })) form.set(k, v);
  form.append("image[]", new Blob([prepared.input], { type: "image/png" }), "in.png");
  const response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body).slice(0, 400));
  writeFileSync(`${raw}/kid-bald.png`, Buffer.from(body.data[0].b64_json, "base64"));
  console.log("bald edit", JSON.stringify(body.usage));
}
const split = await takeOffHair(matted, prepared, new Uint8Array(readFileSync(`${raw}/kid-bald.png`)), [0, 0, 1000, 400]);
// The hair in the girl's own colours: the matted figure where the hair's alpha is.
const { width, height } = prepared;
const figure = await sharp(matted).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
const hairAlpha = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: Buffer.from(split.hair!.png), left: Math.round((split.hair!.at[0] * width) / 1000), top: Math.round((split.hair!.at[1] * height) / 1000) }])
  .raw()
  .toBuffer();
const hair = Buffer.from(figure);
for (let p = 0; p < width * height; p++) hair[p * 4 + 3] = hairAlpha[p * 4 + 3]!;

const place = async (png: Buffer | Uint8Array, raw = false) => {
  const input = raw ? await sharp(png, { raw: { width, height, channels: 4 } }).png().toBuffer() : png;
  const sized = await sharp(input).resize({ height: Math.round(SIZE * 0.58) }).png().toBuffer();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: sized, left: Math.round(SIZE * 0.56), top: Math.round(SIZE * 0.3) }])
    .raw()
    .toBuffer();
};
const plate = await sharp(readFileSync(`${raw}/p02-plate.png`)).resize(SIZE, SIZE).ensureAlpha().raw().toBuffer();
const sketch = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><path d="M60 700 Q 380 600 700 700" stroke="#3060ff" stroke-width="4" fill="none"/></svg>`)).ensureAlpha().raw().toBuffer();
const layer = (name: string, data: Buffer, hidden = false) => ({ name, hidden, left: 0, top: 0, imageData: { width: SIZE, height: SIZE, data: new Uint8ClampedArray(data) } });
const psd = {
  width: SIZE,
  height: SIZE,
  children: [layer("Background", plate), layer("Kid", await place(split.colourFigure)), layer("Hair", await place(hair, true)), layer("Sketch", sketch, true)],
};
writeFileSync(`${out}kite.psd`, writePsdBuffer(psd, { generateThumbnail: false, noBackground: true }));
await sharp(readFileSync(`${raw}/p01-flat.png`)).resize(SIZE, SIZE).jpeg({ quality: 88 }).toFile(`${out}kite-flat.jpg`);
console.log("wrote", out);
