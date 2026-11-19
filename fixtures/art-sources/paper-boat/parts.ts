// Paper Boat v3: every pose's parts, made the way `part.generate` makes them (D36): the base padded for the provider
// (prepareBase), an in-place edit with the app's own prompt (partPrompt), then the cut-out (cutOutLayer) split into
// the part and any skin the model drew. Edits are cached in raw/v3/parts by gen.py, so a rerun only cuts. Review
// images (lightest skin with darkest hair, and the reverse, with the occluder on top) go to out/v3/review.
// A retake is a new `take` in TAKES (raw/v3/parts/<name>-t2.png ...), counted in out/v3/parts.json.
// usage (repo root): node fixtures/art-sources/paper-boat/parts.ts
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { composeForReview } from "../../../packages/core/src/imports/images.ts";
import { cutOutLayer, prepareBase } from "../../../packages/core/src/parts/images.ts";
import { partPrompt } from "../../../packages/core/src/parts/parts.ts";
import { openAIPrompt } from "../../../packages/core/src/providers/openai.ts";
import { POSES } from "./poses.ts";

const run = promisify(execFile);
const HERE = new URL("./", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(`${HERE}../../stories/paper-boat/manifest.json`, "utf8"));
const skins = manifest.palettes.skin, hairs = manifest.palettes.hairColour;

type Rect = [number, number, number, number];
/** Where each axis may draw, in thousandths of the pose's crop, read off a grid over the base (D36: the author's zone). */
const ZONES: Record<string, { hair: Rect; glasses: Rect; facialHair?: Rect }> = {
  "hero/point": { hair: [330, 0, 1000, 480], glasses: [440, 90, 900, 240] },
  "hero/kneel": { hair: [150, 0, 1000, 720], glasses: [600, 200, 1000, 420] },
  "hero/sit": { hair: [0, 0, 820, 720], glasses: [300, 120, 780, 330] },
  "grownup/back": { hair: [220, 0, 800, 360], glasses: [280, 40, 780, 190] },
  "grownup/sit": { hair: [120, 0, 760, 560], glasses: [280, 100, 720, 280], facialHair: [230, 180, 700, 400] },
};
const ORIGINAL = ["hair:short", "hair:curly", "hair:long", "glasses:round"];
/** D43's options, on one pose per role only (the Space's steer, 2026-11-19): the rest come later as additions. */
const EXTRA: Record<string, ReadonlyArray<string>> = {
  "hero/point/round": ["hair:buzz", "hair:ponytail", "hair:braids", "hair:afro", "hair:locs", "hair:bun"],
  "grownup/sit/round": ["facial-hair:stubble", "facial-hair:moustache", "facial-hair:beard"],
};
/** Retakes after review: the take whose edit is kept, by part name. */
const TAKES: Record<string, number> = JSON.parse(existsSync(`${HERE}takes.json`) ? readFileSync(`${HERE}takes.json`, "utf8") : "{}");

const axisOf = (option: string) => (option.startsWith("glasses:") ? "glasses" : option.startsWith("facial-hair:") ? "facialHair" : "hair") as "hair" | "glasses" | "facialHair";
const slug = (option: string) => option.split(":")[1]!;

interface Job { role: string; pose: string; face: string; option: string; name: string; edit: string; input: string; size: string; prompt: string }
const jobs: Array<Job> = [];
const prepared = new Map<string, Awaited<ReturnType<typeof prepareBase>>>();
mkdirSync(`${HERE}raw/v3/parts`, { recursive: true });
mkdirSync(`${HERE}raw/v3/inputs`, { recursive: true });
for (const pose of POSES) {
  for (const face of pose.faces) {
    const key = `${pose.role}/${pose.pose}/${face}`;
    const base = await prepareBase(new Uint8Array(readFileSync(`${HERE}out/v3/${pose.role}/${pose.pose}/base-${face}.png`)));
    prepared.set(key, base);
    const input = `${HERE}raw/v3/inputs/${pose.role}-${pose.pose}-${face}.png`;
    writeFileSync(input, base.input);
    const age = pose.role === "hero" ? "young-child" : "adult";
    for (const option of [...ORIGINAL, ...(EXTRA[key] ?? [])]) {
      const name = `${pose.role}-${pose.pose}-${face}-${slug(option)}`;
      const take = TAKES[name] ?? 1;
      const edit = `${HERE}raw/v3/parts/${name}${take > 1 ? `-t${take}` : ""}.png`;
      jobs.push({ role: pose.role, pose: pose.pose, face, option, name, edit, input, size: `${base.inputWidth}x${base.inputHeight}`, prompt: openAIPrompt(partPrompt(age, option)) });
    }
  }
}

