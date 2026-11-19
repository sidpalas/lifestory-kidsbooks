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
import { D43_FACIAL_HAIR, D43_HAIR, POSES } from "./poses.ts";

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
  "grownup/back": { hair: [220, 0, 800, 360], glasses: [280, 40, 780, 190], facialHair: [250, 60, 800, 230] },
  "grownup/sit": { hair: [120, 0, 760, 560], glasses: [280, 100, 720, 280], facialHair: [230, 180, 700, 400] },
  // v2's standing grown-up (page 2): its original parts are v2's; only D43's options are made here.
  "grownup/front": { hair: [80, 0, 920, 620], glasses: [240, 60, 780, 280], facialHair: [240, 110, 760, 245] },
};
const ORIGINAL = ["hair:short", "hair:curly", "hair:long", "glasses:round"];
/** Every option on every pose (Sid, 2026-11-19: full D43 coverage); facial hair from adult up, so the grown-up only. */
const OPTIONS = (role: string, pose: string) => [...(pose === "front" ? [] : ORIGINAL), ...D43_HAIR, ...(role === "grownup" ? D43_FACIAL_HAIR : [])];
const STORY = `${HERE}../../stories/paper-boat/`;
/** The figures to make parts for: the poses, and v2's standing grown-up from the story itself. */
const FIGURES = [
  ...POSES.flatMap((pose) => pose.faces.map((face) => ({ role: pose.role, pose: pose.pose, face, dir: `${HERE}out/v3/${pose.role}/${pose.pose}/` }))),
  ...(["round", "oval"] as const).map((face) => ({ role: "grownup", pose: "front", face, dir: `${STORY}figures/grownup/` })),
];
/** Retakes after review: the take whose edit is kept, by part name. */
const TAKES: Record<string, number> = JSON.parse(existsSync(`${HERE}takes.json`) ? readFileSync(`${HERE}takes.json`, "utf8") : "{}");

const axisOf = (option: string) => (option.startsWith("glasses:") ? "glasses" : option.startsWith("facial-hair:") ? "facialHair" : "hair") as "hair" | "glasses" | "facialHair";
const slug = (option: string) => option.split(":")[1]!;

interface Job { role: string; pose: string; face: string; option: string; name: string; edit: string; input: string; size: string; prompt: string; dir: string }
const jobs: Array<Job> = [];
const prepared = new Map<string, Awaited<ReturnType<typeof prepareBase>>>();
mkdirSync(`${HERE}raw/v3/parts`, { recursive: true });
mkdirSync(`${HERE}raw/v3/inputs`, { recursive: true });
for (const figure of FIGURES) {
  const key = `${figure.role}/${figure.pose}/${figure.face}`;
  const base = await prepareBase(new Uint8Array(readFileSync(`${figure.dir}base-${figure.face}.png`)));
  prepared.set(key, base);
  const input = `${HERE}raw/v3/inputs/${figure.role}-${figure.pose}-${figure.face}.png`;
  writeFileSync(input, base.input);
  const age = figure.role === "hero" ? "young-child" : "adult";
  for (const option of OPTIONS(figure.role, figure.pose)) {
    const name = `${figure.role}-${figure.pose}-${figure.face}-${slug(option)}`;
    const take = TAKES[name] ?? 1;
    const edit = `${HERE}raw/v3/parts/${name}${take > 1 ? `-t${take}` : ""}.png`;
    const note = take > 1 && option === "hair:bun"
      ? "Cover the entire existing bald scalp with swept-back hair, following its exact outer silhouette. Put a small compact bun behind the head, not above it. Keep the head size and the crown of the scalp exactly where they are; leave no bald crescent above the hair."
      : take > 1 && option === "facial-hair:stubble" && figure.pose === "front"
        ? "Dense, clearly visible dark brown five-o'clock shadow across both cheeks, jaw and upper lip, not just a chin patch. Use closely spaced dark ink dots with a soft dark wash between them."
        : null;
    jobs.push({ role: figure.role, pose: figure.pose, face: figure.face, option, name, edit, input, size: `${base.inputWidth}x${base.inputHeight}`, prompt: openAIPrompt(partPrompt(age, option, note)), dir: figure.dir });
  }
}

