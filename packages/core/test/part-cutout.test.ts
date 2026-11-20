import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import partsByBase from "../src/looks/portrait/parts.json" with { type: "json" };
import { rasterize } from "../src/looks/recolour.ts";
import { coverOutline, CROWN_GAP_LIMIT, crownGap, cutOutPart, paperSilhouette, type PixelRect, type Rgb } from "../src/parts/cutout.ts";
import { figureCoverage } from "../src/parts/images.ts";
import { SPARSE_HAIR } from "../src/looks/vocabulary.ts";

// A synthetic edit with a known answer: a textured base B with a face, and a part with known alpha and colour (a
// hair cap with soft edges, thin opaque glasses frames, half-transparent wisps). The "model" output is
// a·F + (1 − a)·B, then shifted by (2, −1) px and re-toned (gain 0.96, offset +0.03), as providers do. The model also
// redraws a little of the face, which is not part of the part: its mouth line comes back 2 px lower, and the eyes,
// inside the glasses' lenses, 7 px to the right, a few pixels from the frames.
const W = 320;
const H = 400;
const zone: PixelRect = [70, 20, 250, 260];

const scene = () => {
  const base = new Float32Array(W * H * 3);
  const alpha = new Float32Array(W * H);
  const colour = new Float32Array(W * H * 3);
  const glasses = new Uint8Array(W * H);
  const wisps = new Uint8Array(W * H);
  const mouth = new Uint8Array(W * H);
  const eyes = new Uint8Array(W * H);
  const redrawn = new Float32Array(W * H * 3);
  const head = { x: 160, y: 140, r: 70 };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const i = p * 3;
      // Background texture, so alignment has something to lock onto.
      let rgb = [0.35 + 0.1 * Math.sin(x / 7) * Math.cos(y / 11), 0.45 + 0.08 * Math.sin((x + y) / 9), 0.7 + 0.05 * Math.cos(x / 5)];
      const inHead = Math.hypot(x - head.x, y - head.y) < head.r;
      if (inHead) rgb = [0.82, 0.68, 0.58];
      const eyeAt = (dx: number) => inHead && (Math.hypot(x - 135 - dx, y - 150) < 5 || Math.hypot(x - 185 - dx, y - 150) < 5);
      if (eyeAt(0)) rgb = [0.15, 0.1, 0.08];
      base.set(rgb, i);
      if (eyeAt(0) || eyeAt(7)) eyes[p] = 1;
      // The mouth: rows 184–185 in the base, 186–187 as the model redraws it.
      if (inHead && x >= 140 && x < 180 && y >= 182 && y < 190) mouth[p] = 1;
      const mouthLine = (top: number) => inHead && x >= 140 && x < 180 && (y === top || y === top + 1);
      if (mouthLine(184)) base.set([0.3, 0.12, 0.1], i);
      redrawn.set(
        mouthLine(186) ? [0.3, 0.12, 0.1] : mouthLine(184) ? [0.82, 0.68, 0.58] : eyeAt(7) ? [0.15, 0.1, 0.08] : eyeAt(0) ? [0.82, 0.68, 0.58] : base.subarray(i, i + 3),
        i,
      );

      // Hair cap: the top of the head and a bit around it, with a 4 px soft edge, some texture in its colour.
      const capDistance = Math.max(Math.hypot(x - head.x, y - head.y) - (head.r + 6), y - 115);
      let a = Math.min(1, Math.max(0, (0 - capDistance) / 4 + 0.5));
      // Glasses: two rings 2 px thick around the eyes, opaque and dark.
      const ring = Math.min(Math.abs(Math.hypot(x - 135, y - 150) - 16), Math.abs(Math.hypot(x - 185, y - 150) - 16));
      if (ring < 1) {
        glasses[p] = 1;
        a = 1;
      }
      // Wisps: one-pixel strands hanging below the cap at half opacity.
      if (y > 118 && y < 135 && (x === 110 || x === 210 || x === 112)) {
        wisps[p] = 1;
        a = Math.max(a, 0.5);
      }
      alpha[p] = a;
      colour.set(glasses[p] ? [0.08, 0.08, 0.1] : [0.3 + 0.05 * Math.sin(y / 3), 0.22, 0.18], i);
    }
  }
  const raw = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // The model's output at (x, y) shows the scene at (x − 2, y + 1).
      const sx = Math.min(W - 1, Math.max(0, x - 2));
      const sy = Math.min(H - 1, Math.max(0, y + 1));
      const s = sy * W + sx;
      for (let c = 0; c < 3; c++) {
        const composite = alpha[s]! * colour[s * 3 + c]! + (1 - alpha[s]!) * redrawn[s * 3 + c]!;
        raw[(y * W + x) * 3 + c] = 0.96 * composite + 0.03;
      }
    }
  }
  return { base: { width: W, height: H, data: base } satisfies Rgb, edit: { width: W, height: H, data: raw } satisfies Rgb, alpha, colour, glasses, wisps, mouth, eyes };
};