// The edits, eight at a time (gen.py skips any that exist).
const queue = jobs.filter((job) => !existsSync(job.edit));
console.log(`${jobs.length} parts, ${queue.length} edits to make`);
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { stdout } = await run("python3", [`${HERE}gen.py`, "edit", job.edit, job.input, job.size, "medium", job.prompt], { cwd: HERE });
      console.log(stdout.trim().slice(0, 90));
    }
  }),
);

// The cut-outs and their review images.
mkdirSync(`${HERE}out/v3/review`, { recursive: true });
const parts: Array<Record<string, unknown>> = [];
for (const job of jobs) {
  const dir = `${HERE}out/v3/${job.role}/${job.pose}`;
  const base = prepared.get(`${job.role}/${job.pose}/${job.face}`)!;
  const axis = axisOf(job.option);
  const zone = ZONES[`${job.role}/${job.pose}`]![axis]!;
  const skinMask = new Uint8Array(readFileSync(`${dir}/base-${job.face}-skin.png`));
  const { layers, metrics } = await cutOutLayer(base, new Uint8Array(readFileSync(job.edit)), skinMask, zone, { neutral: axis !== "glasses" });
  const placed = layers.map((layer) => {
    const asset = `${job.face}-${slug(job.option)}${layer.region === "skin" ? "-skin" : ""}.png`;
    writeFileSync(`${dir}/${asset}`, layer.png);
    return { asset: `figures/${job.role}/${job.pose}/${asset}`, at: layer.at, palette: layer.region === "skin" ? "skin" : axis === "glasses" ? "none" : "hairColour", png: layer.png };
  });
  const occluder = existsSync(`${dir}/base-${job.face}-occluder.png`)
    ? { asset: new Uint8Array(readFileSync(`${dir}/base-${job.face}-occluder.png`)), skinMask: new Uint8Array(readFileSync(`${dir}/base-${job.face}-occluder-skin.png`)) }
    : null;
  const overlay = existsSync(`${dir}/base-${job.face}-overlay.png`) ? new Uint8Array(readFileSync(`${dir}/base-${job.face}-overlay.png`)) : null;
  const figure = { base: new Uint8Array(readFileSync(`${dir}/base-${job.face}.png`)), skinMask, overlay, occluder, parts: placed.map(({ png, at, palette }) => ({ png, at, palette: palette as "skin" | "hairColour" | "none" })) };
  const [light, dark] = await Promise.all([
    composeForReview(figure, { skin: skins["skin:s1"], hair: hairs["hair-colour:black"] }, base.width, base.height),
    composeForReview(figure, { skin: skins["skin:s5"], hair: hairs["hair-colour:blonde"] }, base.width, base.height),
  ]);
  writeFileSync(`${HERE}out/v3/review/${job.name}-light.png`, light);
  writeFileSync(`${HERE}out/v3/review/${job.name}-dark.png`, dark);
  parts.push({ role: job.role, pose: job.pose, face: `face:${job.face}`, axis, option: job.option, take: TAKES[job.name] ?? 1, layers: placed.map(({ png: _, ...layer }) => layer), metrics });
  console.log(job.name, placed.map((layer) => `${layer.palette}@${layer.at.join(",")}`).join(" "));
}
writeFileSync(`${HERE}out/v3/parts.json`, JSON.stringify(parts, null, 1));
