// Lays The Moon Walk's raw art out as the layer export story-from-export.ts reads (a page with several roles lists
// its `figures`), the way psd-export.py would from an illustrator's PSDs: each plate on the 8.75 in square canvas at
// 300 px/in, and each bald figure scaled into its box, standing on the box's bottom edge, written cropped to its
// pixels. Text and fonts go in text-layout.json and assets/fonts (Literata, from The Kite Day).
//   node fixtures/art-sources/moon-walk/compose.mjs <raw dir> <export dir>
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const sharp = createRequire(new URL("../../../packages/core/x.js", import.meta.url).pathname)("sharp");
const [raw, out] = process.argv.slice(2);
if (!raw || !out) throw new Error("usage: compose.mjs <raw dir> <export dir>");
const C = 2625; // 8.5 in plus 0.125 in bleed each side, at 300 px/in
/** Every figure's mean ink, in lightness levels below the paper (0–255), as light as the lightest drawn one. */
const INK = 26;
const kite = new URL("../../stories/kite-day/", import.meta.url).pathname;

// Per page, back to front: the box (thousandths of the canvas) each figure is fitted into, its head in the raw
// drawing's pixels, read off the drawing, and whether to mirror it (p01's child points at the moon).
const pages = [
  {
    pageId: "p01",
    figures: [
      { slotId: "hero", box: [135, 675, 325, 975], head: [390, 140, 730, 460], flop: true },
      { slotId: "grownup", box: [400, 400, 720, 975], head: [350, 40, 530, 220] },
    ],
    paragraphs: [
      { style: "title", content: "The Moon Walk" },
      {
        style: "body",
        content:
          "After supper, {{hero.name}} pointed up at the sky. “The moon is so big tonight!” “Then let’s go and find it,” said {{grownup.title}}.",
      },
    ],
  },
  {
    pageId: "p02",
    figures: [
      { slotId: "grownup", box: [150, 340, 450, 975], head: [420, 120, 610, 330] },
      { slotId: "hero", box: [600, 620, 832, 935], head: [350, 140, 760, 560] },
    ],
    paragraphs: [
      {
        style: "body",
        content:
          "Down the path and into the wood they went, {{grownup.title}}’s lantern swinging, and {{hero.name}} running ahead to say hello to the owl.",
      },
    ],
  },
  {
    pageId: "p03",
    figures: [{ slotId: "hero", box: [180, 420, 440, 985], head: [370, 170, 645, 450] }],
    paragraphs: [
      {
        style: "body",
        content:
          "At the edge of the wood the moon hung so low that {{hero.name}} stretched up on tiptoe to touch it. “Nearly!” {{hero.they}} laughed.",
      },
    ],
  },
  {
    pageId: "p04",
    figures: [
      { slotId: "grownup", box: [80, 560, 500, 965], head: [500, 25, 750, 265] },
      { slotId: "hero", box: [600, 720, 787, 965], head: [490, 25, 860, 430] },
    ],
    // The moon sits top right: the text stops short of it.
    textWidthIn: 5.4,
    paragraphs: [
      {
        style: "body",
        content:
          "On top of the hill they sat and watched it until {{hero.name}} gave an enormous yawn. “Good night, moon,” whispered {{grownup.title}}, and they walked home together.",
      },
    ],
  },
];

/** The paper's colour: the plate's mean over its top tenth, which is bare paper on every plate. */
const paperOf = async (plate) => {
  const { channels } = await sharp(plate).extract({ left: 0, top: 0, width: 1024, height: 100 }).removeAlpha().stats();
  return channels.map((c) => c.mean);
};

/** Pixels inside the figure: alpha ≥ 48 grown by r, holes filled from the border, shrunk by r. */
const silhouette = (rgba, w, h, r) => {
  const grow = (mask, value) => {
    // A square max (value 1) or min (value 0) filter, one axis at a time.
    const pass = (src, dx, dy) => {
      const dst = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let hit = false;
          for (let k = -r; k <= r && !hit; k++) {
            const xx = x + k * dx;
            const yy = y + k * dy;
            const v = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[yy * w + xx];
            hit = v === value;
          }
          dst[y * w + x] = hit ? value : 1 - value;
        }
      return dst;
    };
    return pass(pass(mask, 1, 0), 0, 1);
  };
  const lines = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) lines[p] = rgba[p * 4 + 3] >= 48 ? 1 : 0;
  const grown = grow(lines, 1);
  // Flood the outside from the border; whatever it doesn't reach is inside.
  const outside = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (outside[p] || grown[p]) continue;
    outside[p] = 1;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  const filled = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) filled[p] = outside[p] ? 0 : 1;
  return grow(filled, 0);
};

