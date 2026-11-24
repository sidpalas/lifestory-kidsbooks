// The book format: what an author publishes, stored as `story_version.manifest`. Format 4 (D56) draws every role
// from a family member's photo: each figure on a page is the illustrator's bald drawing, which a model redraws as the
// family member from the book's character sheet. Formats 1–3 (looks and parts, D26) are gone with the parts stories.
// Browser-safe: the page component reads it.
//
// The manifest holds only what the author made. A family's choices (who fills each role, their sheets, the drawn
// figures, text edits) live on their book and are applied when a page is rendered, so one story version serves every
// family unchanged.
import { Effect, Schema } from "effect";

import { Age } from "./ages.ts";
import { tokenIssues } from "./text.ts";

/** Slot and page IDs: lowercase, stable across versions, used in object keys and text tokens. */
const Id = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*$/, { message: "must be lowercase letters, digits, and dashes" }),
);

// Asset paths are relative to the story version's folder in object storage
// (`stories/<storyId>/v<version>/`), so they may not climb out of it.
const assetPath = (extensions: string) =>
  Schema.String.check(
    Schema.isPattern(new RegExp(`^(?!.*\\.\\.)[a-z0-9][a-z0-9/_.-]*\\.(${extensions})$`), {
      message: `must be a relative path ending in .${extensions.split("|").join(", .")}`,
    }),
  );
const ImageAsset = assetPath("png|jpg|jpeg|webp|svg");
const FontAsset = assetPath("woff2");

const Inches = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 48 }));

export const Trim = Schema.Struct({
  widthIn: Inches.check(Schema.isGreaterThan(0)),
  heightIn: Inches.check(Schema.isGreaterThan(0)),
  /** Art extends this far past the trim on every side and is cut off by the printer. */
  bleedIn: Inches,
  /** Text stays this far inside the trim. */
  safeMarginIn: Inches,
});
export type Trim = typeof Trim.Type;

export const FontFile = Schema.Struct({
  family: Schema.String.check(Schema.isMinLength(1)),
  asset: FontAsset,
  /** CSS font-weight, a single weight ("400") or a variable range ("200 900"). */
  weight: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d{3}( \d{3})?$/))),
  style: Schema.optionalKey(Schema.Literals(["normal", "italic"])),
  /** CSS unicode-range, for fonts split into subsets (latin, latin-ext...). */
  unicodeRange: Schema.optionalKey(Schema.String),
});
export type FontFile = typeof FontFile.Type;

export const TextStyleName = Schema.Literals(["title", "body"]);
export type TextStyleName = typeof TextStyleName.Type;

export const TextStyle = Schema.Struct({
  fontFamily: Schema.String,
  sizePt: Schema.Finite.check(Schema.isBetween({ minimum: 6, maximum: 96 })),
  lineHeight: Schema.Finite.check(Schema.isBetween({ minimum: 0.8, maximum: 3 })),
  weight: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 900 })),
  align: Schema.Literals(["left", "center", "right"]),
});
export type TextStyle = typeof TextStyle.Type;

export const PronounSet = Schema.Literals(["she/her", "he/him", "they/them"]);
export type PronounSet = typeof PronounSet.Type;

/** Who fills a slot, for the text: a family member, or the slot's stock character in a story preview. */
export const CastMember = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  /** What the children call them ("Dad", "Nana"), for `{{slot.title}}`; the name stands in when absent. */
  title: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  pronouns: PronounSet,
});
export type CastMember = typeof CastMember.Type;

export const CharacterSlot = Schema.Struct({
  slotId: Id,
  /** Shown to the parent choosing who fills the slot, e.g. "The child". */
  label: Schema.String.check(Schema.isMinLength(1)),
  /** Guidance for the parent, e.g. "A child about 5 years old". */
  description: Schema.String,
  /** The ages a family member may be to fill the slot (D29); the sheet draws them at their own age (D56). */
  ages: Schema.Array(Age).check(Schema.isMinLength(1)),
  /** The illustrator's character, named in story previews before a family puts itself in the book. */
  example: CastMember,
  /** What the character wears on the sheet, in words: "a red-and-white striped long-sleeved top and red trousers". */
  outfit: Schema.String.check(Schema.isMinLength(1)),
  /** The stock character's sheet, front, three-quarter and back views; absent in a draft until it's made. */
  stockSheet: Schema.optionalKey(ImageAsset),
});
export type CharacterSlot = typeof CharacterSlot.Type;

