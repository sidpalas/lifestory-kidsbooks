// The shared look vocabulary (D26): every axis a family member's look has, with stable option IDs.
// A look is one option per axis. It belongs to the family member, not to a story, so it works in every story:
// each story must supply parts or palettes for every option here, at every age it draws a role (D26, D29), except
// options added after it was published (`addedAt`, D43): those it may lack, and a book asks for a stand-in.
// Browser-safe.
import { Effect, Schema } from "effect";

export interface LookOption {
  readonly id: string;
  readonly label: string;
  /** For colour axes: a representative colour for the picker's swatch (the mid tone of the portrait's palette). */
  readonly swatch?: string;
  /**
   * When the option joined the vocabulary, for options added after the first stories were published (D43). A story
   * version published before then isn't required to draw it.
   */
  readonly addedAt?: string;
}

/** When the hairstyles from buzz cut to bun and the facial hair axis joined the vocabulary (D43). */
const D43 = "2026-11-19T19:30:00Z";

/**
 * Character ages (D29): buckets split where the body changes enough that one drawn base can't cover both, or where
 * the character plays a different part in a story. A look has one; a story role accepts some, and a page can draw a
 * role at a pinned age (a baby who grows into a toddler during the story).
 */
export const ageOptions = [
  { id: "baby", label: "Baby", years: "0–1" },
  { id: "toddler", label: "Toddler", years: "1–3" },
  { id: "young-child", label: "Young child", years: "3–7" },
  { id: "older-child", label: "Older child", years: "8–12" },
  { id: "teen", label: "Teen", years: "13–17" },
  { id: "adult", label: "Adult", years: "18–64" },
  { id: "older-adult", label: "Older adult", years: "65+" },
] as const satisfies ReadonlyArray<LookOption & { readonly years: string }>;

/**
 * Face types (D29): a facial structure the illustrator draws at every age, so a character keeps their face as they
 * grow. A story draws each face type, at every age it draws a role, as a base of its own.
 */
export const faceOptions = [
  { id: "face:round", label: "Round face" },
  { id: "face:oval", label: "Oval face" },
] as const satisfies ReadonlyArray<LookOption>;

/**
 * Features (D40): softer or more defined features, from teen up, so a face type comes in two versions for likeness
 * (Sid, 2026-11-19). Younger bases read as neutral, so children have no choice here. Looks saved before the axis
 * existed decode as `features:defined`, which is what their bases showed; a story's bases and parts without a
 * `features` are the defined ones. A story need not draw softer features: without them it draws the defined base.
 */
export const featuresOptions = [
  { id: "features:soft", label: "Softer features" },
  { id: "features:defined", label: "Defined features" },
] as const satisfies ReadonlyArray<LookOption>;

export const DEFAULT_FEATURES = "features:defined" as const;

/** The ages whose bases come in both features. */
export const featureAges: ReadonlyArray<string> = ["teen", "adult", "older-adult"];

export const skinOptions = [
  { id: "skin:s1", label: "Very light", swatch: "#f6dcc8" },
  { id: "skin:s2", label: "Light", swatch: "#eec6a8" },
  { id: "skin:s3", label: "Medium", swatch: "#d6a07a" },
  { id: "skin:s4", label: "Brown", swatch: "#b07548" },
  { id: "skin:s5", label: "Dark brown", swatch: "#6e4428" },
] as const satisfies ReadonlyArray<LookOption>;

export const hairOptions = [
  { id: "hair:short", label: "Short" },
  { id: "hair:curly", label: "Curly" },
  { id: "hair:long", label: "Long" },
  { id: "hair:buzz", label: "Buzz cut", addedAt: D43 },
  { id: "hair:ponytail", label: "Ponytail", addedAt: D43 },
  { id: "hair:braids", label: "Braids", addedAt: D43 },
  { id: "hair:afro", label: "Afro", addedAt: D43 },
  { id: "hair:locs", label: "Locs", addedAt: D43 },
  { id: "hair:bun", label: "Bun", addedAt: D43 },
] as const satisfies ReadonlyArray<LookOption>;

