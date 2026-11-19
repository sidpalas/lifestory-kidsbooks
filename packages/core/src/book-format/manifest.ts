// The book format: what an author publishes, stored as `story_version.manifest`. Format 2 (D29) gives roles a set of
// ages and draws bases and parts per age and face type; stored format 1 manifests are upgraded when decoded
// (upgradeFormat1). See docs/plan.md, "Book format (v1)". Browser-safe: the page component reads it.
//
// The manifest holds only what the author made. A family's choices (who fills
// each character slot, text edits) live on their book and are applied when a
// page is rendered, so one story version serves every family unchanged.
import { Schema } from "effect";
import { Effect } from "effect";
import { Age, FaceOption, faceOptions, lookVocabulary, Look, NO_PART_OPTIONS, PartAxis, partAxesAt } from "../looks/vocabulary.ts";
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

/**
 * Who fills a slot: a family member, or the slot's example in a story preview. Text tokens resolve from the name,
 * title, and pronouns; the figures on every page are composed from the look (D26).
 */
export const CastMember = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  /** What the children call them ("Dad", "Nana"), for `{{slot.title}}`; the name stands in when absent. */
  title: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  pronouns: PronounSet,
  look: Look,
});
export type CastMember = typeof CastMember.Type;

export const CharacterSlot = Schema.Struct({
  slotId: Id,
  /** Shown to the parent choosing who fills the slot, e.g. "The child". */
  label: Schema.String.check(Schema.isMinLength(1)),
  /** Guidance for the parent, e.g. "A child about 5 years old". */
  description: Schema.String,
  /**
   * The ages a family member may be to fill the slot (D29). Age is the one axis a story may restrict (D26): every
   * figure of the slot not pinned to an age supplies a base for every face type at each of these ages, and every
   * other option in the look vocabulary.
   */
  ages: Schema.Array(Age).check(Schema.isMinLength(1)),
  /** Fills the slot in story previews, before a family chooses anyone. */
  example: CastMember,
});
export type CharacterSlot = typeof CharacterSlot.Type;

export const ArtLayer = Schema.Struct({ kind: Schema.Literal("art"), asset: ImageAsset });
export type ArtLayer = typeof ArtLayer.Type;

const Permille = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }));

/** A rectangle [x0, y0, x1, y1] in thousandths of its container (the illustration, or a figure's box). */
export const Rect = Schema.Tuple([Permille, Permille, Permille, Permille]).check(
  Schema.makeFilter(([x0, y0, x1, y1]) => (x0 < x1 && y0 < y1) || "must be [x0, y0, x1, y1] with x0 < x1 and y0 < y1"),
);
export type Rect = typeof Rect.Type;

/**
 * One base face of a figure, drawn by the illustrator bald and in neutral skin tones, filling the figure's box.
 * Masks are on the same canvas (opaque = in the region) and say what the recolour may touch.
 */
export const FigureBase = Schema.Struct({
  /** The age this base draws the character at (D29). */
  age: Age,
  face: FaceOption,
  asset: ImageAsset,
  /** Every visible bit of skin: face, neck, arms, hands, legs. Takes the look's skin palette. */
  skinMask: ImageAsset,
  /** Eyebrows, which take the look's hair colour. */
  browMask: Schema.optionalKey(ImageAsset),
  /** Drawn over the parts: hands or props in front of the face. Its skin takes the skin palette too. */
  occluder: Schema.optionalKey(Schema.Struct({ asset: ImageAsset, skinMask: Schema.optionalKey(ImageAsset) })),
});
export type FigureBase = typeof FigureBase.Type;

/** One option's drawing for one base face, cut out and placed within the figure's box. */
export const Part = Schema.Struct({
  age: Age,
  face: FaceOption,
  axis: PartAxis,
  option: Schema.String,
  asset: ImageAsset,
  /** Where the part sits, in thousandths of the figure's box. */
  at: Rect,
  /** Which palette recolours the part's neutral tones; `none` leaves it as drawn (glasses). */
  palette: Schema.Literals(["skin", "hairColour", "none"]),
  /** Set by the illustrator's review. A story version publishes only when every part is approved (D26). */
  approved: Schema.Boolean,
});
export type Part = typeof Part.Type;

