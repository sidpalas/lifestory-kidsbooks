// Builds a book format 4 story directory (D56) from an illustrator's layer export, so `story-import.ts` can publish
// it. The art stays out of the repository: the export and the built directory live on the machine running this, and
// only this converter and the story's config (fixtures/art-sources/<story>.json) are committed.
//
//   node packages/core/src/story-from-export.ts --export <export dir> --config fixtures/art-sources/<story>.json \
//     --sheet <stock sheet image> --out <story dir> [--stock <dir of pNN.png stock figures>]
//
// The export (written from the PSDs on the illustrator's Mac) holds export.json (canvas in pixels; per page the
// hero's box and head box in pixels, and its occluders with their kind), text-layout.json (trim, fonts, text styles,
// and each page's frames), assets/fonts/, and pages/<pageId>/ with plate.jpg, hero.png (cropped to its box) and
// occluders/*.png (full canvas). Occluders of kind "hero" (the figure's own hat or helmet) are merged into the bald
// reference, so the model redraws them; "scenery" occluders are art layers over the figure.
//
// A story with several roles lists them as `slots` in its config and takes `--sheet <slotId>=<image>` for each. Its
// export lists each page's `figures` (slotId, box and head, back to front) instead of `hero`, with
// pages/<pageId>/<slotId>.png, and its stock figures are pNN-<slotId>.png.
//
// Without --stock, each figure's stock drawing is its bald reference on the window: a placeholder until the stock
// figures are drawn from the stock sheet.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { Effect, Schema } from "effect";
import sharp from "sharp";

import {
  CharacterSlot,
  decodeStoryManifest,
  FORMAT_VERSION,
  type Rect,
  type StoryManifest,
} from "./book-format/index.ts";
import { generationSize, illustrationAspect } from "./figure.ts";
import { printTrimIssues } from "./print-ready.ts";

const PixelBox = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]);

const ExportFile = Schema.Struct({
  canvas: Schema.Tuple([Schema.Number, Schema.Number]),
  pages: Schema.Array(
    Schema.Struct({
      pageId: Schema.String,
      hero: Schema.optionalKey(Schema.NullOr(Schema.Struct({ box: PixelBox, head: PixelBox }))),
      /** A page with several roles: each figure's bald drawing is pages/<pageId>/<slotId>.png, back to front. */
      figures: Schema.optionalKey(
        Schema.Array(Schema.Struct({ slotId: Schema.String, box: PixelBox, head: PixelBox })),
      ),
      occluders: Schema.Array(Schema.String),
      occluderKinds: Schema.Record(Schema.String, Schema.Literals(["scenery", "hero"])),
    }),
  ),
});

const Config = Schema.Struct({
  story: Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    title: Schema.String,
    summary: Schema.String,
    version: Schema.Number,
    publishedAt: Schema.String,
  }),
  /** The role, without its stock sheet: `--sheet` provides it. */
  slot: Schema.optionalKey(CharacterSlot),
  /** Several roles instead of `slot`, for an export whose pages list `figures`; `--sheet <slotId>=<image>` for each. */
  slots: Schema.optionalKey(Schema.Array(CharacterSlot)),
  styleWords: Schema.String,
  /** The page whose composite, cropped around its figure, is the style reference for the sheets. */
  styleReferencePage: Schema.String,
  /** Pages whose text frames get a panel the export lacks, where dark text would sit on dark art. */
  panelPages: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** How far a window reaches past the figure's box, as a share of the box, before it grows to 2:3 or 3:2. */
const WINDOW_PAD = 0.16;

type PixelRect = readonly [number, number, number, number];

/** A span of `size` centred on `center`, moved inside [0, limit]; cut to `limit` when larger. */
const fit = (center: number, size: number, limit: number) => {
  const s = Math.min(size, limit);
  const start = Math.min(Math.max(0, center - s / 2), limit - s);
  return [start, start + s] as const;
};

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as unknown;

/** The bounds of pixels with alpha ≥ 0.1, or null when there are none. */
const alphaBounds = (rgba: Buffer, width: number, height: number): PixelRect | null => {
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3]! < 26) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
};