export const hairColourOptions = [
  { id: "hair-colour:black", label: "Black", swatch: "#342c2e" },
  { id: "hair-colour:brown", label: "Brown", swatch: "#624028" },
  { id: "hair-colour:blonde", label: "Blonde", swatch: "#cea660" },
  { id: "hair-colour:grey", label: "Grey", swatch: "#96969c" },
  { id: "hair-colour:red", label: "Red", swatch: "#8c3a1c" },
] as const satisfies ReadonlyArray<LookOption>;

export const glassesOptions = [
  { id: "glasses:none", label: "No glasses" },
  { id: "glasses:round", label: "Round glasses" },
] as const satisfies ReadonlyArray<LookOption>;

/** Facial hair (D43), drawn as a part from adult up and recoloured with the hair colour. */
export const facialHairOptions = [
  { id: "facial-hair:none", label: "No facial hair" },
  { id: "facial-hair:stubble", label: "Stubble", addedAt: D43 },
  { id: "facial-hair:moustache", label: "Moustache", addedAt: D43 },
  { id: "facial-hair:beard", label: "Full beard", addedAt: D43 },
] as const satisfies ReadonlyArray<LookOption>;

/** Options with no part to draw. */
export const NO_PART_OPTIONS: ReadonlySet<string> = new Set(["glasses:none", "facial-hair:none"]);

/**
 * Options drawn on the head alone (D44): one drawing per face type fits both features' bases, so a part generated for
 * one features is listed again for the other. Styles that reach the shoulders keep a part per base, since the
 * softer bases' shoulders differ (a hard cut and a halo, measured 2026-11-19).
 */
export const HEAD_ONLY_OPTIONS: ReadonlySet<string> = new Set([
  "hair:short",
  "hair:curly",
  "hair:buzz",
  "hair:afro",
  "hair:bun",
  "glasses:round",
  "facial-hair:stubble",
  "facial-hair:moustache",
  "facial-hair:beard",
]);

/** The other features of a face type (D40). */
export const otherFeatures = (features: FeaturesOption | null | undefined): FeaturesOption =>
  (features ?? DEFAULT_FEATURES) === "features:soft" ? "features:defined" : "features:soft";

/** Whether a story version published at `publishedAt` must draw `option`: options added since are optional (D43). */
export const requiredAt = (option: LookOption, publishedAt: Date) => option.addedAt === undefined || new Date(option.addedAt) <= publishedAt;

const ids = <T extends ReadonlyArray<LookOption>>(options: T) => options.map((option) => option.id) as { [K in keyof T]: T[K]["id"] };

export const Age = Schema.Literals(ids(ageOptions));
export type Age = typeof Age.Type;
export const FaceOption = Schema.Literals(ids(faceOptions));
export const FeaturesOption = Schema.Literals(ids(featuresOptions));
export type FeaturesOption = typeof FeaturesOption.Type;
export const SkinOption = Schema.Literals(ids(skinOptions));
export const HairOption = Schema.Literals(ids(hairOptions));
export const HairColourOption = Schema.Literals(ids(hairColourOptions));
export const GlassesOption = Schema.Literals(ids(glassesOptions));
export const FacialHairOption = Schema.Literals(ids(facialHairOptions));

/** A family member's look: one option per axis. */
export const Look = Schema.Struct({
  age: Age,
  face: FaceOption,
  features: FeaturesOption.pipe(Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_FEATURES))),
  skin: SkinOption,
  hair: HairOption,
  hairColour: HairColourOption,
  glasses: GlassesOption,
  /** Looks saved before the axis existed have none (D43). */
  facialHair: FacialHairOption.pipe(Schema.withDecodingDefaultKey(Effect.succeed("facial-hair:none" as const))),
});
export type Look = typeof Look.Type;
export type LookAxis = keyof Look;

/** Axes drawn as parts on top of the base face; their order on a page is the manifest's `partOrder`. */
export const PartAxis = Schema.Literals(["hair", "glasses", "facialHair"]);
export type PartAxis = typeof PartAxis.Type;

/** Axes applied as a recolour of the illustrator's neutral tones. */
export const PaletteAxis = Schema.Literals(["skin", "hairColour"]);
export type PaletteAxis = typeof PaletteAxis.Type;