const Permille = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }));

/** A rectangle [x0, y0, x1, y1] in thousandths of the illustration. */
export const Rect = Schema.Tuple([Permille, Permille, Permille, Permille]).check(
  Schema.makeFilter(([x0, y0, x1, y1]) => (x0 < x1 && y0 < y1) || "must be [x0, y0, x1, y1] with x0 < x1 and y0 < y1"),
);
export type Rect = typeof Rect.Type;

/** The illustrator's art, as drawn: the plate behind everything, or scenery in front of a figure (an occluder). */
export const ArtLayer = Schema.Struct({ kind: Schema.Literal("art"), asset: ImageAsset });
export type ArtLayer = typeof ArtLayer.Type;

/**
 * One appearance of a role on a page (D56). The illustrator draws the figure bald, on its own layer, cut tight; a
 * family's book redraws it as their family member from the book's character sheet, on a transparent background,
 * and lays that layer in its place. Figures on a page must not touch or overlap: each is drawn in its own call.
 */
export const PhotoFigure = Schema.Struct({
  kind: Schema.Literal("photoFigure"),
  slotId: Id,
  /** The bald figure, as an RGBA layer covering `box`. Over the plate, it is the model's page reference. */
  reference: Schema.optionalKey(ImageAsset),
  /** Where the bald figure sits: the bounding box of its opaque pixels. */
  box: Rect,
  /** The generation window: `box` padded and grown to 2:3 or 3:2 of the page's pixels, fixed at import. */
  window: Rect,
  /** The head's box, from which the keep zone's hair zone grows (D56). */
  head: Rect,
  /** The stock character on this page, made by the same pipeline from the stock sheet; covers `window`. */
  stock: Schema.optionalKey(ImageAsset),
  /** Off only where the illustrator wants the drawn colours kept; on by default (D56). */
  tint: Schema.optionalKey(Schema.Boolean),
});
export type PhotoFigure = typeof PhotoFigure.Type;

export const IllustrationLayer = Schema.Union([ArtLayer, PhotoFigure]);
export type IllustrationLayer = typeof IllustrationLayer.Type;

/** Where a page's illustration sits: the whole page including bleed, or its left half. */
export const ArtArea = Schema.Literals(["full-bleed", "left-half"]);
export type ArtArea = typeof ArtArea.Type;

/** One paragraph of a text frame, in one of the story's text styles. */
export const TextBlock = Schema.Struct({
  style: TextStyleName,
  /** Human-written text with `{{slot.field}}` tokens, see text.ts. Line breaks typed in it are kept. */
  content: Schema.String,
});
export type TextBlock = typeof TextBlock.Type;

/** A rectangle on the trim, in inches from its top-left corner. */
export const TrimBox = Schema.Struct({
  xIn: Inches,
  yIn: Inches,
  widthIn: Inches.check(Schema.isGreaterThan(0)),
  heightIn: Inches.check(Schema.isGreaterThan(0)),
});
export type TrimBox = typeof TrimBox.Type;

/**
 * A place for text on a page (D54): a box inside the safe area holding paragraphs, laid out top to bottom like one
 * column. The text keeps to one edge of the box (`valign`), so a family's longer names grow it away from that edge;
 * text that doesn't fit runs past the box, and the editors say so.
 */
export const TextFrame = Schema.Struct({
  /** Stable within the page; the editor names new frames t1, t2, ... */
  frameId: Id,
  box: TrimBox,
  valign: Schema.Literals(["top", "middle", "bottom"]),
  /** A light panel behind the text, as wide as the box and as tall as the text, so it reads over busy art. */
  panel: Schema.Boolean,
  paragraphs: Schema.Array(TextBlock),
});
export type TextFrame = typeof TextFrame.Type;

