// Stacks compose.py's layers into one PSD per page, laid out as psd-export.py reads them (.agents/skills/
// preparing-layered-art): plate, hero (the bald child), foreground (one layer per occluder), plus two groups the export
// skips: "guides" (the head hole) and "front zones" ("front of: <occluder>", where the child's arm or held prop comes
// in front of that occluder; a proposal, not part of book format 4).
//   node fixtures/art-sources/snow-fox/build-psds.mjs <layers dir> <psd dir>
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const sharp = createRequire(new URL("../../../packages/core/x.js", import.meta.url).pathname)("sharp");
const { writePsdBuffer } = createRequire(new URL("../../../apps/web/x.js", import.meta.url).pathname)("ag-psd");

const [src, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const layer = async (name, file, hidden = false) => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Each layer is cropped to its pixels, as an illustrator's tool saves it: the head hole's rect is the head box.
  let [x0, y0, x1, y1] = [info.width, info.height, 0, 0];
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x >= x1) x1 = x + 1;
        if (y < y0) y0 = y;
        if (y >= y1) y1 = y + 1;
      }
  const width = x1 - x0;
  const height = y1 - y0;
  const crop = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left: x0, top: y0, width, height })
    .raw()
    .toBuffer();
  return { name, hidden, left: x0, top: y0, imageData: { width, height, data: new Uint8ClampedArray(crop) } };
};

for (const page of readdirSync(src).sort()) {
  const dir = `${src}/${page}`;
  const files = readdirSync(dir);
  const plate = await layer("plate", `${dir}/plate.png`);
  const foreground = [];
  if (existsSync(`${dir}/hero-hat.png`))
    foreground.push(await layer("occluder: hero (bobble hat)", `${dir}/hero-hat.png`));
  for (const f of files.filter((f) => f.startsWith("occluder-")))
    foreground.push(await layer(`occluder: scenery (${f.slice(9, -4)})`, `${dir}/${f}`));
  const zones = [];
  for (const f of files.filter((f) => f.startsWith("front-of-")))
    zones.push(await layer(`front of: ${f.slice(9, -4)}`, `${dir}/${f}`, true));
  const group = (name, children, hidden = false) => ({ name, opened: true, hidden, children });
  const psd = {
    width: plate.imageData.width,
    height: plate.imageData.height,
    children: [
      group("plate", [plate]),
      group("hero", [await layer("body", `${dir}/hero.png`)]),
      ...(foreground.length ? [group("foreground", foreground)] : []),
      group("guides", [await layer("original head hole", `${dir}/head-hole.png`, true)], true),
      ...(zones.length ? [group("front zones", zones, true)] : []),
    ],
  };
  writeFileSync(`${out}/${page}.psd`, writePsdBuffer(psd, { generateThumbnail: false }));
  console.log(page, psd.children.map((g) => `${g.name}[${g.children.map((l) => l.name).join(", ")}]`).join(" "));
}