const mean = (values: ReadonlyArray<number>) => values.reduce((a, b) => a + b, 0) / values.length;

describe("cutOutPart", () => {
  const truth = scene();
  const result = cutOutPart(truth.base, truth.edit, zone);
  const pixels = [...Array(W * H).keys()];
  const inZone = (p: number) => {
    const x = p % W, y = Math.floor(p / W);
    return x >= zone[0] && x < zone[2] && y >= zone[1] && y < zone[3];
  };

  it("undoes the model's shift and re-toning", () => {
    expect(result.metrics.shift).toEqual([-2, 1]);
    for (const [gain, offset] of result.metrics.colourFit) {
      expect(gain).toBeCloseTo(1 / 0.96, 2);
      expect(offset).toBeCloseTo(-0.03 / 0.96, 2);
    }
    expect(result.metrics.outsideChange).toBeLessThan(1);
  });

  it("recovers soft alpha, thin frames, and half-transparent wisps that a threshold would lose or harden", () => {
    // Away from the image edge the shift clamps, every zone pixel's alpha is close to the truth.
    const error = mean(pixels.filter((p) => inZone(p) && !truth.mouth[p] && !truth.eyes[p]).map((p) => Math.abs(result.alpha[p]! - truth.alpha[p]!)));
    expect(error).toBeLessThan(0.02);
    expect(mean(pixels.filter((p) => truth.glasses[p]).map((p) => result.alpha[p]!))).toBeGreaterThan(0.9);
    const wispAlpha = mean(pixels.filter((p) => truth.wisps[p] && truth.alpha[p] === 0.5).map((p) => result.alpha[p]!));
    expect(wispAlpha).toBeGreaterThan(0.35);
    expect(wispAlpha).toBeLessThan(0.65);
    const softEdge = pixels.filter((p) => truth.alpha[p]! > 0.2 && truth.alpha[p]! < 0.8 && !truth.wisps[p]);
    expect(mean(softEdge.map((p) => Math.abs(result.alpha[p]! - truth.alpha[p]!)))).toBeLessThan(0.08);
  });

  it("keeps the face and the old skin out of the layer", () => {
    const strayAlpha = pixels.filter((p) => inZone(p) && truth.alpha[p] === 0 && result.alpha[p]! > 0.1);
    expect(strayAlpha.length).toBeLessThan(pixels.filter(inZone).length * 0.005);
    // The redrawn mouth changed as much as the hair did, but it is the model's noise, not the part.
    expect(Math.max(...pixels.filter((p) => truth.mouth[p]).map((p) => result.alpha[p]!))).toBe(0);
    // So did the eyes, close to the frames but inside the lenses, where the base shows through the part.
    expect(Math.max(...pixels.filter((p) => truth.eyes[p]).map((p) => result.alpha[p]!))).toBe(0);
    // Unmixed colour is the part's, not skin blended in, even at the soft edge.
    const edge = pixels.filter((p) => truth.alpha[p]! >= 0.3 && truth.alpha[p]! < 1 && !truth.wisps[p] && !truth.glasses[p]);
    const colourError = mean(edge.map((p) => Math.abs(result.colour[p * 3]! - truth.colour[p * 3]!)));
    expect(colourError).toBeLessThan(0.05);
    expect(result.metrics.recompositeError).toBeLessThan(2);
  });

  it("finds nothing outside the zone even where the picture changed", () => {
    const outside = pixels.filter((p) => !inZone(p) && result.alpha[p]! > 0);
    expect(outside).toEqual([]);
  });
});