/**
 * One appearance of a character on a page (D26): the slot's base faces and option parts, composed per family as
 * base → parts (in `partOrder`) → occluder, with no AI when a book is made.
 */
export const FigureLayer = Schema.Struct({
  kind: Schema.Literal("figure"),
  slotId: Id,
  /** Where the figure sits, in thousandths of the illustration. */
  box: Rect,
  /**
   * Draws the role at this age on this page, whatever age the family member is (D29): a baby who grows into a toddler
   * during the story. Without it the figure draws them at their own age, one of the slot's `ages`.
   */
  age: Schema.optionalKey(Age),
  /** False when only a hand or an arm is in frame: then the figure has no head parts. */
  showsHead: Schema.optionalKey(Schema.Boolean),
  /** Overrides the manifest's `partOrder` on this appearance, e.g. glasses over hair. */
  partOrder: Schema.optionalKey(Schema.Array(PartAxis)),
  bases: Schema.Array(FigureBase).check(Schema.isMinLength(1)),
  parts: Schema.Array(Part),
});
export type FigureLayer = typeof FigureLayer.Type;

export const IllustrationLayer = Schema.Union([ArtLayer, FigureLayer]);
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

/** A gradient map for the recolour: neutral tone (0 = black, 1 = white) to colour, at least two stops. */
export const Palette = Schema.Array(
  Schema.Struct({ at: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })), colour: Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/)) }),
).check(Schema.isMinLength(2));
export type Palette = typeof Palette.Type;

export const FORMAT_VERSION = 2;

const duplicates = (values: ReadonlyArray<string>) => values.filter((value, i) => values.indexOf(value) !== i);

export const StoryManifest = Schema.Struct({
  /** Readers reject versions they don't know; a later version ships a migration from v1. */
  formatVersion: Schema.Literal(FORMAT_VERSION),
  trim: Trim,
  fonts: Schema.Array(FontFile),
  textStyles: Schema.Struct({ title: TextStyle, body: TextStyle }),
  characterSlots: Schema.Array(CharacterSlot),
  /** The illustrator's colours for every skin tone and hair colour in the look vocabulary. */
  palettes: Schema.Struct({ skin: Schema.Record(Schema.String, Palette), hairColour: Schema.Record(Schema.String, Palette) }),
  /** Bottom to top, the part axes drawn between the base face and the occluder. */
  partOrder: Schema.Array(PartAxis),
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
    for (const axis of ["skin", "hairColour"] as const) {
      for (const option of Object.keys(manifest.palettes[axis])) {
        if (!lookVocabulary[axis].some((known) => known.id === option)) {
          issues.push({ path: ["palettes", axis, option], issue: `"${option}" is not a ${axis} option` });
        }
      }
    }
    const partAxes = [...new Set(manifest.partOrder)];
    if (partAxes.length !== manifest.partOrder.length || partAxes.length !== PartAxis.literals.length) {
      issues.push({ path: ["partOrder"], issue: `must list each of ${PartAxis.literals.join(", ")} once` });
    }
    manifest.characterSlots.forEach((slot, s) => {
      if (!slot.ages.includes(slot.example.look.age)) {
        issues.push({ path: ["characterSlots", s, "example", "look", "age"], issue: `the example is not one of the slot's ages` });
      }
      for (const age of new Set(duplicates(slot.ages))) issues.push({ path: ["characterSlots", s, "ages"], issue: `"${age}" twice` });
    });
    manifest.pages.forEach((page, p) => {
      page.illustration.layers.forEach((layer, l) => {
        if (layer.kind !== "figure") return;
        const path = ["pages", p, "illustration", "layers", l];
        const slot = manifest.characterSlots.find((candidate) => candidate.slotId === layer.slotId);
        if (!slot) {
          issues.push({ path: [...path, "slotId"], issue: `unknown slot "${layer.slotId}"` });
          return;
        }
        for (const issue of figureIssues(layer, drawnAges(layer, slot))) issues.push({ path: [...path, ...issue.path], issue: issue.issue });
      });
      page.text.forEach((block, b) => {
        for (const issue of tokenIssues(block.content, slots)) issues.push({ path: ["pages", p, "text", b, "content"], issue });
      });
    });
    return issues;
  }),
);
export type StoryManifest = typeof StoryManifest.Type;

