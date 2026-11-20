// Paper Boat v6: the hair of v5 without bald scalp showing (thread T-01a1f5c6). Two causes, each handled once:
// - drawn smaller than the bald head (crownGap above CROWN_GAP_LIMIT): three parts redrawn, an edit with a note asking
//   the hair to cover the scalp's whole outline (cached in raw/v6, made with gen.py if missing), cut with cutOutLayer;
// - stopping short of the head's silhouette (its pencil outline is as dark as the hair, so the matte can't see the
//   gap): every other hair and facial hair asset, published and added, gets coverOutline on its own base, as
//   cutOutLayer now does itself for every new part.
// Writes fixtures/stories/paper-boat in place (manifest, additions, assets) and sets story.json to version 6.
// usage (repo root): node fixtures/art-sources/paper-boat/build-v6.ts
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { rasterize } from "../../../packages/core/src/looks/recolour.ts";
import { coverOutline } from "../../../packages/core/src/parts/cutout.ts";
import { cutOutLayer, encodeLayer, prepareBase, rectToPixels } from "../../../packages/core/src/parts/images.ts";
import { partPrompt } from "../../../packages/core/src/parts/parts.ts";
import { openAIPrompt } from "../../../packages/core/src/providers/openai.ts";

const HERE = new URL("./", import.meta.url).pathname;
const STORY = `${HERE}../../stories/paper-boat/`;
const run = promisify(execFile);
const json = (path: string) => JSON.parse(readFileSync(STORY + path, "utf8"));
/** Writes a story file if its content changed, in the file's own indentation. */
const write = (path: string, value: unknown) => {
  const text = readFileSync(STORY + path, "utf8");
  if (JSON.stringify(JSON.parse(text)) === JSON.stringify(value)) return;
  writeFileSync(STORY + path, `${JSON.stringify(value, null, text.split("\n")[1]!.match(/^ */)![0].length)}\n`);
};
const manifest = json("manifest.json");
const additions = readdirSync(`${STORY}additions`)
  .sort((a, b) => parseInt(a) - parseInt(b))
  .map((file) => ({ file, body: json(`additions/${file}`) }));

const COVER =
  "Cover the entire existing bald scalp with hair, following its exact outer silhouette over the crown and the back of the head. Keep the head size and the crown of the scalp exactly where they are; leave no bald crescent or patch above or behind the hair.";
const BUN =
  "Cover the entire existing bald scalp with swept-back hair, following its exact outer silhouette. Put a small compact bun behind the head, not above it. Keep the head size and the crown of the scalp exactly where they are; leave no bald crescent above the hair.";
/** The redrawn parts: v5's asset, its pose's hair zone (parts.ts), and the note. */
const REDRAWN = [
  {
    name: "hero-point-round-bun",
    asset: "figures/hero/point/round-bun.png",
    base: "figures/hero/point/base-round",
    age: "young-child",
    option: "hair:bun",
    zone: [330, 0, 1000, 480],
    note: BUN,
  },
  {
    name: "hero-point-round-buzz",
    asset: "figures/hero/point/round-buzz.png",
    base: "figures/hero/point/base-round",
    age: "young-child",
    option: "hair:buzz",
    zone: [330, 0, 1000, 480],
    note: COVER,
  },
  {
    name: "grownup-back-round-short",
    asset: "figures/grownup/back/round-short.png",
    base: "figures/grownup/back/base-round",
    age: "adult",
    option: "hair:short",
    zone: [220, 0, 800, 360],
    note: COVER,
  },
] as const;

/** Every figure's bases and parts, published and added, as [bases, parts] lists to rewrite in place. */
const figures = manifest.pages.flatMap((page: any) =>
  page.illustration.layers
    .filter((layer: any) => layer.kind === "figure")
    .map((layer: any) => {
      const added = additions.flatMap(({ body }) =>
        (body.figures ?? []).filter((f: any) => f.pageId === page.pageId && f.slotId === layer.slotId),
      );
      return { bases: [layer.bases, ...added.map((f: any) => f.bases ?? [])].flat(), owners: [layer, ...added] };
    }),
);
/** Replaces each owner's parts with that asset by `layers` (one entry per layer, same appearance). */
const replace = (
  asset: string,
  layers: ReadonlyArray<{ asset: string; at: number[]; palette: string }>,
  drop: ReadonlyArray<string> = [],
) => {
  for (const { owners } of figures)
    for (const owner of owners)
      if (owner.parts)
        owner.parts = owner.parts.flatMap((part: any) =>
          drop.includes(part.asset)
            ? []
            : part.asset === asset
              ? layers.map((layer) => ({ ...part, asset: layer.asset, at: layer.at, palette: layer.palette }))
              : [part],
        );
};

