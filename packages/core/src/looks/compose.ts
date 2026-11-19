// Composing a page's illustration for a cast (plan.md, "Composing pages"): which files to stack, where, and which
// of them to recolour. Pure and browser-safe; the server turns the recolours into cached images (pages.ts).
import type { CastMember, FigureLayer, Page, Palette, StoryManifest } from "../book-format/manifest.ts";
import { drawnFeatures, fullPartOrder, type Look, NO_PART_OPTIONS, partAxesAt, sameAppearance } from "./vocabulary.ts";

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
 * One figure for `look`, bottom to top: its base face (skin and brows recoloured), its overlay as drawn, the look's parts in `partOrder`,
 * then the occluder (its skin recoloured too). Drawn at the figure's pinned age, else the look's own (D29); part
 * axes that don't exist at that age (a baby's hairstyle) are left out. Story pages and the picker's portrait both compose with this.
 * An option the figure or palettes lack is a bug (callers check `unsupportedOptions` first), so it throws.
 */
export const composeFigure = (
  palettes: StoryManifest["palettes"],
  partOrder: StoryManifest["partOrder"],
  layer: FigureLayer,
  look: Look,
): ReadonlyArray<LayerSpec> => {
  const skin = palettes.skin[look.skin];
  const hair = palettes.hairColour[look.hairColour];
  const age = layer.age ?? look.age;
  const features = drawnFeatures(layer.bases, age, look.face, look);
  const base = layer.bases.find((candidate) => sameAppearance(candidate, age, look.face, features));
  if (!skin || !hair || !base) throw new Error(`${layer.slotId}: can't draw this look`);
  const regionPalettes = { skin, hairColour: hair } as const;

  const parts =
    layer.showsHead === false
      ? []
      : fullPartOrder(layer.partOrder ?? partOrder).flatMap((axis) => {
          const option = look[axis];
          if (NO_PART_OPTIONS.has(option) || !partAxesAt(age).includes(axis)) return [];
          const drawn = layer.parts.filter((part) => sameAppearance(part, age, look.face, features) && part.axis === axis && part.option === option);
          if (drawn.length === 0) throw new Error(`${layer.slotId}: no part for "${option}" on "${age}/${look.face}"`);
          return drawn.map((part) => ({
            asset: part.asset,
            rect: within(layer.box, part.at),
            recolour: part.palette === "none" ? [] : [{ palette: regionPalettes[part.palette] }],
          }));
        });

  return [
    {
      asset: base.asset,
      rect: layer.box,
      recolour: [{ mask: base.skinMask, palette: skin }, ...(base.browMask ? [{ mask: base.browMask, palette: hair }] : [])],
    },
    ...(base.overlay ? [{ asset: base.overlay, rect: layer.box, recolour: [] }] : []),
    ...parts,
    ...(base.occluder
      ? [{ asset: base.occluder.asset, rect: layer.box, recolour: base.occluder.skinMask ? [{ mask: base.occluder.skinMask, palette: skin }] : [] }]
      : []),
  ];
};

/** The page's illustration, bottom to top: its art and each figure (composeFigure). A slot without a cast member is left out. */
export const composeIllustration = (
  manifest: StoryManifest,
  page: Page,
  cast: Readonly<Record<string, CastMember>>,
): ReadonlyArray<LayerSpec> =>
  page.illustration.layers.flatMap((layer): ReadonlyArray<LayerSpec> => {
    if (layer.kind === "art") return [{ asset: layer.asset, rect: FULL, recolour: [] }];
    const member = cast[layer.slotId];
    return member ? composeFigure(manifest.palettes, manifest.partOrder, layer, member.look) : [];
  });
