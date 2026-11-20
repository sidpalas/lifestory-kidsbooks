// The picker's portrait (D28): hair and facial hair reach the head's silhouette (thread T-01a1f68c). The portrait's
// ink outline is thicker than the hair the model draws over it, and as dark as the hair at its edge, so the matte
// left a ring of it, half covered, around the crown and in flecks under long hair, which shows as dark notches under
// a light hair colour. coverOutline, which cutOutLayer runs on every new part, now measures the outline's width and
// takes the silhouette of a base drawn on paper (figureCoverage); this applies it once to the stored parts, on their
// own bases, at the size they are stored. No part leaves bald scalp above it (crownGap), so none is redrawn.
// Rerun 2026-11-20 with the base's ink (figureCoverage): hair painted over line art (a braid across the jaw, a
// ponytail over the outline) left it showing as dotted dashes under a light colour; all 197 parts changed.
// Rewrites packages/core/src/looks/portrait/parts/ and parts.json in place; running it again changes nothing.
// usage (repo root): node fixtures/art-sources/portrait/build-outline.ts
import { readFileSync, writeFileSync } from "node:fs";

import { rasterize } from "../../../packages/core/src/looks/recolour.ts";
import { coverOutline } from "../../../packages/core/src/parts/cutout.ts";
import { encodeLayer, figureCoverage, rectToPixels } from "../../../packages/core/src/parts/images.ts";

const DIR = new URL("../../../packages/core/src/looks/portrait/", import.meta.url).pathname;
const parts: Record<string, Record<string, Array<{ asset: string; at: number[]; palette: string }>>> = JSON.parse(
  readFileSync(`${DIR}parts.json`, "utf8"),
);

for (const [base, options] of Object.entries(parts)) {
  const baseFile = new Uint8Array(readFileSync(`${DIR}bases/${base}.png`));
  const { width, height } = (await (await rasterize(baseFile)).metadata()) as { width: number; height: number };
  const { coverage: figure, ink } = await figureCoverage(baseFile, width, height);
  const mask = new Uint8Array(
    await (
      await rasterize(new Uint8Array(readFileSync(`${DIR}bases/${base}-skin.png`)))
    )
      .resize(width, height, { fit: "fill" })
      .extractChannel(3)
      .raw()
      .toBuffer(),
  );
  for (const [option, layers] of Object.entries(options)) {
    for (const layer of layers) {
      if (layer.palette !== "hairColour") continue;
      const [x0, y0, x1, y1] = rectToPixels(layer.at as never, width, height);
      const data = await (
        await rasterize(new Uint8Array(readFileSync(DIR + layer.asset)))
      )
        .resize(x1 - x0, y1 - y0, { fit: "fill" })
        .raw()
        .toBuffer();
      const alpha = new Float32Array(width * height);
      const colour = new Float32Array(width * height * 3);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const o = ((y - y0) * (x1 - x0) + (x - x0)) * 4,
            p = y * width + x;
          alpha[p] = data[o + 3]! / 255;
          for (let c = 0; c < 3; c++) colour[p * 3 + c] = data[o + c]! / 255;
        }
      const covered = coverOutline(alpha, colour, figure, mask, width, height, ink);
      if (covered.covered === 0) continue;
      const encoded = (await encodeLayer("part", covered.alpha, covered.colour, width, height))!;
      writeFileSync(DIR + layer.asset, encoded.png);
      layer.at = [...encoded.at];
      console.log(base, option, `outline ${covered.covered}`);
    }
  }
}
writeFileSync(`${DIR}parts.json`, `${JSON.stringify(parts, null, 1)}\n`);