describe("cutOutPart at a hairline", () => {
  // Dark hair over light skin, ending in a band of fine strands at half opacity that touch the hair: drawn so, they are
  // a lighter tone right next to the hair, which a cut-out sampling the part's colour there takes for opaque pale
  // hair, and a dark hair palette then draws as a grey line on dark skin (Paper Boat v3, 2026-11-19).
  const width = 1024;
  const height = 400;
  const skin = 0.8;
  const hair = [0.32, 0.26, 0.22];
  const strands = new Uint8Array(width * height);
  const base = new Float32Array(width * height * 3);
  const edit = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const tone = skin + 0.02 * Math.sin(x / 3) * Math.cos(y / 4);
      const a = y >= 60 && y < 220 && x >= 60 && x < 960 ? 1 : y >= 220 && y < 226 && x >= 70 && x < 950 ? 0.5 : 0;
      if (a === 0.5) strands[p] = 1;
      for (let c = 0; c < 3; c++) {
        base[p * 3 + c] = tone;
        edit[p * 3 + c] = a * hair[c]! + (1 - a) * tone;
      }
    }
  }
  const result = cutOutPart({ width, height, data: base }, { width, height, data: edit }, [20, 20, 1004, 380]);
  const at = [...Array(width * height).keys()].filter((p) => strands[p]);

  it("keeps the strands half-transparent in the hair's own colour", () => {
    expect(mean(at.map((p) => result.alpha[p]!))).toBeLessThan(0.65);
    expect(mean(at.map((p) => result.alpha[p]!))).toBeGreaterThan(0.35);
    expect(mean(at.map((p) => result.colour[p * 3]!))).toBeLessThan(0.36);
  });
});

describe("crownGap", () => {
  // A bald head (a skin disc with ears) and a hair cap: one that reaches the head's outline with a hairline on the
  // forehead, and one drawn smaller than the head, leaving a band of scalp above it (Paper Boat v5's pointing bun).
  const width = 400, height = 400, r = 120;
  const head = (x: number, y: number) => Math.hypot(x - 200, y - 220) < r || Math.hypot(x - 76, y - 230) < 18 || Math.hypot(x - 324, y - 230) < 18;
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) mask[p] = head(p % width, Math.floor(p / width)) ? 255 : 0;
  const cap = (inset: number) =>
    Float32Array.from(mask, (_, p) => {
      const x = p % width, y = Math.floor(p / width);
      // Down to a hairline 40 px into the face, and only over the head (the ears stay bare).
      return Math.hypot(x - 200, y - 220) < r - inset && y < 180 ? 1 : 0;
    });

  it("doesn't count a hairline or ears, only scalp left above the hair", () => {
    expect(crownGap(cap(0), mask, width, height)).toBe(0);
    expect(crownGap(cap(2), mask, width, height)).toBeLessThan(CROWN_GAP_LIMIT);
    expect(crownGap(cap(12), mask, width, height)).toBeGreaterThan(CROWN_GAP_LIMIT);
  });
});

const inEar = (x: number, y: number) => Math.hypot(x - 212, y - 600) < 40;

