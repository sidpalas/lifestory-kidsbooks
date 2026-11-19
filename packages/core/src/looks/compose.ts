// Composing a page's illustration for a cast (plan.md, "Composing pages"): which files to stack, where, and which
// of them to recolour. Pure and browser-safe; the server turns the recolours into cached images (pages.ts).
import type { CastMember, Page, Palette, StoryManifest } from "../book-format/manifest.ts";
import { NO_PART_OPTIONS } from "./vocabulary.ts";

/** [x0, y0, x1, y1] in thousandths of the illustration area. */
export type PlacedRect = readonly [number, number, number, number];

export interface RecolourRegion {
  /** The region's mask on the asset's canvas; without one, the whole asset is the region. */
  readonly mask?: string;
  readonly palette: Palette;
}

export interface LayerSpec {
  readonly asset: string;
  readonly rect: PlacedRect;
  /** Empty: the asset is drawn as the illustrator made it. */
  readonly recolour: ReadonlyArray<RecolourRegion>;
}

const FULL: PlacedRect = [0, 0, 1000, 1000];

const within = ([bx0, by0, bx1, by1]: PlacedRect, [ax0, ay0, ax1, ay1]: PlacedRect): PlacedRect => {
  const w = (bx1 - bx0) / 1000;
  const h = (by1 - by0) / 1000;
  return [bx0 + ax0 * w, by0 + ay0 * h, bx0 + ax1 * w, by0 + ay1 * h];
};

/**
 * The page's illustration, bottom to top. Each figure is its base face (skin and brows recoloured), the look's parts
 * in `partOrder`, then the occluder (its skin recoloured too). A slot without a cast member is left out. Callers
 * check `unsupportedOptions` first; an option the story lacks here is a bug, so it throws.
 */
export const composeIllustration = (
  manifest: StoryManifest,
  page: Page,
  cast: Readonly<Record<string, CastMember>>,
): ReadonlyArray<LayerSpec> =>
  page.illustration.layers.flatMap((layer): ReadonlyArray<LayerSpec> => {
    if (layer.kind === "art") return [{ asset: layer.asset, rect: FULL, recolour: [] }];
    const member = cast[layer.slotId];
    if (!member) return [];
    const { look } = member;
    const skin = manifest.palettes.skin[look.skin];
    const hair = manifest.palettes.hairColour[look.hairColour];
    const base = layer.bases.find((candidate) => candidate.face === look.face);
    if (!skin || !hair || !base) throw new Error(`${page.pageId}/${layer.slotId}: the story can't draw this look`);
    const palettes = { skin, hairColour: hair } as const;

    const parts =
      layer.showsHead === false
        ? []
        : (layer.partOrder ?? manifest.partOrder).flatMap((axis) => {
            const option = look[axis];
            if (NO_PART_OPTIONS.has(option)) return [];
            const drawn = layer.parts.filter((part) => part.face === look.face && part.axis === axis && part.option === option);
            if (drawn.length === 0) throw new Error(`${page.pageId}/${layer.slotId}: no part for "${option}" on "${look.face}"`);
            return drawn.map((part) => ({
              asset: part.asset,
              rect: within(layer.box, part.at),
              recolour: part.palette === "none" ? [] : [{ palette: palettes[part.palette] }],
            }));
          });

    return [
      {
        asset: base.asset,
        rect: layer.box,
        recolour: [{ mask: base.skinMask, palette: skin }, ...(base.browMask ? [{ mask: base.browMask, palette: hair }] : [])],
      },
      ...parts,
      ...(base.occluder
        ? [{ asset: base.occluder.asset, rect: layer.box, recolour: base.occluder.skinMask ? [{ mask: base.occluder.skinMask, palette: skin }] : [] }]
        : []),
    ];
  });
