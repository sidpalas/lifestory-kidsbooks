// Paper Boat v3: the pose figures' bases, cut out of the generated poses (raw/v3) with the app's own art-import code
// (D42): figureOffPaper mats a figure drawn on paper, makeBase finds the skin, its mask, the face overlay and the
// occluder's skin. Both face types of a pose share one crop, so their parts land alike. The raised hand of the
// grown-up's sitting pose becomes the occluder: it is matted (cutOutPart, D36) against an edit with the arm lowered.
// usage (repo root): node fixtures/art-sources/paper-boat/bases.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { composeForReview, encodeMask, encodePng, figureOffPaper, makeBase, readRaster } from "../../../packages/core/src/imports/images.ts";
import { fillFigureHoles, findSkin, skinDistance, toLab } from "../../../packages/core/src/imports/figure.ts";
import { alphaBounds, components, cutOutPart, colourMatch, dilate, enclosed, erode, findShift, shiftImage } from "../../../packages/core/src/parts/cutout.ts";
import { toRgb } from "../../../packages/core/src/parts/images.ts";
import { POSES } from "./poses.ts";

const sharp = createRequire(new URL("../../../packages/core/package.json", import.meta.url))("sharp") as typeof import("sharp").default;
const HERE = new URL("./", import.meta.url).pathname;
const raw = (name: string) => new Uint8Array(readFileSync(`${HERE}raw/v3/${name}.png`));
const manifest = JSON.parse(readFileSync(`${HERE}../../stories/paper-boat/manifest.json`, "utf8"));
const skins = manifest.palettes.skin, hairs = manifest.palettes.hairColour;

/** The raw picture as figureOffPaper's input: no padding. */
const offPaper = async (bytes: Uint8Array, flip: boolean) => {
  const png = flip ? new Uint8Array(await sharp(bytes).flop().png().toBuffer()) : bytes;
  const { width, height } = await sharp(png).metadata();
  return { png, figure: await figureOffPaper({ width: width!, height: height!, padding: { left: 0, top: 0, paddedWidth: width!, paddedHeight: height! } }, png) };
};

const crop = async (png: Uint8Array, [x0, y0, x1, y1]: readonly number[]) =>
  new Uint8Array(await sharp(png).extract({ left: x0!, top: y0!, width: x1! - x0!, height: y1! - y0! }).png().toBuffer());

/**
 * Light spots inside the figure (the shine on a bald scalp) are drawn on the paper's white, so the matting made them
 * half transparent, and a gradient map turns near-white skin white on every skin tone. They are painted out with the
 * colour around them.
 */
const solidify = async (png: Uint8Array) => {
  const r = await readRaster(png, 4096);
  // Holes: what isn't opaque paint, or is paper-white paint (a shine painted as white).
  const white = (p: number) => Math.min(r.rgb[p * 3]!, r.rgb[p * 3 + 1]!, r.rgb[p * 3 + 2]!) > 0.83;
  const solid = Uint8Array.from(r.alpha, (a, p) => (a >= 0.95 && !white(p) ? 1 : 0));
  const total = solid.reduce((sum, v) => sum + v, 0);
  for (const hole of components(enclosed(solid, r.width, r.height), r.width, r.height)) {
    if (hole.length > 0.005 * total) continue;
    // The colour 2–4 px around the hole, from its bounding box.
    const inHole = new Set(hole);
    const xs = hole.map((p) => p % r.width), ys = hole.map((p) => Math.floor(p / r.width));
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = Math.max(0, Math.min(...ys) - 4); y <= Math.min(r.height - 1, Math.max(...ys) + 4); y++) {
      for (let x = Math.max(0, Math.min(...xs) - 4); x <= Math.min(r.width - 1, Math.max(...xs) + 4); x++) {
        const p = y * r.width + x;
        if (inHole.has(p) || r.alpha[p]! < 0.95) continue;
        for (let c = 0; c < 3; c++) sum[c]! += r.rgb[p * 3 + c]!;
        n++;
      }
    }
    // Only a spot inside skin: eye whites and teeth are ringed by dark line work and lips.
    if (n === 0 || (0.2126 * sum[0]! + 0.7152 * sum[1]! + 0.0722 * sum[2]!) / n < 0.62) continue;
    for (const p of hole) {
      for (let c = 0; c < 3; c++) r.rgb[p * 3 + c] = sum[c]! / n;
      r.alpha[p] = 1;
    }
  }
  return encodePng(r.rgb, r.alpha, r.width, r.height);
};

