// Book format v1: what an author publishes, stored as `story_version.manifest`.
// See docs/plan.md, "Book format (v1)". Browser-safe: the page component reads it.
//
// The manifest holds only what the author made. A family's choices (who fills
// each character slot, text edits) live on their book and are applied when a
// page is rendered, so one story version serves every family unchanged.
import { Schema } from "effect";
import { tokenIssues } from "./text.ts";

/** Slot and page IDs: lowercase, stable across versions, used in object keys and text tokens. */
const Id = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/, { message: "must be lowercase letters, digits, and dashes" }));

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

/** What the text tokens of a slot resolve to: a family member, or the slot's example in a story preview. */
export const CastMember = Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)), pronouns: PronounSet });
export type CastMember = typeof CastMember.Type;

export const CharacterSlot = Schema.Struct({
  slotId: Id,
  /** Shown to the parent choosing who fills the slot, e.g. "The child". */
  label: Schema.String.check(Schema.isMinLength(1)),
  /** Guidance for the parent and the image model, e.g. "A child about 5 years old". */
  description: Schema.String,
  /** Fills the slot in story previews, before a family chooses anyone. */
  example: CastMember,
  /** The look the author intends when the family sets nothing (hair, glasses...). */
  defaults: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean])),
});
export type CharacterSlot = typeof CharacterSlot.Type;

export const ArtLayer = Schema.Struct({ kind: Schema.Literal("art"), asset: ImageAsset });
export type ArtLayer = typeof ArtLayer.Type;

const Permille = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }));

export const CharacterLayer = Schema.Struct({
  kind: Schema.Literal("character"),
  slotId: Id,
  /** Where the character goes, as FLUX's bounding box: [y0, x0, y1, x1] in thousandths of the illustration. */
  box: Schema.Tuple([Permille, Permille, Permille, Permille]).check(
    Schema.makeFilter(([y0, x0, y1, x1]) => (y0 < y1 && x0 < x1) || "box must be [y0, x0, y1, x1] with y0 < y1 and x0 < x1"),
  ),
  /** Pose and action for the image model, e.g. "kneeling, holding a basket, smiling". */
  direction: Schema.String.check(Schema.isMinLength(1)),
});
export type CharacterLayer = typeof CharacterLayer.Type;

export const IllustrationLayer = Schema.Union([ArtLayer, CharacterLayer]);
export type IllustrationLayer = typeof IllustrationLayer.Type;

/**
 * The closed set of page layouts BookPage knows. The illustration covers the whole
 * page including bleed ("full-bleed-art/...") or the left half ("art-left/...").
 */
export const PageLayout = Schema.Literals(["full-bleed-art/text-bottom", "full-bleed-art/text-top", "art-left/text-right"]);
export type PageLayout = typeof PageLayout.Type;

export const TextBlock = Schema.Struct({
  style: TextStyleName,
  /** Human-written text with `{{slot.field}}` tokens, see text.ts. */
  content: Schema.String,
});
export type TextBlock = typeof TextBlock.Type;

export const Page = Schema.Struct({
  pageId: Id,
  layout: PageLayout,
  text: Schema.Array(TextBlock),
  illustration: Schema.Struct({
    /** Bottom to top. Art layers are the illustrator's files and never change; character layers are filled per family. */
    layers: Schema.Array(IllustrationLayer).check(Schema.isMinLength(1)),
  }),
});
export type Page = typeof Page.Type;

export const FORMAT_VERSION = 1;

const duplicates = (values: ReadonlyArray<string>) => values.filter((value, i) => values.indexOf(value) !== i);

export const StoryManifest = Schema.Struct({
  /** Readers reject versions they don't know; a later version ships a migration from v1. */
  formatVersion: Schema.Literal(FORMAT_VERSION),
  trim: Trim,
  fonts: Schema.Array(FontFile),
  textStyles: Schema.Struct({ title: TextStyle, body: TextStyle }),
  characterSlots: Schema.Array(CharacterSlot),
  pages: Schema.Array(Page).check(Schema.isMinLength(1)),
}).check(
  // References inside the manifest must resolve, so a page never names a slot,
  // font, or token that doesn't exist. Uploads by any author go through this check.
  Schema.makeFilter((manifest) => {
    const issues: Array<Schema.FilterIssue> = [];
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
    for (const id of new Set(duplicates(slotIds))) issues.push({ path: ["characterSlots"], issue: `duplicate slotId "${id}"` });
    for (const id of new Set(duplicates(manifest.pages.map((page) => page.pageId)))) {
      issues.push({ path: ["pages"], issue: `duplicate pageId "${id}"` });
    }
    const slots = new Set(slotIds);
    manifest.pages.forEach((page, p) => {
      page.illustration.layers.forEach((layer, l) => {
        if (layer.kind === "character" && !slots.has(layer.slotId)) {
          issues.push({ path: ["pages", p, "illustration", "layers", l, "slotId"], issue: `unknown slot "${layer.slotId}"` });
        }
      });
      page.text.forEach((block, b) => {
        for (const issue of tokenIssues(block.content, slots)) issues.push({ path: ["pages", p, "text", b, "content"], issue });
      });
    });
    return issues;
  }),
);
export type StoryManifest = typeof StoryManifest.Type;

/** Decodes and validates a manifest; fails with every problem found. */
export const decodeStoryManifest = Schema.decodeUnknownEffect(StoryManifest);

/** Every asset the manifest references, each once: what an upload or import must provide. */
export const manifestAssets = (manifest: StoryManifest): ReadonlyArray<string> => [
  ...new Set([
    ...manifest.fonts.map((font) => font.asset),
    ...manifest.pages.flatMap((page) => page.illustration.layers.flatMap((layer) => (layer.kind === "art" ? [layer.asset] : []))),
  ]),
];

/** The object storage key of a story version's asset. */
export const storyAssetKey = (storyId: string, version: number, asset: string) => `stories/${storyId}/v${version}/${asset}`;

/** The cast a story preview uses: each slot filled by its example character. */
export const exampleCast = (manifest: StoryManifest): Record<string, CastMember> =>
  Object.fromEntries(manifest.characterSlots.map((slot) => [slot.slotId, slot.example]));
