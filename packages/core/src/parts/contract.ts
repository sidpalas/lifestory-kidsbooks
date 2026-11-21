// What the authoring UI sends and gets back for part generation and review (browser-safe; exported from contracts.ts).
import { Schema } from "effect";

import { type Part, Rect } from "../book-format/manifest.ts";
import { Age, FaceOption, FeaturesOption, PartAxis } from "../looks/vocabulary.ts";

export const PartStatus = Schema.Literals(["generating", "pending_review", "approved", "rejected", "failed"]);
export type PartStatus = typeof PartStatus.Type;

/**
 * Where a figure's parts may appear (D56): a polygon the author draws on the base, [x, y] points in thousandths of
 * the base. It can follow a helmet's opening or leave out an arm in front, which a zone's rectangle can't; every
 * layer of a part is clipped to it.
 */
export const Region = Schema.Array(
  Schema.Tuple([
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  ]),
).check(Schema.isMinLength(3), Schema.isMaxLength(200));
export type Region = typeof Region.Type;

/** The region's bounding box, the zone a part with a region is cut out within. */
export const regionBox = (region: Region): Rect => [
  Math.min(...region.map(([x]) => x)),
  Math.min(...region.map(([, y]) => y)),
  Math.max(...region.map(([x]) => x)),
  Math.max(...region.map(([, y]) => y)),
];

/** Generate one option for one appearance: the figure of `slotId` on `pageId`, drawn from its base for age and face. */
export const PartRequest = Schema.Struct({
  storyVersionId: Schema.String,
  pageId: Schema.String,
  slotId: Schema.String,
  age: Age,
  face: FaceOption,
  /** From teen up, which of the face type's two bases (D40); absent means defined. */
  features: Schema.optionalKey(FeaturesOption),
  axis: PartAxis,
  option: Schema.String,
  /** Where the part may be, in thousandths of the base: the head zone, with room for long hair. */
  zone: Rect,
  /** The figure's drawn region (D56); with one, the zone is its bounding box. */
  region: Schema.optionalKey(Region),
  /** Another seed is another attempt at the same option; the same request with the same seed is the same part. */
  seed: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }))),
  /** The illustrator's guidance for the prompt, such as "two short braids, parted in the middle". */
  note: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
});
export type PartRequest = typeof PartRequest.Type;

export const StoryPart = Schema.Struct({
  id: Schema.String,
  storyVersionId: Schema.String,
  pageId: Schema.String,
  slotId: Schema.String,
  age: Age,
  face: FaceOption,
  /** Null below teen, where bases have no features (D40). */
  features: Schema.NullOr(FeaturesOption),
  axis: PartAxis,
  option: Schema.String,
  seed: Schema.Int,
  zone: Rect,
  region: Schema.NullOr(Region),
  note: Schema.NullOr(Schema.String),
  prompt: Schema.String,
  status: PartStatus,
  /**
   * The RGBA layers cut out, once generated: the part itself and any skin the model drew in it, each a manifest
   * asset path (relative to the story version's folder), its place in the base, the palette that recolours it, and
   * its storage key for `/api/files/<key>`. Approving the part puts one manifest `Part` per layer into its figure.
   */
  layers: Schema.Array(
    Schema.Struct({
      asset: Schema.String,
      at: Rect,
      palette: Schema.Literals(["skin", "hairColour", "none"]),
      key: Schema.String,
    }),
  ),
  /** Storage keys for `/api/files/<key>`: the provider's edit and the review images. */
  files: Schema.Struct({
    edit: Schema.NullOr(Schema.String),
    light: Schema.NullOr(Schema.String),
    dark: Schema.NullOr(Schema.String),
    sheet: Schema.NullOr(Schema.String),
  }),
  metrics: Schema.NullOr(Schema.Unknown),
  provider: Schema.NullOr(Schema.String),
  /** US dollars; null while generating or when the provider doesn't report it. */
  costUsd: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
  reviewedBy: Schema.NullOr(Schema.String),
  reviewedAt: Schema.NullOr(Schema.String),
  reviewReason: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type StoryPart = typeof StoryPart.Type;

export const PartDecision = Schema.Literals(["approve", "reject"]);
export type PartDecision = typeof PartDecision.Type;

/**
 * A generated part as the manifest's `Part` entries for its figure, one per layer, approved once the illustrator
 * approved it. The authoring editor merges them into the draft it shows and publishes (`withGeneratedParts`, D37).
 */
export const manifestParts = (
  part: Pick<StoryPart, "age" | "face" | "axis" | "option" | "status"> & {
    readonly features?: StoryPart["features"] | undefined;
    readonly layers: ReadonlyArray<Pick<StoryPart["layers"][number], "asset" | "at" | "palette">>;
  },
): ReadonlyArray<Part> =>
  part.layers.map((layer) => ({
    age: part.age,
    face: part.face,
    ...(part.features ? { features: part.features } : {}),
    axis: part.axis,
    option: part.option,
    asset: layer.asset,
    at: layer.at,
    palette: layer.palette,
    approved: part.status === "approved",
  }));
