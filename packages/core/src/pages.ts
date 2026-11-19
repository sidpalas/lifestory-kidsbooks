// Turns a composed illustration into object storage keys BookPage can load: plain layers point at the story's
// assets, recoloured or mirrored layers at a cached PNG made once with the version-pinned recolour (plan.md,
// "Composing pages").
import { createHash } from "node:crypto";
import sharp from "sharp";
import { Effect } from "effect";
import { storyAssetKey } from "./book-format/manifest.ts";
import type { LayerSpec, PlacedRect } from "./looks/compose.ts";
import { RECOLOUR_ALGORITHM, recolour } from "./looks/recolour.ts";
import { ObjectStorage } from "./storage.ts";

export interface ResolvedLayer {
  readonly key: string;
  readonly rect: PlacedRect;
}

/** Keys known to exist, so a page view doesn't ask storage about every recoloured layer each time. */
const stored = new Set<string>();

/**
 * The cache key of a recoloured layer. A story version's assets never change, so their paths stand in for their
 * bytes; the palette and the algorithm name complete the inputs. Kept under the version's folder, so it follows
 * the story's read rule.
 */
export const recolouredKey = (storyId: string, version: number, layer: LayerSpec) => {
  const inputs = JSON.stringify({ algorithm: RECOLOUR_ALGORITHM, asset: layer.asset, recolour: layer.recolour, ...(layer.flip ? { flip: true } : {}) });
  return storyAssetKey(storyId, version, `recoloured/${createHash("sha256").update(inputs).digest("hex").slice(0, 32)}.png`);
};

export const resolveIllustration = Effect.fn("pages.resolveIllustration")(function* (
  storyId: string,
  version: number,
  layers: ReadonlyArray<LayerSpec>,
) {
  const storage = yield* ObjectStorage;
  const read = (asset: string) => storage.get(storyAssetKey(storyId, version, asset)).pipe(Effect.map((object) => object.body));
  return yield* Effect.forEach(
    layers,
    (layer) =>
      Effect.gen(function* () {
        if (layer.recolour.length === 0 && !layer.flip) return { key: storyAssetKey(storyId, version, layer.asset), rect: layer.rect };
        const key = recolouredKey(storyId, version, layer);
        if (!stored.has(key)) {
          const exists = yield* storage.get(key).pipe(
            Effect.as(true),
            Effect.catchTag("StorageError", () => Effect.succeed(false)),
          );
          if (!exists) {
            const asset = yield* read(layer.asset);
            const regions = yield* Effect.forEach(layer.recolour, (region) =>
              region.mask
                ? read(region.mask).pipe(Effect.map((mask) => ({ mask, palette: region.palette })))
                : Effect.succeed({ palette: region.palette }),
            );
            // Same inputs, same bytes: two requests racing here write the same object.
            const png = yield* Effect.promise(() => recolour(asset, regions));
            const body = layer.flip ? new Uint8Array(yield* Effect.promise(() => sharp(png).flop().png({ compressionLevel: 6 }).toBuffer())) : png;
            yield* storage.put(key, body, "image/png");
          }
          stored.add(key);
        }
        return { key, rect: layer.rect };
      }),
    { concurrency: 4 },
  );
});