/** The ages a figure draws its role at: its pinned age, or every age the slot accepts. */
const drawnAges = (figure: FigureLayer, slot: CharacterSlot): ReadonlyArray<Age> => (figure.age ? [figure.age] : slot.ages);

/** What a figure has extra or misplaced, given the ages it draws. Paths are relative to the figure. */
const figureIssues = (figure: FigureLayer, ages: ReadonlyArray<Age>): ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; issue: string }> => {
  const issues: Array<{ path: ReadonlyArray<PropertyKey>; issue: string }> = [];
  const keys = figure.bases.map((base) => `${base.age}/${base.face}`);
  for (const key of new Set(duplicates(keys))) issues.push({ path: ["bases"], issue: `two bases for "${key}"` });
  figure.bases.forEach((base, b) => {
    if (!ages.includes(base.age)) issues.push({ path: ["bases", b, "age"], issue: `the figure doesn't draw "${base.age}"` });
  });
  if (figure.partOrder && (new Set(figure.partOrder).size !== figure.partOrder.length || figure.partOrder.length !== PartAxis.literals.length)) {
    issues.push({ path: ["partOrder"], issue: `must list each of ${PartAxis.literals.join(", ")} once` });
  }
  if (figure.showsHead === false) {
    if (figure.parts.length > 0) issues.push({ path: ["parts"], issue: "a figure without a head has no parts" });
    return issues;
  }
  figure.parts.forEach((part, i) => {
    if (!ages.includes(part.age)) issues.push({ path: ["parts", i, "age"], issue: `the figure doesn't draw "${part.age}"` });
    else if (!partAxesAt(part.age).includes(part.axis)) issues.push({ path: ["parts", i, "axis"], issue: `"${part.age}" has no ${part.axis} parts` });
    if (!lookVocabulary[part.axis].some((option) => option.id === part.option) || NO_PART_OPTIONS.has(part.option)) {
      issues.push({ path: ["parts", i, "option"], issue: `"${part.option}" is not a ${part.axis} option with a drawing` });
    }
  });
  return issues;
};

/**
 * What a story version lacks from the look vocabulary as it stands today. Publishing requires none (Sid,
 * 2026-11-19: every story supports every option except faces of another age). A stored version is never
 * rechecked, so options added to the vocabulary later are simply unsupported there; see `unsupportedOptions`.
 */
export const vocabularyGaps = (manifest: StoryManifest): ReadonlyArray<string> => {
  const gaps: Array<string> = [];
  for (const axis of ["skin", "hairColour"] as const) {
    for (const option of lookVocabulary[axis]) if (!manifest.palettes[axis][option.id]) gaps.push(`no palette for "${option.id}"`);
  }
  for (const page of manifest.pages) {
    for (const layer of page.illustration.layers) {
      if (layer.kind !== "figure") continue;
      const slot = manifest.characterSlots.find((candidate) => candidate.slotId === layer.slotId)!;
      for (const age of drawnAges(layer, slot)) {
        for (const { id: face } of faceOptions) {
          const at = `${age}/${face}`;
          if (!layer.bases.some((base) => base.age === age && base.face === face)) gaps.push(`${page.pageId}/${layer.slotId}: no base for "${at}"`);
          if (layer.showsHead === false) continue;
          for (const axis of partAxesAt(age)) {
            for (const option of lookVocabulary[axis]) {
              if (NO_PART_OPTIONS.has(option.id)) continue;
              if (!layer.parts.some((part) => part.age === age && part.face === face && part.axis === axis && part.option === option.id)) {
                gaps.push(`${page.pageId}/${layer.slotId}: no part for "${option.id}" on "${at}"`);
              }
            }
          }
        }
      }
    }
  }
  return gaps;
};