describe("coverOutline", () => {
  // A head with an ear, and a hair cap the matte cut 3 px short of the head's silhouette (its pencil outline), ending
  // at a hairline on the forehead. At 1024 px, as the edits are.
  const width = 1024, height = 1024, r = 300;
  const at = (p: number) => [p % width, Math.floor(p / width)] as const;
  const inHead = (x: number, y: number) => Math.hypot(x - 512, y - 560) < r;
  const mask = new Uint8Array(width * height);
  const alpha = new Float32Array(width * height);
  const colour = new Float32Array(width * height * 3).fill(0.3);
  for (let p = 0; p < mask.length; p++) {
    const [x, y] = at(p);
    const d = Math.hypot(x - 512, y - 560);
    mask[p] = inHead(x, y) || inEar(x, y) ? 255 : 0;
    alpha[p] = d < r - 3 && y < 470 ? 1 : 0;
  }
  const figure = Float32Array.from(mask, (m) => (m ? 1 : 0));
  const result = coverOutline(alpha, colour, figure, mask, width, height);
  const pixels = [...Array(width * height).keys()];

  it("covers the band between the hair and the head's silhouette", () => {
    const rim = pixels.filter((p) => { const [x, y] = at(p); return inHead(x, y) && Math.hypot(x - 512, y - 560) > r - 3 && y < 420; });
    expect(rim.length).toBeGreaterThan(100);
    expect(rim.every((p) => result.alpha[p] === 1)).toBe(true);
    expect(result.colour[rim[0]! * 3]).toBeCloseTo(0.3, 5);
  });

  it("leaves the hairline, the face's outline below the hair and the ear as they are", () => {
    const below = pixels.filter((p) => at(p)[1] > 480 && result.alpha[p]! > 0);
    expect(below).toEqual([]);
    expect(pixels.filter((p) => inEar(...at(p)) && result.alpha[p]! > 0)).toEqual([]);
  });
});

describe("coverOutline on a base drawn on paper", () => {
  // The picker's portraits (D28): an opaque base on textured paper, the head drawn with an ink line 6 px wide at
  // 560 px. The matte left the ink half covered under the hair (alpha 0.3, dark notches under a light colour), and a
  // stubble's dots sit on the chin, against the jaw's ink.
  const width = 488, height = 560, r = 150, ink = 6;
  const at = (p: number) => [p % width, Math.floor(p / width)] as const;
  const d = (p: number) => Math.hypot(at(p)[0] - 244, at(p)[1] - 300);
  const pixels = [...Array(width * height).keys()];
  const image = new Float32Array(width * height * 3);
  const mask = new Uint8Array(width * height);
  const alpha = new Float32Array(width * height);
  for (const p of pixels) {
    const [x, y] = at(p);
    const paper = [0.99, 0.91, 0.73].map((v, c) => v - 0.012 * Math.abs(Math.sin(x / 3 + y / 7 + c)));
    image.set(d(p) < r - ink ? [0.88, 0.66, 0.45] : d(p) < r ? [0.35, 0.2, 0.08] : paper, p * 3);
    mask[p] = d(p) < r - ink ? 255 : 0;
    if (y < 220) alpha[p] = d(p) < r - ink ? 1 : d(p) < r ? 0.3 : 0;
    if (y > 400 && d(p) < r - 1 && x % 6 < 2 && y % 6 < 2) alpha[p] = 1;
  }
  const figure = paperSilhouette({ width, height, data: image });
  const result = coverOutline(alpha, new Float32Array(width * height * 3).fill(0.4), figure, mask, width, height);
  const ring = (p: number) => d(p) >= r - ink && d(p) < r - 1;

  it("finds the head's silhouette on the paper", () => {
    expect(pixels.filter((p) => d(p) > r + 1 && figure[p]! >= 0.02)).toEqual([]);
    expect(pixels.filter((p) => d(p) < r - 1 && figure[p]! < 1)).toEqual([]);
  });

  it("covers the ink under the hair, and not beside the face or under a stubble's dots", () => {
    const above = pixels.filter((p) => ring(p) && at(p)[1] < 200);
    expect(above.length).toBeGreaterThan(300);
    expect(above.filter((p) => result.alpha[p]! < 0.99)).toEqual([]);
    expect(pixels.filter((p) => ring(p) && at(p)[1] > 240 && result.alpha[p]! !== alpha[p])).toEqual([]);
    expect(coverOutline(result.alpha, result.colour, figure, mask, width, height).covered).toBe(0);
  });
});