rmSync(out, { recursive: true, force: true });
const exportPages = [];
for (const page of pages) {
  const dir = join(out, "pages", page.pageId);
  mkdirSync(dir, { recursive: true });
  await sharp(join(raw, `${page.pageId}-plate.png`))
    .resize(C, C)
    .jpeg({ quality: 92 })
    .toFile(join(dir, "plate.jpg"));
  const figures = [];
  for (const figure of page.figures) {
    const source = join(raw, `${page.pageId}-${figure.slotId}.png`);
    // Drop the faint glow the model leaves around a figure, then crop to what's left.
    const { data, info } = await sharp(source)
      .flop(figure.flop ?? false)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let [x0, y0, x1, y1] = [info.width, info.height, -1, -1];
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4 + 3;
        if (data[i] < 48) data[i] = 0;
        else [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
      }
    // A loose sketch leaves the paper inside the figure transparent. Fill its silhouette (its lines, grown to close
    // their gaps, with the holes filled, then shrunk back) with the plate's paper, so the figure is opaque like an
    // illustrator's figure layer: fitFigure's tint and overlap checks compare against it.
    const paper = await paperOf(join(raw, `${page.pageId}-plate.png`));
    const inside = silhouette(data, info.width, info.height, 10);
    // Every figure is then graphite on that paper, all equally dark: each pixel's ink (how much darker than the
    // paper it is) scaled so the figure's mean ink is INK, then laid on the paper's colour. The model shaded some
    // bald figures much heavier than others, and the tint copies each one's darkness and warmth into the book.
    const paperL = 0.299 * paper[0] + 0.587 * paper[1] + 0.114 * paper[2];
    const n = info.width * info.height;
    const ink = new Float32Array(n);
    let sum = 0;
    let count = 0;
    for (let p = 0; p < n; p++) {
      const a = data[p * 4 + 3] / 255;
      const lum = 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2];
      // Over the paper fill inside the figure, a faint stroke is that much ink; outside, only the stroke's own.
      ink[p] = Math.max(0, inside[p] ? (paperL - lum) * a : paperL - lum);
      if (inside[p] || a > 0.8) {
        sum += ink[p];
        count++;
      }
    }
    const k = INK / (sum / count);
    for (let p = 0; p < n; p++) {
      const q = Math.max(0, 1 - (ink[p] * k) / paperL);
      for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.round(q * paper[c]);
      if (inside[p]) data[p * 4 + 3] = 255;
    }
    const [bx0, by0, bx1, by1] = figure.box.map((v) => (v * C) / 1000);
    const scale = Math.min((bx1 - bx0) / (x1 - x0), (by1 - by0) / (y1 - y0));
    const width = Math.round((x1 - x0) * scale);
    const height = Math.round((y1 - y0) * scale);
    const left = Math.round((bx0 + bx1) / 2 - width / 2);
    const top = Math.round(by1 - height);
    await sharp(data, { raw: info })
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .resize(width, height)
      .png()
      .toFile(join(dir, `${figure.slotId}.png`));
    const [hx0, hy0, hx1, hy1] = figure.flop
      ? [info.width - figure.head[2], figure.head[1], info.width - figure.head[0], figure.head[3]]
      : figure.head;
    const head = [
      left + (hx0 - x0) * scale,
      top + (hy0 - y0) * scale,
      left + (hx1 - x0) * scale,
      top + (hy1 - y0) * scale,
    ].map(Math.round);
    figures.push({ slotId: figure.slotId, box: [left, top, left + width, top + height], head });
  }
  exportPages.push({ pageId: page.pageId, figures, occluders: [], occluderKinds: {} });
}
writeFileSync(join(out, "export.json"), `${JSON.stringify({ canvas: [C, C], pages: exportPages }, null, 2)}\n`);

const kiteManifest = JSON.parse(readFileSync(join(kite, "manifest.json"), "utf8"));
mkdirSync(join(out, "assets"), { recursive: true });
cpSync(join(kite, "fonts"), join(out, "assets", "fonts"), { recursive: true });
const layout = {
  trim: { widthIn: 8.5, heightIn: 8.5, bleedIn: 0.125, safeMarginIn: 0.5 },
  fonts: kiteManifest.fonts,
  textStyles: kiteManifest.textStyles,
  pages: pages.map((page) => ({
    pageId: page.pageId,
    art: "full-bleed",
    frames: [
      {
        frameId: "t1",
        box: { xIn: 0.5, yIn: 0.5, widthIn: page.textWidthIn ?? 7.5, heightIn: 2 },
        valign: "top",
        panel: false,
        paragraphs: page.paragraphs,
      },
    ],
  })),
};
writeFileSync(join(out, "text-layout.json"), `${JSON.stringify(layout, null, 2)}\n`);
console.log(`${pages.length} pages written to ${out}`);