/**
 * The axes of `look` this story can't draw for `slotId`: "age" when the slot doesn't accept the character's age;
 * otherwise an option with no palette, or a face type or part missing at an age some page draws them at. The book
 * then disables the story for that character or keeps a story-specific override with supported options (Sid,
 * 2026-11-19). Empty means every page composes.
 */
export const unsupportedOptions = (manifest: StoryManifest, slotId: string, look: Look): ReadonlyArray<keyof Look> => {
  const slot = manifest.characterSlots.find((candidate) => candidate.slotId === slotId);
  if (!slot) return [];
  if (!slot.ages.includes(look.age)) return ["age"];
  const unsupported = new Set<keyof Look>();
  if (!manifest.palettes.skin[look.skin]) unsupported.add("skin");
  if (!manifest.palettes.hairColour[look.hairColour]) unsupported.add("hairColour");
  for (const page of manifest.pages) {
    for (const layer of page.illustration.layers) {
      if (layer.kind !== "figure" || layer.slotId !== slotId) continue;
      const age = layer.age ?? look.age;
      if (!layer.bases.some((base) => base.age === age && base.face === look.face)) {
        unsupported.add("face");
        continue; // Parts are drawn per face, so with an unsupported face only the face is the problem.
      }
      if (layer.showsHead === false) continue;
      for (const axis of partAxesAt(age)) {
        const option = look[axis];
        if (NO_PART_OPTIONS.has(option)) continue;
        if (!layer.parts.some((part) => part.age === age && part.face === look.face && part.axis === axis && part.option === option)) unsupported.add(axis);
      }
    }
  }
  return [...unsupported];
};

/**
 * Options a book draws for one role instead of the character's own, for axes the pinned story version can't draw
 * (D26: "a story-specific override with a supported option", picked by the parent).
 */
export const LookOverride = Schema.Struct({
  // No age: a role's ages say who may play it, so a stand-in age would draw someone else.
  face: Schema.optionalKey(Look.fields.face),
  skin: Schema.optionalKey(Look.fields.skin),
  hair: Schema.optionalKey(Look.fields.hair),
  hairColour: Schema.optionalKey(Look.fields.hairColour),
  glasses: Schema.optionalKey(Look.fields.glasses),
});
export type LookOverride = typeof LookOverride.Type;

export interface CastLook {
  /** What the pages draw: the character's look, with the override applied to the axes the story can't draw. */
  readonly look: Look;
  /** The character's age isn't one the role accepts, so no override helps: someone else plays it (D29). */
  readonly wrongAge: boolean;
  /** Axes still unsupported after the override. Empty (and `wrongAge` false) means every page composes. */
  readonly unsupported: ReadonlyArray<keyof Look>;
}

/**
 * How a character fills `slotId` in this story version (D26). The override replaces only options the story can't
 * draw, so a look edit back to a supported option takes effect again on its own.
 */
export const castLook = (manifest: StoryManifest, slotId: string, look: Look, override: LookOverride = {}): CastLook => {
  const slot = manifest.characterSlots.find((candidate) => candidate.slotId === slotId);
  if (slot && !slot.ages.includes(look.age)) return { look, wrongAge: true, unsupported: ["age"] };
  const patched: { -readonly [K in keyof Look]: Look[K] } = { ...look };
  for (const axis of unsupportedOptions(manifest, slotId, look)) {
    const option = axis === "age" ? undefined : override[axis];
    if (option !== undefined) (patched as Record<keyof Look, string>)[axis] = option;
  }
  return { look: patched, wrongAge: false, unsupported: unsupportedOptions(manifest, slotId, patched) };
};