export const Page = Schema.Struct({
  pageId: Id,
  art: ArtArea,
  /**
   * The page's text, in reading order. Frames may overlap; a later frame draws on top. A family's text edits address
   * the page's paragraphs in this order (pageText).
   */
  frames: Schema.Array(TextFrame),
  illustration: Schema.Struct({
    /**
     * Bottom to top: the plate, then each figure and any scenery in front of it. Art layers are the illustrator's
     * files and never change; figures are drawn per family.
     */
    layers: Schema.Array(IllustrationLayer),
  }),
});
export type Page = typeof Page.Type;

/** How a story's characters are drawn from photos (D56). */
export const PhotoStyle = Schema.Struct({
  /** A crop of one painted page, which the sheet prompt calls the book's style. */
  styleReference: ImageAsset,
  /** The style in words, for every prompt: "thin, slightly grainy pencil outline and soft watercolour colouring". */
  styleWords: Schema.String.check(Schema.isMinLength(1)),
  /**
   * The prompt set, pinned per story version so a later prompt change never redraws a published story differently.
   * v1 dresses each figure as on the sheet; v2 keeps the clothes the illustrator drew on each page (a space suit, rain
   * gear) and takes only the person from the sheet.
   */
  promptVersion: Schema.Literals(["photo-hero-v1", "photo-hero-v2"]),
});
export type PhotoStyle = typeof PhotoStyle.Type;

export const FORMAT_VERSION = 4;

/** A page's paragraphs in reading order, frame by frame: what a family's text edits address by index. */
export const pageText = (page: { readonly frames: ReadonlyArray<{ readonly paragraphs: ReadonlyArray<TextBlock> }> }) =>
  page.frames.flatMap((frame) => frame.paragraphs);

/** A page's figures, bottom to top. */
export const pageFigures = (page: Page): ReadonlyArray<PhotoFigure> =>
  page.illustration.layers.filter((layer): layer is PhotoFigure => layer.kind === "photoFigure");

const duplicates = (values: ReadonlyArray<string>) => values.filter((value, i) => values.indexOf(value) !== i);

const inside = ([ax0, ay0, ax1, ay1]: Rect, [bx0, by0, bx1, by1]: Rect) =>
  ax0 >= bx0 && ay0 >= by0 && ax1 <= bx1 && ay1 <= by1;

/**
 * How far apart, in thousandths of the illustration, two figures' boxes must stay (D56): each figure is drawn in its
 * own call, so figures that touch or overlap (a hug, held hands) can't be drawn. Each box is padded by this much.
 */
export const FIGURE_GAP = 10;

/** Whether two figures' boxes, each padded by FIGURE_GAP, meet. */
export const figuresMeet = ([ax0, ay0, ax1, ay1]: Rect, [bx0, by0, bx1, by1]: Rect) =>
  ax0 - FIGURE_GAP < bx1 + FIGURE_GAP &&
  bx0 - FIGURE_GAP < ax1 + FIGURE_GAP &&
  ay0 - FIGURE_GAP < by1 + FIGURE_GAP &&
  by0 - FIGURE_GAP < ay1 + FIGURE_GAP;

/**
 * The manifest's shape without its completeness and cross-reference checks: what an author's draft holds while
 * they work on it (D37). Publishing decodes it as a StoryManifest, which adds every check.
 */
export const StoryDraft = Schema.Struct({
  /** Readers reject versions they don't know. */
  formatVersion: Schema.Literal(FORMAT_VERSION),
  trim: Trim,
  fonts: Schema.Array(FontFile),
  textStyles: Schema.Struct({ title: TextStyle, body: TextStyle }),
  characterSlots: Schema.Array(CharacterSlot),
  /** Absent in a new draft until the author picks the style reference. */
  photo: Schema.optionalKey(PhotoStyle),
  pages: Schema.Array(Page),
});
export type StoryDraft = typeof StoryDraft.Type;

