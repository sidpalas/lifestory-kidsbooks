// The shared look vocabulary (D26): every axis a family member's look has, with stable option IDs.
// A look is one option per axis. It belongs to the family member, not to a story, so it works in every story:
// each story must supply parts or palettes for every option here, at every age it draws a role (D26, D29).
// Browser-safe.
import { Schema } from "effect";

export interface LookOption {
  readonly id: string;
  readonly label: string;
  /** For colour axes: a representative colour for the picker's swatch (the mid tone of the portrait's palette). */
  readonly swatch?: string;
}

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
] as const satisfies ReadonlyArray<LookOption>;

export const hairColourOptions = [
  { id: "hair-colour:black", label: "Black", swatch: "#342c2e" },
  { id: "hair-colour:brown", label: "Brown", swatch: "#624028" },
  { id: "hair-colour:blonde", label: "Blonde", swatch: "#cea660" },
  { id: "hair-colour:grey", label: "Grey", swatch: "#96969c" },
] as const satisfies ReadonlyArray<LookOption>;

export const glassesOptions = [
  { id: "glasses:none", label: "No glasses" },
  { id: "glasses:round", label: "Round glasses" },
] as const satisfies ReadonlyArray<LookOption>;

/** Options with no part to draw. */
export const NO_PART_OPTIONS: ReadonlySet<string> = new Set(["glasses:none"]);

const ids = <T extends ReadonlyArray<LookOption>>(options: T) => options.map((option) => option.id) as { [K in keyof T]: T[K]["id"] };

export const Age = Schema.Literals(ids(ageOptions));
export type Age = typeof Age.Type;
export const FaceOption = Schema.Literals(ids(faceOptions));
export const SkinOption = Schema.Literals(ids(skinOptions));
export const HairOption = Schema.Literals(ids(hairOptions));
export const HairColourOption = Schema.Literals(ids(hairColourOptions));
export const GlassesOption = Schema.Literals(ids(glassesOptions));

/** A family member's look: one option per axis. */
export const Look = Schema.Struct({
  age: Age,
  face: FaceOption,
  skin: SkinOption,
  hair: HairOption,
  hairColour: HairColourOption,
  glasses: GlassesOption,
});
export type Look = typeof Look.Type;
export type LookAxis = keyof Look;

/** Axes drawn as parts on top of the base face; their order on a page is the manifest's `partOrder`. */
export const PartAxis = Schema.Literals(["hair", "glasses"]);
export type PartAxis = typeof PartAxis.Type;

/** Axes applied as a recolour of the illustrator's neutral tones. */
export const PaletteAxis = Schema.Literals(["skin", "hairColour"]);
export type PaletteAxis = typeof PaletteAxis.Type;

export const lookVocabulary = {
  age: ageOptions,
  face: faceOptions,
  skin: skinOptions,
  hair: hairOptions,
  hairColour: hairColourOptions,
  glasses: glassesOptions,
} as const satisfies Record<LookAxis, ReadonlyArray<LookOption>>;

/** Part axes drawn at each age: a baby has no hairstyle part, and neither babies nor toddlers wear glasses. */
const partAxesByAge: Record<Age, ReadonlyArray<PartAxis>> = {
  baby: [],
  toddler: ["hair"],
  "young-child": ["hair", "glasses"],
  "older-child": ["hair", "glasses"],
  teen: ["hair", "glasses"],
  adult: ["hair", "glasses"],
  "older-adult": ["hair", "glasses"],
};
export const partAxesAt = (age: Age): ReadonlyArray<PartAxis> => partAxesByAge[age];

export const ageLabel = (age: Age) => ageOptions.find((option) => option.id === age)!.label;

/** Where the picker starts: a few complete looks per age, refined one axis at a time. */
export const curatedLooks: ReadonlyArray<{ readonly id: string; readonly label: string; readonly look: Look }> = [
  { id: "baby-a", label: "Brown skin, black hair", look: { age: "baby", face: "face:round", skin: "skin:s4", hair: "hair:short", hairColour: "hair-colour:black", glasses: "glasses:none" } },
  { id: "baby-b", label: "Light skin, blonde hair", look: { age: "baby", face: "face:oval", skin: "skin:s1", hair: "hair:short", hairColour: "hair-colour:blonde", glasses: "glasses:none" } },
  { id: "toddler-a", label: "Curly brown hair", look: { age: "toddler", face: "face:round", skin: "skin:s3", hair: "hair:curly", hairColour: "hair-colour:brown", glasses: "glasses:none" } },
  { id: "toddler-b", label: "Short black hair", look: { age: "toddler", face: "face:oval", skin: "skin:s5", hair: "hair:short", hairColour: "hair-colour:black", glasses: "glasses:none" } },
  { id: "young-child-a", label: "Curly black hair", look: { age: "young-child", face: "face:round", skin: "skin:s4", hair: "hair:curly", hairColour: "hair-colour:black", glasses: "glasses:none" } },
  { id: "young-child-b", label: "Long blonde hair", look: { age: "young-child", face: "face:oval", skin: "skin:s1", hair: "hair:long", hairColour: "hair-colour:blonde", glasses: "glasses:none" } },
  { id: "young-child-c", label: "Short brown hair, glasses", look: { age: "young-child", face: "face:round", skin: "skin:s3", hair: "hair:short", hairColour: "hair-colour:brown", glasses: "glasses:round" } },
  { id: "older-child-a", label: "Long black hair", look: { age: "older-child", face: "face:oval", skin: "skin:s2", hair: "hair:long", hairColour: "hair-colour:black", glasses: "glasses:none" } },
  { id: "older-child-b", label: "Short brown hair, glasses", look: { age: "older-child", face: "face:round", skin: "skin:s5", hair: "hair:short", hairColour: "hair-colour:brown", glasses: "glasses:round" } },
  { id: "teen-a", label: "Curly black hair", look: { age: "teen", face: "face:oval", skin: "skin:s4", hair: "hair:curly", hairColour: "hair-colour:black", glasses: "glasses:none" } },
  { id: "teen-b", label: "Long brown hair, glasses", look: { age: "teen", face: "face:round", skin: "skin:s2", hair: "hair:long", hairColour: "hair-colour:brown", glasses: "glasses:round" } },
  { id: "adult-a", label: "Long brown hair", look: { age: "adult", face: "face:oval", skin: "skin:s3", hair: "hair:long", hairColour: "hair-colour:brown", glasses: "glasses:none" } },
  { id: "adult-b", label: "Curly black hair", look: { age: "adult", face: "face:round", skin: "skin:s5", hair: "hair:curly", hairColour: "hair-colour:black", glasses: "glasses:none" } },
  { id: "adult-c", label: "Short blonde hair, glasses", look: { age: "adult", face: "face:oval", skin: "skin:s1", hair: "hair:short", hairColour: "hair-colour:blonde", glasses: "glasses:round" } },
  { id: "older-adult-a", label: "Short grey hair, glasses", look: { age: "older-adult", face: "face:round", skin: "skin:s2", hair: "hair:short", hairColour: "hair-colour:grey", glasses: "glasses:round" } },
  { id: "older-adult-b", label: "Long grey hair", look: { age: "older-adult", face: "face:oval", skin: "skin:s4", hair: "hair:long", hairColour: "hair-colour:grey", glasses: "glasses:none" } },
];