describe("the sample stories' hair", () => {
  // Every hair part, published or added (D41), on each base it is drawn on, as composeFigure places it.
  /**
   * Published parts that leave scalp showing (2026-11-19); a published version never changes (D24, D41), so they
   * leave this list with the version that redraws them.
   */
  // The oval-faced grown-up's head is square at the top; the cap is round, so both corners show beside it.
  const known = new Set(["p02", "p03", "p04", "p05", "p06"].flatMap((page) => ["short", "long"].map((style) => `moon-picnic/pages/${page}/grownup/adult-1-${style}.svg`)));
  const stories = new URL("../../../fixtures/stories/", import.meta.url);
  const pairs = readdirSync(stories).flatMap((story) => {
    const dir = new URL(`${story}/`, stories);
    const json = (path: string) => JSON.parse(readFileSync(new URL(path, dir), "utf8"));
    const additions = readdirSync(new URL("additions/", dir)).map((file) => json(`additions/${file}`));
    return json("manifest.json").pages.flatMap((page: any) =>
      page.illustration.layers
        .filter((layer: any) => layer.kind === "figure")
        .flatMap((layer: any) => {
          const added = additions.flatMap((a) => a.figures ?? []).filter((f: any) => f.pageId === page.pageId && f.slotId === layer.slotId);
          const bases = [...layer.bases, ...added.flatMap((f: any) => f.bases ?? [])];
          const parts = [...layer.parts, ...added.flatMap((f: any) => f.parts ?? [])];
          return parts
            .filter((part: any) => part.axis === "hair" && part.palette !== "skin")
            .flatMap((part: any) => {
              const base = bases.find((b: any) => b.age === part.age && b.face === part.face && b.features === part.features);
              return base ? [{ story, dir, base, part }] : [];
            });
        }),
    );
  });
  const unique = [...new Map(pairs.map((pair) => [`${pair.story}/${pair.base.skinMask}/${pair.part.asset}`, pair])).values()];

  it("covers the scalp up to the head's outline", async () => {
    // Each base once (rasterizing one takes ~0.3 s): its skin mask, and for raster art its silhouette (alpha), which
    // cutOutLayer extends hair to. Moon Picnic's parts are drawn vectors, not cut out, so only crownGap applies to them.
    const bases = new Map<string, Promise<{ mask: Uint8Array; width: number; height: number; figure: Float32Array | null }>>();
    const load = (dir: URL, base: any) => {
      const read = (asset: string) => rasterize(new Uint8Array(readFileSync(new URL(asset, dir))));
      const key = `${dir}${base.asset}|${base.skinMask}`;
      if (!bases.has(key))
        bases.set(key, (async () => {
          const { data: mask, info } = await (await read(base.skinMask)).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
          if (base.asset.endsWith(".svg")) return { mask: new Uint8Array(mask), width: info.width, height: info.height, figure: null };
          const figure = await (await read(base.asset)).resize(info.width, info.height, { fit: "fill" }).extractChannel(3).raw().toBuffer();
          return { mask: new Uint8Array(mask), width: info.width, height: info.height, figure: Float32Array.from(figure, (v) => v / 255) };
        })());
      return bases.get(key)!;
    };
    const gaps = await Promise.all(
      unique.map(async ({ story, dir, base, part }) => {
        const { mask, width, height, figure } = await load(dir, base);
        const [x0, y0, x1, y1] = [part.at[0] * width, part.at[1] * height, part.at[2] * width, part.at[3] * height].map((v) => Math.round(v / 1000)) as [number, number, number, number];
        const layer = await (await rasterize(new Uint8Array(readFileSync(new URL(part.asset, dir))))).resize(x1 - x0, y1 - y0, { fit: "fill" }).extractChannel(3).raw().toBuffer();
        const alpha = new Float32Array(width * height);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) alpha[y * width + x] = layer[(y - y0) * (x1 - x0) + (x - x0)]! / 255;
        const outline = figure ? coverOutline(alpha, new Float32Array(alpha.length * 3), figure, mask, width, height).covered : 0;
        return { part: `${story}/${part.asset}`, gap: crownGap(alpha, mask, width, height), outline };
      }),
    );
    expect(gaps.length).toBeGreaterThan(100);
    expect(gaps.filter(({ part, gap }) => gap > CROWN_GAP_LIMIT && !known.has(part))).toEqual([]);
    // Hair reaches the head's outline wherever it meets the paper (coverOutline finds nothing left to cover).
    expect(gaps.filter(({ outline }) => outline > 0).map(({ part, outline }) => `${part}: ${outline}`)).toEqual([]);
    // The known ones still fail, so the check catches them (and a redrawn one leaves the list).
    expect(gaps.filter(({ part, gap }) => gap > CROWN_GAP_LIMIT && known.has(part)).map(({ part }) => part).toSorted()).toEqual([...known].toSorted());
  }, 30_000);
});