export const StoryManifest = StoryDraft.check(
  // References inside the manifest must resolve, so a page never names a slot, font, or token that doesn't exist.
  // Uploads by any author go through this check, including that figures on a page stay apart (FIGURE_GAP).
  Schema.makeFilter((manifest) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (manifest.pages.length === 0) issues.push({ path: ["pages"], issue: "a story needs at least one page" });
    if (!manifest.photo) issues.push({ path: ["photo"], issue: "a story needs a style reference for its sheets" });
    const { widthIn, heightIn, safeMarginIn } = manifest.trim;
    if (safeMarginIn * 2 >= Math.min(widthIn, heightIn)) {
      issues.push({ path: ["trim", "safeMarginIn"], issue: "safe margin leaves no room for text" });
    }
    const families = new Set(manifest.fonts.map((font) => font.family));
    for (const name of ["title", "body"] as const) {
      const family = manifest.textStyles[name].fontFamily;
      if (!families.has(family)) {
        issues.push({ path: ["textStyles", name, "fontFamily"], issue: `font "${family}" is not in fonts` });
      }
    }
    const slotIds = manifest.characterSlots.map((slot) => slot.slotId);
    for (const id of new Set(duplicates(slotIds)))
      issues.push({ path: ["characterSlots"], issue: `duplicate slotId "${id}"` });
    for (const id of new Set(duplicates(manifest.pages.map((page) => page.pageId)))) {
      issues.push({ path: ["pages"], issue: `duplicate pageId "${id}"` });
    }
    const slots = new Set(slotIds);
    manifest.characterSlots.forEach((slot, s) => {
      for (const age of new Set(duplicates(slot.ages)))
        issues.push({ path: ["characterSlots", s, "ages"], issue: `"${age}" twice` });
      if (!slot.stockSheet)
        issues.push({ path: ["characterSlots", s, "stockSheet"], issue: "the stock character needs a sheet" });
    });
    manifest.pages.forEach((page, p) => {
      if (page.illustration.layers.length === 0)
        issues.push({ path: ["pages", p, "illustration", "layers"], issue: "a page needs at least one layer" });
      else if (page.illustration.layers[0]!.kind !== "art")
        issues.push({ path: ["pages", p, "illustration", "layers", 0], issue: "a page starts with its plate" });
      page.illustration.layers.forEach((layer, l) => {
        if (layer.kind !== "photoFigure") return;
        const path = ["pages", p, "illustration", "layers", l];
        if (!slots.has(layer.slotId))
          issues.push({ path: [...path, "slotId"], issue: `unknown slot "${layer.slotId}"` });
        if (!inside(layer.box, layer.window))
          issues.push({ path: [...path, "window"], issue: "the window must contain the figure's box" });
        if (!inside(layer.head, layer.window))
          issues.push({ path: [...path, "head"], issue: "the head must be inside the window" });
        if (!layer.reference)
          issues.push({ path: [...path, "reference"], issue: "the figure needs its bald reference" });
        if (!layer.stock) issues.push({ path: [...path, "stock"], issue: "the figure needs its stock drawing" });
      });
      const figures = pageFigures(page);
      figures.forEach((a, i) =>
        figures.slice(i + 1).forEach((b) => {
          if (figuresMeet(a.box, b.box))
            issues.push({
              path: ["pages", p, "illustration", "layers"],
              issue: `figures "${a.slotId}" and "${b.slotId}" touch or overlap; characters on a page must stay apart`,
            });
        }),
      );
      for (const id of new Set(duplicates(page.frames.map((frame) => frame.frameId))))
        issues.push({ path: ["pages", p, "frames"], issue: `duplicate frameId "${id}"` });
      page.frames.forEach((frame, f) => {
        const path = ["pages", p, "frames", f];
        if (!insideSafeArea(frame.box, manifest.trim))
          issues.push({ path: [...path, "box"], issue: "the text frame reaches past the safe margin" });
        if (frame.paragraphs.length === 0)
          issues.push({ path: [...path, "paragraphs"], issue: "a text frame needs at least one paragraph" });
        frame.paragraphs.forEach((block, b) => {
          for (const issue of tokenIssues(block.content, slots))
            issues.push({ path: [...path, "paragraphs", b, "content"], issue });
        });
      });
    });
    return issues;
  }),
);
export type StoryManifest = typeof StoryManifest.Type;

