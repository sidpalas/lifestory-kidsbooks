// The shared look vocabulary (D26): every axis a family member's look has, with stable option IDs.
// A look is one option per axis. It belongs to the family member, not to a story, so it works in every story:
// each story must supply parts or palettes for every option here, at every age it draws a role (D26, D29), except
// options added after it was published (`addedAt`, D43): those it may lack, and a book asks for a stand-in.
// Browser-safe.
import { Effect, Schema, SchemaTransformation } from "effect";

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
  /**
   * The ages that offer the option, for options that fit only some bodies (D51: a baby has no braids, a teen no
   * top knot). Absent: every age that draws its axis. A story draws it, and a look may hold it, only at these ages.
   */
  readonly ages?: ReadonlyArray<string>;
}

/** When the hairstyles from buzz cut to bun and the facial hair axis joined the vocabulary (D43). */
const D43 = "2026-11-19T19:30:00Z";
/** When bald and the young hairstyles joined, and babies gained a hairstyle (D51). */
const D51 = "2026-11-20T12:00:00Z";
/** Ages that draw the hairstyles a full head of hair needs: everyone but a baby (D51). */
const FROM_TODDLER = ["toddler", "young-child", "older-child", "teen", "adult", "older-adult"];

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
 * grow. A story draws each face type, at every age it draws a role, as a base of its own, unless its art draws one
 * face type for everyone (`oneFace`, D55).
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

/**
 * Hairstyles. Babies and toddlers have their own (D51, Sid 2026-11-20): bald at every age (the base is drawn bald, so
 * no part), wispy and soft curls between a bald baby and a full head of hair, and a top knot and puffs for toddlers
 * and young children. The full-head styles start at toddler.
 */
export const hairOptions = [
  { id: "hair:short", label: "Short", ages: FROM_TODDLER },
  { id: "hair:curly", label: "Curly", ages: FROM_TODDLER },
  { id: "hair:long", label: "Long", ages: FROM_TODDLER },
  { id: "hair:buzz", label: "Buzz cut", addedAt: D43, ages: FROM_TODDLER },
  { id: "hair:ponytail", label: "Ponytail", addedAt: D43, ages: FROM_TODDLER },
  { id: "hair:braids", label: "Braids", addedAt: D43, ages: FROM_TODDLER },
  { id: "hair:afro", label: "Afro", addedAt: D43, ages: FROM_TODDLER },
  { id: "hair:locs", label: "Locs", addedAt: D43, ages: FROM_TODDLER },
  { id: "hair:bun", label: "Bun", addedAt: D43, ages: FROM_TODDLER },
  { id: "hair:none", label: "Bald", addedAt: D51 },
  { id: "hair:wispy", label: "Wispy", addedAt: D51, ages: ["baby", "toddler", "young-child"] },
  { id: "hair:soft-curls", label: "Soft curls", addedAt: D51, ages: ["baby", "toddler", "young-child"] },
  { id: "hair:sprout", label: "Top knot", addedAt: D51, ages: ["toddler", "young-child"] },
  { id: "hair:puffs", label: "Puffs", addedAt: D51, ages: ["toddler", "young-child"] },
] as const satisfies ReadonlyArray<LookOption>;

/**
 * Sparse hairstyles show scalp on purpose (wispy hair, soft curls, a top knot's thin sides), so the cut-out's
 * crownGap check, which fails parts that leave scalp showing, doesn't apply to them (D51).
 */
export const SPARSE_HAIR: ReadonlySet<string> = new Set(["hair:wispy", "hair:soft-curls", "hair:sprout"]);

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
  { id: "facial-hair:moustache", label: "Moustache", addedAt: D43 },
  { id: "facial-hair:beard", label: "Full beard", addedAt: D43 },
] as const satisfies ReadonlyArray<LookOption>;

/**
 * Options taken out of the vocabulary (D52), each with the option that replaces it. Looks and overrides saved with
 * one still decode, as the replacement; a published manifest's parts for one stay valid and are never drawn. A
 * retired ID is never reused for another drawing.
 */
export const RETIRED_OPTIONS: ReadonlyMap<string, string> = new Map([
  // 2026-11-20, Sid: "All of the ones I have seen read as patchy"; two rounds of edits didn't fix it.
  ["facial-hair:stubble", "facial-hair:none"],
]);

/** Options with no part to draw. */
export const NO_PART_OPTIONS: ReadonlySet<string> = new Set(["hair:none", "glasses:none", "facial-hair:none"]);

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
  "facial-hair:moustache",
  "facial-hair:beard",
]);

/** The other features of a face type (D40). */
export const otherFeatures = (features: FeaturesOption | null | undefined): FeaturesOption =>
  (features ?? DEFAULT_FEATURES) === "features:soft" ? "features:defined" : "features:soft";

/** Whether a story version published at `publishedAt` must draw `option`: options added since are optional (D43). */
export const requiredAt = (option: LookOption, publishedAt: Date) =>
  option.addedAt === undefined || new Date(option.addedAt) <= publishedAt;

const ids = <T extends ReadonlyArray<LookOption>>(options: T) =>
  options.map((option) => option.id) as { [K in keyof T]: T[K]["id"] };