export const convertExport = async (options: {
  exportDir: string;
  config: typeof Config.Type;
  /** Each role's stock sheet image, by slotId. */
  sheets: Readonly<Record<string, string>>;
  out: string;
  stockDir?: string;
}): Promise<{ manifest: StoryManifest; notes: ReadonlyArray<string> }> => {
  const { exportDir, config, out } = options;
  const exported = Schema.decodeUnknownSync(ExportFile)(await readJson(join(exportDir, "export.json")));
  const layout = (await readJson(join(exportDir, "text-layout.json"))) as {
    trim: StoryManifest["trim"];
    fonts: StoryManifest["fonts"];
    textStyles: StoryManifest["textStyles"];
    pages: ReadonlyArray<{
      pageId: string;
      art: "full-bleed" | "left-half";
      frames: StoryManifest["pages"][number]["frames"];
    }>;
  };
  // Importing refuses the same (D35); failing here saves building the directory first.
  const trimProblems = printTrimIssues(layout.trim);
  if (trimProblems.length > 0) throw new Error(`text-layout.json's trim won't print:\n${trimProblems.join("\n")}`);
  const [W, H] = exported.canvas;
  const notes: Array<string> = [];
  // Pixels to thousandths, rounding outward so the rect covers every pixel; and back, for cropping to the rect.
  const toPermille = ([x0, y0, x1, y1]: PixelRect): Rect => [
    Math.max(0, Math.floor((x0 / W) * 1000)),
    Math.max(0, Math.floor((y0 / H) * 1000)),
    Math.min(1000, Math.ceil((x1 / W) * 1000)),
    Math.min(1000, Math.ceil((y1 / H) * 1000)),
  ];
  const toPixels = ([x0, y0, x1, y1]: Rect): PixelRect => [
    Math.round((x0 * W) / 1000),
    Math.round((y0 * H) / 1000),
    Math.round((x1 * W) / 1000),
    Math.round((y1 * H) / 1000),
  ];
  // The box padded, grown to 2:3 (taller than wide in pixels) or 3:2, then moved inside the page; cut only where it
  // is larger than the page.
  const windowOf = (box: PixelRect): Rect => {
    let w = (box[2] - box[0]) * (1 + 2 * WINDOW_PAD);
    let h = (box[3] - box[1]) * (1 + 2 * WINDOW_PAD);
    if (h >= w) {
      w = Math.max(w, (h * 2) / 3);
      h = Math.max(h, w * 1.5);
    } else {
      h = Math.max(h, (w * 2) / 3);
      w = Math.max(w, h * 1.5);
    }
    const [x0, x1] = fit((box[0] + box[2]) / 2, w, W);
    const [y0, y1] = fit((box[1] + box[3]) / 2, h, H);
    return toPermille([x0, y0, x1, y1]);
  };

  await rm(out, { recursive: true, force: true });
  const write = async (path: string, body: Buffer | string) => {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), body);
  };
  const fonts = await Promise.all(
    layout.fonts.map(async (font) => {
      const asset = `fonts/${basename(font.asset)}`;
      await write(asset, await readFile(join(exportDir, "assets", font.asset)));
      return { ...font, asset };
    }),
  );
  const slots = config.slots ?? (config.slot ? [config.slot] : []);
  if (slots.length === 0) throw new Error("the config needs slot or slots");
  const characterSlots = await Promise.all(
    slots.map(async (slot) => {
      const sheet = options.sheets[slot.slotId];
      if (!sheet) throw new Error(`no --sheet for ${slot.slotId}`);
      const stockSheet = `sheets/${slot.slotId}${extname(sheet).toLowerCase()}`;
      await write(stockSheet, await readFile(sheet));
      return { ...slot, stockSheet };
    }),
  );

  const pages: Array<StoryManifest["pages"][number]> = [];
  let styleReference: string | undefined;
  for (const page of exported.pages) {
    const text = layout.pages.find((p) => p.pageId === page.pageId);
    if (!text) throw new Error(`text-layout.json has no page ${page.pageId}`);
    const dir = join(exportDir, "pages", page.pageId);
    const id = page.pageId;
    const plate = `pages/${id}/plate.jpg`;
    await write(plate, await readFile(join(dir, "plate.jpg")));
    const layers: Array<StoryManifest["pages"][number]["illustration"]["layers"][number]> = [
      { kind: "art", asset: plate },
    ];
    const scenery = page.occluders.filter((file) => page.occluderKinds[file] !== "hero");
    const hats = page.occluders.filter((file) => page.occluderKinds[file] === "hero");
    // A one-role export names its figure hero.png; a page with several roles lists them, each in <slotId>.png.
    const figures =
      page.figures?.map((figure) => ({ ...figure, file: `${figure.slotId}.png` })) ??
      (page.hero ? [{ slotId: slots[0]!.slotId, ...page.hero, file: "hero.png" }] : []);
    if (hats.length && page.figures) throw new Error(`${id}: a hat occluder needs a one-role page`);
    const canvases: Array<Buffer> = [];
    let union: PixelRect | null = null;
    for (const { slotId, box, head, file } of figures) {
      // The bald figure on the full canvas, with the figure's own hat or helmet merged in.
      const canvas = await sharp({
        create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([
          { input: join(dir, file), left: Math.round(box[0]), top: Math.round(box[1]) },
          ...hats.map((hat) => ({ input: join(dir, "occluders", hat), left: 0, top: 0 })),
        ])
        .png()
        .toBuffer();
      canvases.push(canvas);
      const raw = await sharp(canvas).raw().toBuffer();
      const bounds = alphaBounds(raw, W, H);
      if (!bounds) throw new Error(`${id}: the ${slotId} figure has no opaque pixels`);
      union = union
        ? [
            Math.min(union[0], bounds[0]),
            Math.min(union[1], bounds[1]),
            Math.max(union[2], bounds[2]),
            Math.max(union[3], bounds[3]),
          ]
        : bounds;
      const figureBox = toPermille(bounds);
      const [cx0, cy0, cx1, cy1] = toPixels(figureBox);
      const reference = `pages/${id}/${slotId}/reference.png`;
      await write(
        reference,
        await sharp(canvas)
          .extract({ left: cx0, top: cy0, width: Math.min(W, cx1) - cx0, height: Math.min(H, cy1) - cy0 })
          .png()
          .toBuffer(),
      );
      const window = windowOf(bounds);
      // The head inside the figure: an export's head hole can reach past the drawn figure (p13's covers most of it).
      const headBox = toPermille([
        Math.max(head[0], bounds[0]),
        Math.max(head[1], bounds[1]),
        Math.min(head[2], bounds[2]),
        Math.min(head[3], bounds[3]),
      ]);
      const headShare =
        ((headBox[2] - headBox[0]) * (headBox[3] - headBox[1])) /
        ((figureBox[2] - figureBox[0]) * (figureBox[3] - figureBox[1]));
      if (headShare > 0.5)
        notes.push(`${id}: the ${slotId} head box covers ${Math.round(headShare * 100)}% of the figure`);
      if (hats.length) notes.push(`${id}: merged ${hats.join(", ")} into the bald reference`);
      const stock = `pages/${id}/${slotId}/stock.png`;
      // Stock figures are <pageId>.png for a one-role story, <pageId>-<slotId>.png otherwise.
      const stockSource = options.stockDir
        ? join(options.stockDir, slots.length === 1 ? `${id}.png` : `${id}-${slotId}.png`)
        : undefined;
      if (stockSource) await write(stock, await readFile(stockSource));
      else {
        // Placeholder: the bald reference where it sits in the window, at the window's generation size.
        const size = generationSize(window, illustrationAspect(layout.trim, text.art));
        const [wx0, wy0, wx1, wy1] = toPixels(window);
        const sx = size.width / (wx1 - wx0);
        const sy = size.height / (wy1 - wy0);
        const left = Math.round((cx0 - wx0) * sx);
        const top = Math.round((cy0 - wy0) * sy);
        const width = Math.max(1, Math.round((cx1 - wx0) * sx) - left);
        const height = Math.max(1, Math.round((cy1 - wy0) * sy) - top);
        const placed = await sharp(join(out, reference)).resize(width, height, { fit: "fill" }).png().toBuffer();
        await write(
          stock,
          await sharp({ create: { ...size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite([{ input: placed, left, top }])
            .png()
            .toBuffer(),
        );
      }
      layers.push({ kind: "photoFigure", slotId, reference, box: figureBox, window, head: headBox, stock });
    }
    if (id === config.styleReferencePage && union) {
      // The painted page around its figures, as drawn: plate, bald figures, scenery.
      const composite = await sharp(join(dir, "plate.jpg"))
        .composite([
          ...canvases.map((input) => ({ input, left: 0, top: 0 })),
          ...scenery.map((file) => ({ input: join(dir, "occluders", file), left: 0, top: 0 })),
        ])
        .png()
        .toBuffer();
      const [wx0, wy0, wx1, wy1] = toPixels(windowOf(union));
      styleReference = "style/reference.jpg";
      await write(
        styleReference,
        await sharp(composite)
          .extract({ left: wx0, top: wy0, width: Math.min(W, wx1) - wx0, height: Math.min(H, wy1) - wy0 })
          .resize({ width: 1024, height: 1024, fit: "inside" })
          .jpeg({ quality: 90 })
          .toBuffer(),
      );
    }
    for (const file of scenery) {
      const asset = `pages/${id}/occluders/${file}`;
      await write(asset, await readFile(join(dir, "occluders", file)));
      layers.push({ kind: "art", asset });
    }
    const frames = config.panelPages?.includes(id)
      ? text.frames.map((frame) => ({ ...frame, panel: true }))
      : text.frames;
    pages.push({ pageId: id, art: text.art, frames, illustration: { layers } });
  }
  if (!styleReference) throw new Error(`style reference page ${config.styleReferencePage} has no figure`);

  const manifest = await Effect.runPromise(
    decodeStoryManifest({
      formatVersion: FORMAT_VERSION,
      trim: layout.trim,
      fonts,
      textStyles: layout.textStyles,
      characterSlots,
      photo: { styleReference, styleWords: config.styleWords, promptVersion: "photo-hero-v3" },
      pages,
    }),
  );
  await write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await write("story.json", `${JSON.stringify(config.story, null, 2)}\n`);
  return { manifest, notes };
};

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      export: { type: "string" },
      config: { type: "string" },
      sheet: { type: "string", multiple: true },
      out: { type: "string" },
      stock: { type: "string" },
    },
  });
  if (!values.export || !values.config || !values.sheet?.length || !values.out) {
    console.error(
      "usage: node packages/core/src/story-from-export.ts --export <dir> --config <json> --sheet <image> --out <dir> [--stock <dir>]\n" +
        "  several roles: --sheet <slotId>=<image> for each",
    );
    process.exit(2);
  }
  const config = Schema.decodeUnknownSync(Config)(await readJson(resolve(values.config)));
  // One role takes a bare --sheet <image>; several take --sheet <slotId>=<image> each.
  const sheets = Object.fromEntries(
    values.sheet.map((arg) => {
      const at = arg.indexOf("=");
      return at < 0 ? [config.slot?.slotId ?? "", resolve(arg)] : [arg.slice(0, at), resolve(arg.slice(at + 1))];
    }),
  );
  const { manifest, notes } = await convertExport({
    exportDir: resolve(values.export),
    config,
    sheets,
    out: resolve(values.out),
    ...(values.stock ? { stockDir: resolve(values.stock) } : {}),
  });
  const figures = manifest.pages.flatMap((page) => page.illustration.layers.filter((l) => l.kind === "photoFigure"));
  console.log(
    `${config.story.title}: ${manifest.pages.length} pages, ${figures.length} figures, written to ${values.out}`,
  );
  for (const note of notes) console.log(`  ${note}`);
}
