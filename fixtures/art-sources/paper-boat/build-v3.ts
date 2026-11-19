// Paper Boat v3 (published as v5): writes fixtures/stories/paper-boat from v2's (build.py's) and the pose figures
// (bases.ts, parts.ts). The manifest holds the original options and D43's on one pose per role (IN_MANIFEST); every
// other D43 part, the standing grown-up's included, goes to additions/2.json (D41), since v5 is published.
// Keeps v2's plates, reeds, fonts, palettes and the grown-up's standing front figure (page 2); every other figure is
// a pose. Each pose's two faces share its crop; a pose drawn in one face (seen from behind) uses it for both.
// Idempotent: run it again after a change to the poses.
// usage (repo root): node fixtures/art-sources/paper-boat/build-v3.ts
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { IN_MANIFEST, POSES } from "./poses.ts";

const HERE = new URL("./", import.meta.url).pathname;
const DST = `${HERE}../../stories/paper-boat/`;
const OUT = `${HERE}out/v3/`;
const manifest = JSON.parse(readFileSync(`${DST}manifest.json`, "utf8"));
const AGES: Record<string, ReadonlyArray<string>> = { hero: ["young-child", "older-child"], grownup: ["adult", "older-adult"] };
const FACES = ["round", "oval"] as const;
const fileName = (option: string) => (option === "glasses:round" ? "glasses" : option.split(":")[1]!);

// v2's standing grown-up, as v2 placed it (the front figure files stay where v2 put them).
const front = manifest.pages
  .flatMap((page: any) => page.illustration.layers)
  .find((layer: any) => layer.kind === "figure" && layer.slotId === "grownup" && layer.bases[0].asset === "figures/grownup/base-round.png");

type PartRow = { role: string; pose: string; face: string; axis: string; option: string; layers: Array<{ asset: string; at: number[]; palette: string }> };
const parts: Array<PartRow> = JSON.parse(readFileSync(`${OUT}parts.json`, "utf8"));

const ORIGINAL = new Set(["hair:short", "hair:curly", "hair:long", "glasses:round"]);
/** additions/2.json's figures, by page and role. */
const added: Array<{ pageId: string; slotId: string; parts: Array<unknown> }> = [];
const addTo = (pageId: string, slotId: string, parts: Array<unknown>) => parts.length > 0 && added.push({ pageId, slotId, parts });

/** One figure's parts from parts.json, copied into the story, for both faces at every age of its role. */
const partsOf = (role: string, name: string, drawn: (face: string) => string, keep: (face: string, option: string) => boolean) => {
  const from = `${OUT}${role}/${name}/`;
  const dir = `figures/${role}/${name}/`;
  mkdirSync(DST + dir, { recursive: true });
  return AGES[role]!.flatMap((age) =>
    FACES.flatMap((face) =>
      parts
        .filter((part) => part.role === role && part.pose === name && part.face === `face:${drawn(face)}` && keep(drawn(face), part.option))
        .flatMap((part) =>
          part.layers.map((layer) => {
            const source = layer.asset.split("/").at(-1)!;
            const target = source.replace(/-[a-z]+(-skin)?\.png$/, `-${fileName(part.option)}$1.png`);
            copyFileSync(from + source, DST + dir + target);
            return { age, face: `face:${face}`, axis: part.axis, option: part.option, asset: dir + target, at: layer.at, palette: layer.palette, approved: true };
          }),
        ),
    ),
  );
};

/** One pose's figure layer at `box` on `pageId`, copying its files into the story; its later parts go to the addition. */
const pose = (pageId: string, role: string, name: string, box: readonly [number, number, number, number]) => {
  const spec = POSES.find((p) => p.role === role && p.pose === name)!;
  const from = `${OUT}${role}/${name}/`;
  const dir = `figures/${role}/${name}/`;
  mkdirSync(DST + dir, { recursive: true });
  const copy = (src: string, dst = src) => (copyFileSync(from + src, DST + dir + dst), dir + dst);
  const drawn = (face: string) => (spec.faces.includes(face as never) ? face : spec.faces[0]!);
  const bases = AGES[role]!.flatMap((age) =>
    FACES.map((face) => {
      const f = drawn(face);
      return {
        age,
        face: `face:${face}`,
        asset: copy(`base-${f}.png`),
        skinMask: copy(`base-${f}-skin.png`),
        ...(existsSync(`${from}base-${f}-overlay.png`) ? { overlay: copy(`base-${f}-overlay.png`) } : {}),
        ...(existsSync(`${from}base-${f}-occluder.png`) ? { occluder: { asset: copy(`base-${f}-occluder.png`), skinMask: copy(`base-${f}-occluder-skin.png`) } } : {}),
      };
    }),
  );
  const inManifest = (face: string, option: string) => ORIGINAL.has(option) || (IN_MANIFEST[`${role}/${name}/${face}`] ?? []).includes(option);
  const figureParts = partsOf(role, name, drawn, inManifest);
  addTo(pageId, role, partsOf(role, name, drawn, (face, option) => !inManifest(face, option)));
  return { kind: "figure", slotId: role, box, bases, parts: figureParts };
};