/** The safe area: where text may go, the trim less its safe margin on every side. */
export const safeArea = (trim: Trim): TrimBox => ({
  xIn: trim.safeMarginIn,
  yIn: trim.safeMarginIn,
  widthIn: trim.widthIn - 2 * trim.safeMarginIn,
  heightIn: trim.heightIn - 2 * trim.safeMarginIn,
});

/** Floating-point slack for edges computed from the trim (a box flush with the safe margin is inside it). */
const EDGE_SLACK_IN = 1e-9;

const insideSafeArea = (box: TrimBox, trim: Trim) => {
  const safe = safeArea(trim);
  return (
    box.xIn >= safe.xIn - EDGE_SLACK_IN &&
    box.yIn >= safe.yIn - EDGE_SLACK_IN &&
    box.xIn + box.widthIn <= safe.xIn + safe.widthIn + EDGE_SLACK_IN &&
    box.yIn + box.heightIn <= safe.yIn + safe.heightIn + EDGE_SLACK_IN
  );
};

/**
 * Starting frames the editor offers: "bottom" and "top" fill the safe area on a panel and keep to that edge;
 * "right-half" is the right half's safe area, centred, with no panel (the art fills the left half).
 */
export const presetFrame = (
  trim: Trim,
  preset: "bottom" | "top" | "right-half",
  frameId: string,
  paragraphs: ReadonlyArray<TextBlock>,
): TextFrame =>
  preset === "right-half"
    ? {
        frameId,
        box: {
          xIn: trim.widthIn / 2 + trim.safeMarginIn,
          yIn: trim.safeMarginIn,
          widthIn: trim.widthIn / 2 - 2 * trim.safeMarginIn,
          heightIn: trim.heightIn - 2 * trim.safeMarginIn,
        },
        valign: "middle",
        panel: false,
        paragraphs,
      }
    : { frameId, box: safeArea(trim), valign: preset, panel: true, paragraphs };

export const decodeStoryManifest = (input: unknown) =>
  Effect.suspend(() => Schema.decodeUnknownEffect(StoryManifest)(input));

export const decodeStoryDraft = (input: unknown) => Effect.suspend(() => Schema.decodeUnknownEffect(StoryDraft)(input));

/** Decodes a stored story version: published ones as manifests, the author's unpublished draft only by its shape. */
export const decodeStoryVersion = (input: unknown, publishedAt: Date | null) =>
  publishedAt ? decodeStoryManifest(input) : decodeStoryDraft(input);

/** Every asset the manifest references, each once: what an upload or import must provide. */
export const manifestAssets = (manifest: StoryDraft): ReadonlyArray<string> => [
  ...new Set([
    ...manifest.fonts.map((font) => font.asset),
    ...(manifest.photo ? [manifest.photo.styleReference] : []),
    ...manifest.characterSlots.flatMap((slot) => (slot.stockSheet ? [slot.stockSheet] : [])),
    ...manifest.pages.flatMap((page) =>
      page.illustration.layers.flatMap((layer) =>
        layer.kind === "art"
          ? [layer.asset]
          : [...(layer.reference ? [layer.reference] : []), ...(layer.stock ? [layer.stock] : [])],
      ),
    ),
  ]),
];

/** The object storage key of a story version's asset. */
export const storyAssetKey = (storyId: string, version: number, asset: string) =>
  `stories/${storyId}/v${version}/${asset}`;

/** The cast a story preview uses: each slot filled by its stock character. */
export const exampleCast = (manifest: StoryDraft): Record<string, CastMember> =>
  Object.fromEntries(manifest.characterSlots.map((slot) => [slot.slotId, slot.example]));
