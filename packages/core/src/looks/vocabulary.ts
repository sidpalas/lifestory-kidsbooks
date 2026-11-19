// The shared look vocabulary (D26): every axis a family member's look has, with stable option IDs.
// A look is one option per axis. It belongs to the family member, not to a story, so it works in every story:
// each story must supply parts or palettes for every option here, except base faces of another age than the
// role's. Browser-safe.
import { Schema } from "effect";

export const Age = Schema.Literals(["child", "adult"]);
export type Age = typeof Age.Type;

export interface LookOption {
  readonly id: string;
  readonly label: string;
}

/** Base faces: an illustrator-drawn figure per face, so the face is the only axis tied to age. */
export const faceOptions = [
  { id: "face:child-1", label: "Round face", age: "child" },
  { id: "face:child-2", label: "Oval face", age: "child" },
  { id: "face:adult-1", label: "Square face", age: "adult" },
  { id: "face:adult-2", label: "Round face", age: "adult" },
] as const satisfies ReadonlyArray<LookOption & { readonly age: Age }>;

export const skinOptions = [
  { id: "skin:s1", label: "Very light" },
  { id: "skin:s2", label: "Light" },
  { id: "skin:s3", label: "Medium" },
  { id: "skin:s4", label: "Brown" },
  { id: "skin:s5", label: "Dark brown" },
] as const satisfies ReadonlyArray<LookOption>;

export const hairOptions = [
  { id: "hair:short", label: "Short" },
  { id: "hair:curly", label: "Curly" },
  { id: "hair:long", label: "Long" },
] as const satisfies ReadonlyArray<LookOption>;

export const hairColourOptions = [
  { id: "hair-colour:black", label: "Black" },
  { id: "hair-colour:brown", label: "Brown" },
  { id: "hair-colour:blonde", label: "Blonde" },
  { id: "hair-colour:grey", label: "Grey" },
] as const satisfies ReadonlyArray<LookOption>;

export const glassesOptions = [
  { id: "glasses:none", label: "No glasses" },
  { id: "glasses:round", label: "Round glasses" },
] as const satisfies ReadonlyArray<LookOption>;

/** Options with no part to draw. */
export const NO_PART_OPTIONS: ReadonlySet<string> = new Set(["glasses:none"]);

const ids = <T extends ReadonlyArray<LookOption>>(options: T) => options.map((option) => option.id) as { [K in keyof T]: T[K]["id"] };

export const FaceOption = Schema.Literals(ids(faceOptions));
export const SkinOption = Schema.Literals(ids(skinOptions));
export const HairOption = Schema.Literals(ids(hairOptions));
export const HairColourOption = Schema.Literals(ids(hairColourOptions));
export const GlassesOption = Schema.Literals(ids(glassesOptions));

/** A family member's look: one option per axis. */
export const Look = Schema.Struct({
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
  face: faceOptions,
  skin: skinOptions,
  hair: hairOptions,
  hairColour: hairColourOptions,
  glasses: glassesOptions,
} as const satisfies Record<LookAxis, ReadonlyArray<LookOption>>;

export const ageOfFace = (face: Look["face"]): Age => faceOptions.find((option) => option.id === face)!.age;

/** The base faces a role of `age` must supply. */
export const facesForAge = (age: Age): ReadonlyArray<Look["face"]> =>
  faceOptions.filter((option) => option.age === age).map((option) => option.id);

/** Where the picker starts: a few complete looks per age, refined one axis at a time. */
export const curatedLooks: ReadonlyArray<{ readonly id: string; readonly label: string; readonly look: Look }> = [
  { id: "child-a", label: "Curly black hair", look: { face: "face:child-1", skin: "skin:s4", hair: "hair:curly", hairColour: "hair-colour:black", glasses: "glasses:none" } },
  { id: "child-b", label: "Long blonde hair", look: { face: "face:child-2", skin: "skin:s1", hair: "hair:long", hairColour: "hair-colour:blonde", glasses: "glasses:none" } },
  { id: "child-c", label: "Short brown hair, glasses", look: { face: "face:child-1", skin: "skin:s3", hair: "hair:short", hairColour: "hair-colour:brown", glasses: "glasses:round" } },
  { id: "child-d", label: "Short black hair", look: { face: "face:child-2", skin: "skin:s5", hair: "hair:short", hairColour: "hair-colour:black", glasses: "glasses:none" } },
  { id: "adult-a", label: "Short grey hair, glasses", look: { face: "face:adult-2", skin: "skin:s2", hair: "hair:short", hairColour: "hair-colour:grey", glasses: "glasses:round" } },
  { id: "adult-b", label: "Long brown hair", look: { face: "face:adult-1", skin: "skin:s3", hair: "hair:long", hairColour: "hair-colour:brown", glasses: "glasses:none" } },
  { id: "adult-c", label: "Curly black hair", look: { face: "face:adult-2", skin: "skin:s5", hair: "hair:curly", hairColour: "hair-colour:black", glasses: "glasses:none" } },
  { id: "adult-d", label: "Short blonde hair", look: { face: "face:adult-1", skin: "skin:s1", hair: "hair:short", hairColour: "hair-colour:blonde", glasses: "glasses:round" } },
];