/** A box with the pose's crop aspect: its left edge at x0, its bottom at `bottom`, `height` thousandths tall (the page is square). */
const at = (role: string, name: string, x0: number, bottom: number, height: number) => {
  const [w, h] = JSON.parse(readFileSync(`${OUT}${role}/${name}/base.json`, "utf8")).size as [number, number];
  return [x0, bottom - height, x0 + Math.round((height * w) / h), bottom] as const;
};

for (const role of ["hero", "grownup"]) for (const name of readdirSync(`${DST}figures/${role}`)) if (name === "front" || POSES.some((p) => p.role === role && p.pose === name)) rmSync(`${DST}figures/${role}/${name}`, { recursive: true });
const art = (asset: string) => ({ kind: "art", asset });
const v3 = {
  ...manifest,
  // Facial hair (D43) under hair and glasses, where a beard goes.
  partOrder: ["facialHair", "hair", "glasses"],
  pages: [
    {
      pageId: "p01",
      layout: "full-bleed-art/text-bottom",
      text: [
        { style: "title", content: "The Paper Boat" },
        {
          style: "body",
          content: "After the rain, {{hero.name}} and {{grownup.title}} folded yesterday’s newspaper into a boat with a pointy sail. “The pond!” {{hero.name}} pointed, and off they went.",
        },
      ],
      illustration: { layers: [art("pages/p01.jpg"), pose("p01", "grownup", "back", at("grownup", "back", 330, 680, 470)), pose("p01", "hero", "point", at("hero", "point", 560, 700, 360))] },
    },
    {
      pageId: "p02",
      layout: "full-bleed-art/text-top",
      text: [{ style: "body", content: "{{hero.name}} knelt and set the boat down on the water. It wobbled. It turned. Then the wind found its sail, and away it went." }],
      illustration: {
        layers: [art("pages/p02.jpg"), { ...front, box: [0, 330, 290, 910] }, pose("p02", "hero", "kneel", at("hero", "kneel", 140, 800, 420)), art("pages/p02-reeds.webp")],
      },
    },
    {
      pageId: "p03",
      layout: "full-bleed-art/text-bottom",
      text: [
        {
          style: "body",
          content: "They sat on the bank and watched it sail all afternoon, all the way to the willow island. “It’s exploring,” said {{grownup.title}}. {{hero.They}} waved until the sky turned pink.",
        },
      ],
      illustration: { layers: [art("pages/p03.jpg"), pose("p03", "grownup", "sit", at("grownup", "sit", 150, 760, 400)), pose("p03", "hero", "sit", at("hero", "sit", 450, 760, 320))] },
    },
  ],
};
writeFileSync(`${DST}manifest.json`, JSON.stringify(v3, null, 2) + "\n");

// v2's standing grown-up gets D43's options as an addition only.
addTo("p02", "grownup", partsOf("grownup", "front", (face) => face, () => true));
const addition = { figures: added };
writeFileSync(`${DST}additions/2.json`, JSON.stringify(addition, null, 1) + "\n");

// v2's front figures that no page draws any more.
const used = new Set(JSON.stringify([v3, addition]).match(/figures\/[^"]+/g));
for (const role of ["hero", "grownup"]) for (const file of readdirSync(`${DST}figures/${role}`)) if (file.endsWith(".png") && !used.has(`figures/${role}/${file}`)) rmSync(`${DST}figures/${role}/${file}`);

const story = JSON.parse(readFileSync(`${DST}story.json`, "utf8"));
// Production published this as v5 (an app-made v3 was already there). Dated before D43's options were added (19:30),
// so the manifest needn't draw them; additions/2.json does (D41, D43).
writeFileSync(`${DST}story.json`, JSON.stringify({ ...story, version: 5, publishedAt: "2026-11-19T19:00:00Z" }, null, 2) + "\n");
console.log(`addition 2: ${added.reduce((n, f) => n + f.parts.length, 0)} parts on ${added.length} figures`);
console.log("built v5:", v3.pages.map((page: any) => `${page.pageId}: ${page.illustration.layers.filter((l: any) => l.kind === "figure").map((l: any) => `${l.slotId} ${JSON.stringify(l.box)}`).join(", ")}`).join("; "));