/** Puts the figure's own colours back inside `rects` (thousandths) and takes them out of the skin mask. */
const keepOutOfSkin = async (colour: Uint8Array, base: Uint8Array, mask: Uint8Array, rects: ReadonlyArray<readonly number[]>) => {
  const [c, b, m] = await Promise.all([readRaster(colour, 4096), readRaster(base, 4096), readRaster(mask, 4096)]);
  // Inside the rects, only colours close to the skin stay skin (the mask's own rule is 3σ, which takes in the shoes).
  const lab = toLab(c.rgb);
  const model = findSkin(lab, c.alpha, c.width)!;
  // Inside each rect, skin is what's close to the skin colour and joined to the leg coming in at the rect's top edge.
  for (const [x0, y0, x1, y1] of rects) {
    const [px0, py0, px1, py1] = [Math.round((x0! * b.width) / 1000), Math.round((y0! * b.height) / 1000), Math.round((x1! * b.width) / 1000), Math.round((y1! * b.height) / 1000)];
    const leg = new Uint8Array(b.alpha.length);
    const stack: Array<number> = [];
    const near = (p: number) => c.alpha[p]! > 0.5 && skinDistance(lab, p, model) < 6;
    for (let x = px0; x < px1; x++) if (near(py0 * b.width + x)) { leg[py0 * b.width + x] = 1; stack.push(py0 * b.width + x); }
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % b.width, y = (p - x) / b.width;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < px0 || nx >= px1 || ny < py0 || ny >= py1) continue;
        const q = ny * b.width + nx;
        if (!leg[q] && near(q)) { leg[q] = 1; stack.push(q); }
      }
    }
    for (let y = py0; y < py1; y++) {
      for (let x = px0; x < px1; x++) {
        const p = y * b.width + x;
        if (leg[p]) continue;
        for (let k = 0; k < 3; k++) b.rgb[p * 3 + k] = c.rgb[p * 3 + k]!;
        m.alpha[p] = 0;
      }
    }
  }
  // Small holes the mask leaves inside the skin in a skin-like colour (a pale shine) are skin, in neutral tones.
  const inMask = Uint8Array.from(m.alpha, (a) => (a >= 0.5 ? 1 : 0));
  const skinTotal = inMask.reduce((sum, v) => sum + v, 0);
  for (const hole of components(enclosed(inMask, b.width, b.height), b.width, b.height)) {
    if (hole.length > 0.003 * skinTotal || hole.some((p) => c.alpha[p]! < 0.5 || skinDistance(lab, p, model) > 15)) continue;
    for (const p of hole) {
      const g = 0.2126 * b.rgb[p * 3]! + 0.7152 * b.rgb[p * 3 + 1]! + 0.0722 * b.rgb[p * 3 + 2]!;
      for (let k = 0; k < 3; k++) b.rgb[p * 3 + k] = g;
      m.alpha[p] = 1;
    }
  }
  return { base: await encodePng(b.rgb, b.alpha, b.width, b.height), mask: await encodeMask(m.alpha, m.width, m.height) };
};