describe("the picker's portrait hair", () => {
  // Every hair and facial hair part of the portrait (D28) on its own base, drawn on paper (no alpha): its silhouette
  // is the paper the border reaches (figureCoverage), as cutOutLayer finds it for a new part.
  const dir = new URL("../src/looks/portrait/", import.meta.url);
  const read = (asset: string) => new Uint8Array(readFileSync(new URL(asset, dir)));

  it("covers the scalp up to the head's ink outline", async () => {
    const found = await Promise.all(
      Object.entries(partsByBase as Record<string, Record<string, ReadonlyArray<{ asset: string; at: ReadonlyArray<number>; palette: string }>>>).map(async ([base, options]) => {
        const { data: mask, info } = await (await rasterize(read(`bases/${base}-skin.png`))).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
        const { width, height } = info;
        const figure = await figureCoverage(read(`bases/${base}.png`), width, height);
        return Promise.all(
          Object.entries(options).flatMap(([option, layers]) => layers.map((part) => ({ option, ...part }))).filter((part) => part.palette === "hairColour").map(async (part) => {
            const [x0, y0, x1, y1] = part.at.map((v, k) => Math.round((v * (k % 2 === 0 ? width : height)) / 1000)) as [number, number, number, number];
            const layer = await (await rasterize(read(part.asset))).resize(x1 - x0, y1 - y0, { fit: "fill" }).extractChannel(3).raw().toBuffer();
            const alpha = new Float32Array(width * height);
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) alpha[y * width + x] = layer[(y - y0) * (x1 - x0) + (x - x0)]! / 255;
            const covered = coverOutline(alpha, new Float32Array(alpha.length * 3), figure, new Uint8Array(mask), width, height).covered;
            // Sparse hair shows scalp on purpose (D51), so it has no crown gap to fail.
            return { part: part.asset, gap: SPARSE_HAIR.has(part.option) ? 0 : crownGap(alpha, new Uint8Array(mask), width, height), covered };
          }),
        );
      }),
    );
    const parts = found.flat();
    expect(parts.length).toBeGreaterThan(150);
    expect(parts.filter(({ gap }) => gap > CROWN_GAP_LIMIT).map(({ part, gap }) => `${part}: ${gap}`)).toEqual([]);
    expect(parts.filter(({ covered }) => covered > 0).map(({ part, covered }) => `${part}: ${covered}`)).toEqual([]);
  }, 60_000);
});