export const lookVocabulary = {
  age: ageOptions,
  face: faceOptions,
  features: featuresOptions,
  skin: skinOptions,
  hair: hairOptions,
  hairColour: hairColourOptions,
  glasses: glassesOptions,
  facialHair: facialHairOptions,
} as const satisfies Record<LookAxis, ReadonlyArray<LookOption>>;

/**
 * Part axes added after stories were published, bottom to top, with where they go when a stored `partOrder` doesn't
 * list them: facial hair under the hair and glasses (D43).
 */
export const LATER_PART_AXES: ReadonlyArray<PartAxis> = ["facialHair"];
/** `partOrder` with the axes added since it was written placed at the bottom. */
export const fullPartOrder = (order: ReadonlyArray<PartAxis>): ReadonlyArray<PartAxis> => [
  ...LATER_PART_AXES.filter((axis) => !order.includes(axis)),
  ...order,
];

/** Part axes drawn at each age: a baby has no hairstyle part, neither babies nor toddlers wear glasses, and facial hair starts at adult. */
const partAxesByAge: Record<Age, ReadonlyArray<PartAxis>> = {
  baby: [],
  toddler: ["hair"],
  "young-child": ["hair", "glasses"],
  "older-child": ["hair", "glasses"],
  teen: ["hair", "glasses"],
  adult: ["hair", "glasses", "facialHair"],
  "older-adult": ["hair", "glasses", "facialHair"],
};
export const partAxesAt = (age: Age): ReadonlyArray<PartAxis> => partAxesByAge[age];

/** Whether bases at `age` come in both features. */
export const hasFeatures = (age: Age) => featureAges.includes(age);

/** The features a base at `age` draws for `look`: the look's own from teen up, none (one base) below. */
export const featuresAt = (age: Age, look: Pick<Look, "features">): FeaturesOption | undefined => (hasFeatures(age) ? look.features : undefined);

/**
 * Whether a stored base or part (whose `features` defaults to defined) is the one for `age`, `face`, and `features`
 * (from featuresAt). Below teen a drawing has no features, so any matches.
 */
export const sameAppearance = (
  item: { readonly age: Age; readonly face: string; readonly features?: FeaturesOption | undefined },
  age: Age,
  face: string,
  features: FeaturesOption | undefined,
) => item.age === age && item.face === face && (features === undefined || (item.features ?? DEFAULT_FEATURES) === features);

/**
 * The features a figure draws for `look` at `age` from its `bases`: the look's own when the figure has that base,
 * else the defined one (D40: softer features refine likeness, so a story without them falls back rather than
 * leaving the character out). Undefined below teen.
 */
export const drawnFeatures = (
  bases: ReadonlyArray<{ readonly age: Age; readonly face: string; readonly features?: FeaturesOption | undefined }>,
  age: Age,
  face: string,
  look: Pick<Look, "features">,
): FeaturesOption | undefined => {
  const wanted = featuresAt(age, look);
  if (!wanted) return undefined;
  return bases.some((base) => sameAppearance(base, age, face, wanted)) ? wanted : DEFAULT_FEATURES;
};

export const ageLabel = (age: Age) => ageOptions.find((option) => option.id === age)!.label;

/** An option of any axis as a parent reads it: "red hair", "curly hair", "brown skin", "round glasses". */
export const optionLabel = (id: string): string => {
  for (const [axis, options] of Object.entries(lookVocabulary) as Array<[LookAxis, ReadonlyArray<LookOption>]>) {
    const option = options.find((candidate) => candidate.id === id);
    if (!option) continue;
    const label = option.label.toLowerCase();
    return axis === "hair" || axis === "hairColour" ? `${label} hair` : axis === "skin" ? `${label} skin` : label;
  }
  return id;
};

/**
 * Where the picker starts for a new character: one complete look, so the preview is never empty. The parent then
 * changes one axis at a time; there are no whole-look presets, which reset edits made further down (D50).
 */
export const defaultLook: Look = { age: "young-child", features: "features:defined", face: "face:round", skin: "skin:s4", hair: "hair:curly", hairColour: "hair-colour:black", glasses: "glasses:none", facialHair: "facial-hair:none" };
