// A page's illustration as object storage keys for BookPage, bottom to top (D56): the illustrator's art as drawn,
// and each figure as the family's drawing of it, else the story's stock drawing, else the bald reference. Pure and
// browser-safe: drawing a figure happens in tasks, never when a page is shown.
import { type Page, pageFigures, type PhotoFigure, type Rect, storyAssetKey, type StoryManifest } from "./manifest.ts";

export type PlacedRect = readonly [number, number, number, number];

export interface ResolvedLayer {
  readonly key: string;
  /** Thousandths of the illustration area. */
  readonly rect: PlacedRect;
}

const WHOLE: Rect = [0, 0, 1000, 1000];

/**
 * `drawn` returns the key of the family's layer for a figure (the `index`th figure of the page, bottom to top), or
 * nothing to draw the story's own: the stock figure where there is one, the bald reference in a draft without it, nothing before either is uploaded.
 */
export const composePage = (
  story: { readonly storyId: string; readonly version: number },
  page: Page,
  drawn: (figure: PhotoFigure, index: number) => string | undefined = () => undefined,
): ReadonlyArray<ResolvedLayer> => {
  const asset = (path: string) => storyAssetKey(story.storyId, story.version, path);
  let figures = 0;
  return page.illustration.layers.flatMap((layer): ReadonlyArray<ResolvedLayer> => {
    if (layer.kind === "art") return [{ key: asset(layer.asset), rect: WHOLE }];
    const key = drawn(layer, figures++);
    if (key) return [{ key, rect: layer.window }];
    if (layer.stock) return [{ key: asset(layer.stock), rect: layer.window }];
    return layer.reference ? [{ key: asset(layer.reference), rect: layer.box }] : [];
  });
};

/**
 * A thumbnail of the cover page (else the first page): its illustration area's size, for its shape, and its layers,
 * each figure from `drawn` as in composePage. Null for a story without pages.
 */
export const coverThumbnail = (
  story: { readonly storyId: string; readonly version: number },
  manifest: StoryManifest,
  drawn?: (figure: PhotoFigure, index: number) => string | undefined,
) => {
  const page = coverPage(manifest) ?? manifest.pages[0];
  if (!page) return null;
  const { trim } = manifest;
  return {
    pageId: page.pageId,
    widthIn: page.art === "left-half" ? trim.bleedIn + trim.widthIn / 2 : trim.widthIn + 2 * trim.bleedIn,
    heightIn: trim.heightIn + 2 * trim.bleedIn,
    layers: composePage(story, page, drawn),
  };
};

/** The page the cover is drawn from: the first with every role on it, else the first with any figure. */
export const coverPage = (manifest: StoryManifest): Page | undefined => {
  const slots = manifest.characterSlots.map((slot) => slot.slotId);
  const withFigures = manifest.pages.filter((page) => pageFigures(page).length > 0);
  return (
    withFigures.find((page) => slots.every((slotId) => pageFigures(page).some((f) => f.slotId === slotId))) ??
    withFigures[0]
  );
};