/** Parts still waiting for the illustrator's approval, by page; a published version must have none. */
export const unapprovedParts = (manifest: StoryManifest): ReadonlyArray<string> =>
  manifest.pages.flatMap((page) =>
    page.illustration.layers.flatMap((layer) =>
      layer.kind === "figure" ? layer.parts.filter((part) => !part.approved).map((part) => `${page.pageId}: ${part.asset}`) : [],
    ),
  );

/**
 * Format 1 (D24) as format 2 (D29): its two ages become buckets (child → young child, adult → adult) and its four
 * faces become face types at those ages, so stored versions keep drawing exactly what they drew. Leaves anything
 * else alone for the schema to judge.
 */
const format1Faces: Record<string, { readonly age: string; readonly face: string }> = {
  "face:child-1": { age: "young-child", face: "face:round" },
  "face:child-2": { age: "young-child", face: "face:oval" },
  "face:adult-1": { age: "adult", face: "face:oval" },
  "face:adult-2": { age: "adult", face: "face:round" },
};
const format1Ages: Record<string, string> = { child: "young-child", adult: "adult" };

// oxlint-disable-next-line typescript/no-explicit-any -- untyped JSON on its way to the schema
const withFace = (item: any) => (item && format1Faces[item.face] ? { age: format1Faces[item.face]!.age, ...item, face: format1Faces[item.face]!.face } : item);

export const upgradeFormat1 = (input: unknown): unknown => {
  if (typeof input !== "object" || input === null || (input as { formatVersion?: unknown }).formatVersion !== 1) return input;
  // oxlint-disable-next-line typescript/no-explicit-any -- untyped JSON on its way to the schema
  const m = structuredClone(input) as any;
  m.formatVersion = 2;
  for (const slot of m.characterSlots ?? []) {
    if (typeof slot.age === "string") slot.ages = [format1Ages[slot.age] ?? slot.age];
    delete slot.age;
    if (slot.example?.look) slot.example.look = withFace(slot.example.look);
  }
  for (const page of m.pages ?? []) {
    for (const layer of page.illustration?.layers ?? []) {
      if (layer.kind !== "figure") continue;
      layer.bases = (layer.bases ?? []).map(withFace);
      layer.parts = (layer.parts ?? []).map(withFace);
    }
  }
  return m;
};

/** Decodes and validates a manifest of any known format, as the current format; fails with every problem found. */
export const decodeStoryManifest = (input: unknown) =>
  Effect.suspend(() => Schema.decodeUnknownEffect(StoryManifest)(upgradeFormat1(input)));

/** Every asset the manifest references, each once: what an upload or import must provide. */
export const manifestAssets = (manifest: StoryManifest): ReadonlyArray<string> => [
  ...new Set([
    ...manifest.fonts.map((font) => font.asset),
    ...manifest.pages.flatMap((page) =>
      page.illustration.layers.flatMap((layer) =>
        layer.kind === "art"
          ? [layer.asset]
          : [
              ...layer.bases.flatMap((base) => [
                base.asset,
                base.skinMask,
                ...(base.browMask ? [base.browMask] : []),
                ...(base.occluder ? [base.occluder.asset, ...(base.occluder.skinMask ? [base.occluder.skinMask] : [])] : []),
              ]),
              ...layer.parts.map((part) => part.asset),
            ],
      ),
    ),
  ]),
];

/** The object storage key of a story version's asset. */
export const storyAssetKey = (storyId: string, version: number, asset: string) => `stories/${storyId}/v${version}/${asset}`;

/** The cast a story preview uses: each slot filled by its example character. */
export const exampleCast = (manifest: StoryManifest): Record<string, CastMember> =>
  Object.fromEntries(manifest.characterSlots.map((slot) => [slot.slotId, slot.example]));