export const Age = Schema.Literals(ids(ageOptions));
export type Age = typeof Age.Type;
export const FaceOption = Schema.Literals(ids(faceOptions));
export const FeaturesOption = Schema.Literals(ids(featuresOptions));
export type FeaturesOption = typeof FeaturesOption.Type;
export const SkinOption = Schema.Literals(ids(skinOptions));
export const HairOption = Schema.Literals(ids(hairOptions));
export const HairColourOption = Schema.Literals(ids(hairColourOptions));
export const GlassesOption = Schema.Literals(ids(glassesOptions));
/** Facial hair, decoding a retired option as its replacement (D52). */
export const FacialHairOption = Schema.Literals([...ids(facialHairOptions), "facial-hair:stubble"]).pipe(
  Schema.decodeTo(
    Schema.Literals(ids(facialHairOptions)),
    SchemaTransformation.transform({
      decode: (id) => (RETIRED_OPTIONS.get(id) ?? id) as (typeof facialHairOptions)[number]["id"],
      encode: (id) => id,
    }),
  ),
);

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

/** Part axes drawn at each age: neither babies nor toddlers wear glasses, and facial hair starts at adult. */
const partAxesByAge: Record<Age, ReadonlyArray<PartAxis>> = {
  baby: ["hair"],
  toddler: ["hair"],
  "young-child": ["hair", "glasses"],
  "older-child": ["hair", "glasses"],
  teen: ["hair", "glasses"],
  adult: ["hair", "glasses", "facialHair"],
  "older-adult": ["hair", "glasses", "facialHair"],
};
export const partAxesAt = (age: Age): ReadonlyArray<PartAxis> => partAxesByAge[age];

/**
 * Part axes an age gained after stories were published: a baby's hairstyle (D51). A figure with no part on such an
 * axis at that age was published before it and draws as it did, without one (bald); a version published since must
 * draw it (vocabularyGaps), so it always has parts there.
 */
const LATER_AGE_AXES: ReadonlyArray<readonly [Age, PartAxis]> = [["baby", "hair"]];
/** The part axes a figure with `parts` draws at `age`: partAxesAt, less an axis the age gained after the figure was drawn. */
export const figurePartAxes = (
  parts: ReadonlyArray<{ readonly age: Age; readonly axis: PartAxis }>,
  age: Age,
): ReadonlyArray<PartAxis> =>
  partAxesAt(age).filter(
    (axis) =>
      !LATER_AGE_AXES.some(([a, x]) => a === age && x === axis) ||
      parts.some((part) => part.age === age && part.axis === axis),
  );

/** Whether `option` is offered at `age` (D51). */
export const offeredAt = (option: LookOption, age: Age) => option.ages === undefined || option.ages.includes(age);

/** The options of `axis` offered at `age`, in vocabulary order. */
export const optionsAt = <A extends LookAxis>(axis: A, age: Age): (typeof lookVocabulary)[A] =>
  (lookVocabulary[axis] as ReadonlyArray<LookOption>).filter((option) =>
    offeredAt(option, age),
  ) as unknown as (typeof lookVocabulary)[A];

/**
 * The hairstyle a look keeps at `age`: its own where `age` offers it, else the nearest one there, keeping the hair's
 * texture (D51). Used when a look changes age, and when a page pins an age the character doesn't have (D29).
 */
const nearestHair: Record<string, { readonly young: Look["hair"]; readonly older: Look["hair"] }> = {
  "hair:short": { young: "hair:wispy", older: "hair:short" },
  "hair:buzz": { young: "hair:wispy", older: "hair:buzz" },
  "hair:long": { young: "hair:wispy", older: "hair:long" },
  "hair:ponytail": { young: "hair:wispy", older: "hair:ponytail" },
  "hair:braids": { young: "hair:wispy", older: "hair:braids" },
  "hair:bun": { young: "hair:wispy", older: "hair:bun" },
  "hair:curly": { young: "hair:soft-curls", older: "hair:curly" },
  "hair:afro": { young: "hair:soft-curls", older: "hair:afro" },
  "hair:locs": { young: "hair:soft-curls", older: "hair:locs" },
  "hair:wispy": { young: "hair:wispy", older: "hair:short" },
  "hair:soft-curls": { young: "hair:soft-curls", older: "hair:curly" },
  "hair:sprout": { young: "hair:wispy", older: "hair:bun" },
  "hair:puffs": { young: "hair:soft-curls", older: "hair:bun" },
};
export const hairAt = (age: Age, hair: Look["hair"]): Look["hair"] => {
  const option = hairOptions.find((candidate) => candidate.id === hair)!;
  if (offeredAt(option, age)) return hair;
  const nearest = nearestHair[hair]!;
  return offeredAt(
    hairOptions.find((candidate) => candidate.id === nearest.young)!,
    age,
  )
    ? nearest.young
    : nearest.older;
};

/** Whether bases at `age` come in both features. */
export const hasFeatures = (age: Age) => featureAges.includes(age);

/** The features a base at `age` draws for `look`: the look's own from teen up, none (one base) below. */
export const featuresAt = (age: Age, look: Pick<Look, "features">): FeaturesOption | undefined =>
  hasFeatures(age) ? look.features : undefined;

/**
 * Whether a stored base or part (whose `features` defaults to defined) is the one for `age`, `face`, and `features`
 * (from featuresAt). Below teen a drawing has no features, so any matches.
 */
export const sameAppearance = (
  item: { readonly age: Age; readonly face: string; readonly features?: FeaturesOption | undefined },
  age: Age,
  face: string,
  features: FeaturesOption | undefined,
) =>
  item.age === age &&
  item.face === face &&
  (features === undefined || (item.features ?? DEFAULT_FEATURES) === features);

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
export const defaultLook: Look = {
  age: "young-child",
  features: "features:defined",
  face: "face:round",
  skin: "skin:s4",
  hair: "hair:curly",
  hairColour: "hair-colour:black",
  glasses: "glasses:none",
  facialHair: "facial-hair:none",
};