// 1. The redrawn parts.
mkdirSync(`${HERE}raw/v6`, { recursive: true });
const redrawn = new Set<string>();
for (const job of REDRAWN) {
  const baseFile = new Uint8Array(readFileSync(`${STORY}${job.base}.png`));
  const prepared = await prepareBase(baseFile);
  const edit = `${HERE}raw/v6/${job.name}.png`;
  if (!existsSync(edit)) {
    const input = `${HERE}raw/v6/${job.name}-input.png`;
    writeFileSync(input, prepared.input);
    await run(
      "python3",
      [
        `${HERE}gen.py`,
        "edit",
        edit,
        input,
        `${prepared.inputWidth}x${prepared.inputHeight}`,
        "medium",
        openAIPrompt(partPrompt(job.age, job.option, job.note)),
      ],
      { cwd: HERE },
    );
  }
  const skinMask = new Uint8Array(readFileSync(`${STORY}${job.base}-skin.png`));
  const { layers, metrics } = await cutOutLayer(
    prepared,
    new Uint8Array(readFileSync(edit)),
    skinMask,
    job.zone as never,
    { neutral: true, figure: baseFile },
  );
  const dir = job.asset.slice(0, job.asset.lastIndexOf("/") + 1);
  const written = layers.map((layer) => {
    const asset = layer.region === "skin" ? job.asset.replace(/\.png$/, "-skin.png") : job.asset;
    writeFileSync(STORY + asset, layer.png);
    return { asset, at: [...layer.at], palette: layer.region === "skin" ? "skin" : "hairColour" };
  });
  // A skin layer the old drawing had and the new one hasn't goes.
  const oldSkin = job.asset.replace(/\.png$/, "-skin.png");
  const drop = written.some((layer) => layer.asset === oldSkin) ? [] : [oldSkin];
  for (const asset of drop) rmSync(STORY + asset, { force: true });
  replace(job.asset, written, drop);
  redrawn.add(job.asset);
  console.log(
    job.name,
    `crownGap ${metrics.crownGap}`,
    `outline ${metrics.outlineCovered}`,
    written.map((l) => `${l.palette}@${l.at.join(",")}`).join(" "),
    dir,
  );
}

// 2. Every other hair and facial hair asset, on the base it is drawn on.
const done = new Set<string>(redrawn);
for (const { bases, owners } of figures) {
  for (const part of owners.flatMap((owner: any) => owner.parts ?? [])) {
    if (part.palette !== "hairColour" || done.has(part.asset)) continue;
    const base = bases.find((b: any) => b.age === part.age && b.face === part.face && b.features === part.features);
    if (!base) continue;
    done.add(part.asset);
    const { data: figureAlpha, info } = await (
      await rasterize(new Uint8Array(readFileSync(STORY + base.asset)))
    )
      .extractChannel(3)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const mask = new Uint8Array(
      await (
        await rasterize(new Uint8Array(readFileSync(STORY + base.skinMask)))
      )
        .resize(width, height, { fit: "fill" })
        .extractChannel(3)
        .raw()
        .toBuffer(),
    );
    const [x0, y0, x1, y1] = rectToPixels(part.at, width, height);
    const { data } = await (
      await rasterize(new Uint8Array(readFileSync(STORY + part.asset)))
    )
      .resize(x1 - x0, y1 - y0, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = new Float32Array(width * height);
    const colour = new Float32Array(width * height * 3);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = ((y - y0) * (x1 - x0) + (x - x0)) * 4,
          p = y * width + x;
        alpha[p] = data[o + 3]! / 255;
        for (let c = 0; c < 3; c++) colour[p * 3 + c] = data[o + c]! / 255;
      }
    const covered = coverOutline(
      alpha,
      colour,
      Float32Array.from(figureAlpha, (v) => v / 255),
      mask,
      width,
      height,
    );
    if (covered.covered === 0) continue;
    const layer = (await encodeLayer("part", covered.alpha, covered.colour, width, height))!;
    writeFileSync(STORY + part.asset, layer.png);
    replace(part.asset, [{ asset: part.asset, at: [...layer.at], palette: "hairColour" }]);
    console.log(part.asset, `outline ${covered.covered}`);
  }
}

write("manifest.json", manifest);
for (const { file, body } of additions) write(`additions/${file}`, body);
write("story.json", { ...json("story.json"), version: 6 });