for (const pose of POSES) {
  const out = `${HERE}out/v3/${pose.role}/${pose.pose}`;
  mkdirSync(out, { recursive: true });
  const faces = pose.faces;
  const figures = await Promise.all(faces.map((face) => offPaper(raw(`${pose.role}-${pose.pose}-${face}`), pose.flip ?? false)));
  // One crop for every face: the union of their pixels, padded.
  const rasters = await Promise.all(figures.map((f) => readRaster(f.figure, 4096)));
  const { width, height } = rasters[0]!;
  const union = new Float32Array(width * height);
  for (const r of rasters) for (let p = 0; p < union.length; p++) union[p] = Math.max(union[p]!, r.alpha[p]! > 0.02 ? r.alpha[p]! : 0);
  const rect = alphaBounds(union, width, height, 12)!;
  const info: Record<string, unknown> = { size: [rect[2] - rect[0], rect[3] - rect[1]] };
  for (const [i, face] of faces.entries()) {
    const colour = await solidify(await crop(figures[i]!.figure, rect));
    let occluder: Uint8Array | null = null;
    if (pose.occluder) {
      // The hand: what the arm-lowered edit took away, inside the zone around the raised arm.
      const original = await toRgb(sharp(figures[i]!.png).flatten({ background: "#ffffff" }));
      const lowered0 = await toRgb(sharp(await (pose.flip ? sharp(raw(`${pose.role}-${pose.pose}-${face}-nohand`)).flop() : sharp(raw(`${pose.role}-${pose.pose}-${face}-nohand`))).png().toBuffer()));
      const z = pose.occluder.map((v, k) => Math.round((v * (k % 2 === 0 ? rect[2] - rect[0] : rect[3] - rect[1])) / 1000 + rect[k % 2 === 0 ? 0 : 1]!)) as [number, number, number, number];
      const shift = findShift(original, colourMatch(original, lowered0, z).image, z);
      const lowered = colourMatch(original, shiftImage(lowered0, shift[0], shift[1]), z).image;
      const cut = cutOutPart(lowered, original, z);
      // A hard edge, one piece: the soft fringe is where the edit repainted the brow, not the hand.
      const hard = Uint8Array.from(fillFigureHoles(cut.alpha, width, height, 0.2), (v) => (v > 0.5 ? 1 : 0));
      const pieces = components(hard, width, height).toSorted((a, b) => b.length - a.length);
      const fig = rasters[i]!;
      const a = new Float32Array(width * height);
      // Two pixels inside its edge: the base under it holds the same hand, so the edge comes from the recoloured base.
      const piece = new Uint8Array(width * height);
      for (const p of pieces[0] ?? []) piece[p] = 1;
      const inner = erode(piece, width, height, 2);
      for (let p = 0; p < a.length; p++) if (inner[p]) a[p] = fig.alpha[p]!;
      occluder = await crop(await encodePng(fig.rgb, a, width, height), rect);
    }
    const made = await makeBase(colour, { overlay: null, occluder });
    if ("error" in made) throw new Error(`${pose.role}/${pose.pose}/${face}: ${made.error}`);
    const kept = await keepOutOfSkin(colour, made.base, made.skinMask, pose.notSkin);
    // The occluder's skin mask, grown 3 px within the occluder: its pencil edge over the face takes the skin palette too.
    let occluderFiles = made.occluder;
    if (made.occluder) {
      const occ = await readRaster(made.occluder.asset, 4096);
      const om = await readRaster(made.occluder.skinMask, 4096);
      const grown = dilate(Uint8Array.from(om.alpha, (v) => (v > 0.3 ? 1 : 0)), occ.width, occ.height, 3);
      const alpha = Float32Array.from(om.alpha, (v, p) => (grown[p] && occ.alpha[p]! > 0 ? 1 : v));
      occluderFiles = { asset: made.occluder.asset, skinMask: await encodeMask(alpha, occ.width, occ.height) };
    }
    const files = { ...made, base: kept.base, skinMask: kept.mask, occluder: occluderFiles };
    writeFileSync(`${out}/base-${face}.png`, files.base);
    writeFileSync(`${out}/base-${face}-skin.png`, files.skinMask);
    if (files.overlay) writeFileSync(`${out}/base-${face}-overlay.png`, files.overlay);
    if (files.occluder) {
      writeFileSync(`${out}/base-${face}-occluder.png`, files.occluder.asset);
      writeFileSync(`${out}/base-${face}-occluder-skin.png`, files.occluder.skinMask);
    }
    writeFileSync(`${out}/review-${face}-mask.png`, files.maskReview);
    const fig = { base: files.base, skinMask: files.skinMask, overlay: files.overlay, parts: [], occluder: files.occluder };
    for (const [name, look] of [["light", { skin: skins["skin:s1"], hair: hairs["hair-colour:black"] }], ["dark", { skin: skins["skin:s5"], hair: hairs["hair-colour:blonde"] }]] as const) {
      writeFileSync(`${out}/review-${face}-${name}.png`, await composeForReview(fig, look, files.width, files.height));
    }
    info[face] = { overlay: !!files.overlay, occluder: !!files.occluder, notes: files.notes, size: [files.width, files.height] };
  }
  writeFileSync(`${out}/base.json`, JSON.stringify(info));
  console.log(pose.role, pose.pose, JSON.stringify(info));
}