// Pass part names to review a retake without re-cutting all the already reviewed parts.
const requested = new Set(process.argv.slice(2));
const selected = jobs.filter((job) => requested.size === 0 || requested.has(job.name));
// The edits, four at a time (gen.py skips any that exist).
const queue = selected.filter((job) => !existsSync(job.edit));
console.log(`${selected.length} parts, ${queue.length} edits to make`);
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { stdout } = await run("python3", [`${HERE}gen.py`, "edit", job.edit, job.input, job.size, "medium", job.prompt], { cwd: HERE });
      console.log(stdout.trim().slice(0, 90));
    }
  }),
);

// The cut-outs and their review images.
mkdirSync(`${HERE}out/v3/review`, { recursive: true });
const parts: Array<Record<string, unknown>> = [];
for (const job of selected) {
  const dir = `${HERE}out/v3/${job.role}/${job.pose}`;
  mkdirSync(dir, { recursive: true });
  const base = prepared.get(`${job.role}/${job.pose}/${job.face}`)!;
  const axis = axisOf(job.option);
  const zone = ZONES[`${job.role}/${job.pose}`]![axis]!;
  const skinMask = new Uint8Array(readFileSync(`${job.dir}base-${job.face}-skin.png`));
  const { layers, metrics } = await cutOutLayer(base, new Uint8Array(readFileSync(job.edit)), skinMask, zone, { neutral: axis !== "glasses" });
  const placed = layers.map((layer) => {
    const asset = `${job.face}-${slug(job.option)}${layer.region === "skin" ? "-skin" : ""}.png`;
    writeFileSync(`${dir}/${asset}`, layer.png);
    return { asset: `figures/${job.role}/${job.pose}/${asset}`, at: layer.at, palette: layer.region === "skin" ? "skin" : axis === "glasses" ? "none" : "hairColour", png: layer.png };
  });
  const occluder = existsSync(`${job.dir}base-${job.face}-occluder.png`)
    ? { asset: new Uint8Array(readFileSync(`${job.dir}base-${job.face}-occluder.png`)), skinMask: new Uint8Array(readFileSync(`${job.dir}base-${job.face}-occluder-skin.png`)) }
    : null;
  const overlay = existsSync(`${job.dir}base-${job.face}-overlay.png`) ? new Uint8Array(readFileSync(`${job.dir}base-${job.face}-overlay.png`)) : null;
  const figure = { base: new Uint8Array(readFileSync(`${job.dir}base-${job.face}.png`)), skinMask, overlay, occluder, parts: placed.map(({ png, at, palette }) => ({ png, at, palette: palette as "skin" | "hairColour" | "none" })) };
  const [light, dark] = await Promise.all([
    composeForReview(figure, { skin: skins["skin:s1"], hair: hairs["hair-colour:black"] }, base.width, base.height),
    composeForReview(figure, { skin: skins["skin:s5"], hair: hairs["hair-colour:blonde"] }, base.width, base.height),
  ]);
  writeFileSync(`${HERE}out/v3/review/${job.name}-light.png`, light);
  writeFileSync(`${HERE}out/v3/review/${job.name}-dark.png`, dark);
  parts.push({ role: job.role, pose: job.pose, face: `face:${job.face}`, axis, option: job.option, take: TAKES[job.name] ?? 1, layers: placed.map(({ png: _, ...layer }) => layer), metrics });
  console.log(job.name, placed.map((layer) => `${layer.palette}@${layer.at.join(",")}`).join(" "));
}
const previous: Array<Record<string, unknown>> = requested.size > 0 ? JSON.parse(readFileSync(`${HERE}out/v3/parts.json`, "utf8")) : [];
const key = (part: Record<string, unknown>) => JSON.stringify([part.role, part.pose, part.face, part.option]);
const replacements = new Map(parts.map((part) => [key(part), part]));
writeFileSync(`${HERE}out/v3/parts.json`, JSON.stringify(previous.length > 0 ? previous.map((part) => replacements.get(key(part)) ?? part) : parts, null, 1));
