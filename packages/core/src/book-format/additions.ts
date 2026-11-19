// Story additions (D41): what an author adds to a published story version without a new version. A published
// manifest never changes (D24); its additions are an append-only list of approved fragments, each numbered by a
// revision, that only fill gaps: new palettes, new bases, new parts. A book draws its version merged with every
// addition; a proof records the revision it was requested at and always draws exactly that. Browser-safe.
import { Effect, Schema } from "effect";
import { sameAppearance } from "../looks/vocabulary.ts";
import { decodeStoryManifest, FigureBase, type FigureLayer, Palette, Part, type StoryManifest } from "./manifest.ts";

const Id = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/));

/** New bases and parts for the figure of `slotId` on `pageId` (D36's address for an appearance). */
export const FigureAddition = Schema.Struct({
  pageId: Id,
  slotId: Id,
  bases: Schema.optionalKey(Schema.Array(FigureBase)),
  parts: Schema.optionalKey(Schema.Array(Part)),
});
export type FigureAddition = typeof FigureAddition.Type;

export const StoryAddition = Schema.Struct({
  /** Palettes for options the version has none for, tuned to the story's neutral tones like its own. */
  palettes: Schema.optionalKey(
    Schema.Struct({
      skin: Schema.optionalKey(Schema.Record(Schema.String, Palette)),
      hairColour: Schema.optionalKey(Schema.Record(Schema.String, Palette)),
    }),
  ),
  figures: Schema.optionalKey(Schema.Array(FigureAddition)),
});
export type StoryAddition = typeof StoryAddition.Type;

const figuresOf = (manifest: StoryManifest, pageId: string, slotId: string) =>
  (manifest.pages.find((page) => page.pageId === pageId)?.illustration.layers ?? []).filter(
    (layer): layer is FigureLayer => layer.kind === "figure" && layer.slotId === slotId,
  );

/**
 * Why `addition` can't be added to `manifest` (the version with its earlier additions): it would replace something
 * already published, names a figure that isn't there (or isn't one figure), or adds a part nobody approved. The
 * merged manifest must also pass the format's own checks (`mergeAdditions`).
 */
export const additionIssues = (manifest: StoryManifest, addition: StoryAddition): ReadonlyArray<string> => {
  const issues: Array<string> = [];
  for (const axis of ["skin", "hairColour"] as const) {
    for (const option of Object.keys(addition.palettes?.[axis] ?? {})) {
      if (manifest.palettes[axis][option]) issues.push(`palettes.${axis}: "${option}" is already published`);
    }
  }
  const empty = Object.keys(addition.palettes?.skin ?? {}).length + Object.keys(addition.palettes?.hairColour ?? {}).length === 0;
  if (empty && (addition.figures ?? []).every((figure) => (figure.bases?.length ?? 0) + (figure.parts?.length ?? 0) === 0)) {
    issues.push("the addition adds nothing");
  }
  for (const figure of addition.figures ?? []) {
    const at = `${figure.pageId}/${figure.slotId}`;
    const matches = figuresOf(manifest, figure.pageId, figure.slotId);
    if (matches.length !== 1) {
      issues.push(`${at}: ${matches.length === 0 ? "no such figure" : "the page draws this role more than once"}`);
      continue;
    }
    const [layer] = matches as [FigureLayer];
    for (const base of figure.bases ?? []) {
      if (layer.bases.some((existing) => sameAppearance(existing, base.age, base.face, base.features ?? "features:defined"))) {
        issues.push(`${at}: a base for "${base.age}/${base.face}" is already published`);
      }
    }
    for (const part of figure.parts ?? []) {
      const key = `"${part.option}" on "${part.age}/${part.face}"`;
      if (!part.approved) issues.push(`${at}: ${key} is not approved`);
      if (layer.parts.some((existing) => sameAppearance(existing, part.age, part.face, part.features ?? "features:defined") && existing.axis === part.axis && existing.option === part.option)) {
        issues.push(`${at}: a part for ${key} is already published`);
      }
    }
  }
  return issues;
};

/** `manifest` with `addition` merged in, unchecked: palettes gain keys, figures gain bases and parts. */
const merge = (manifest: StoryManifest, addition: StoryAddition): unknown => ({
  ...manifest,
  palettes: {
    skin: { ...manifest.palettes.skin, ...addition.palettes?.skin },
    hairColour: { ...manifest.palettes.hairColour, ...addition.palettes?.hairColour },
  },
  pages: manifest.pages.map((page) => ({
    ...page,
    illustration: {
      layers: page.illustration.layers.map((layer) => {
        if (layer.kind !== "figure") return layer;
        const added = (addition.figures ?? []).filter((figure) => figure.pageId === page.pageId && figure.slotId === layer.slotId);
        if (added.length === 0) return layer;
        return {
          ...layer,
          bases: [...layer.bases, ...added.flatMap((figure) => figure.bases ?? [])],
          parts: [...layer.parts, ...added.flatMap((figure) => figure.parts ?? [])],
        };
      }),
    },
  })),
});

/**
 * The version as books draw it: `manifest` with `additions` merged in order. Fails with every problem when an
 * addition replaces something or the result isn't a valid manifest; stored additions passed this when published.
 */
export const mergeAdditions = (manifest: StoryManifest, additions: ReadonlyArray<StoryAddition>) =>
  Effect.gen(function* () {
    let merged = manifest;
    for (const [index, addition] of additions.entries()) {
      const issues = additionIssues(merged, addition);
      if (issues.length > 0) return yield* Effect.fail(new Error(`addition ${index + 1}:\n${issues.join("\n")}`));
      merged = yield* decodeStoryManifest(merge(merged, addition)).pipe(
        Effect.mapError((error) => new Error(`addition ${index + 1}: ${error.message}`)),
      );
    }
    return merged;
  });

/** Every asset an addition references: what publishing it must store under the version's folder. */
export const additionAssets = (addition: StoryAddition): ReadonlyArray<string> => [
  ...new Set(
    (addition.figures ?? []).flatMap((figure) => [
      ...(figure.bases ?? []).flatMap((base) => [
        base.asset,
        base.skinMask,
        ...(base.browMask ? [base.browMask] : []),
        ...(base.overlay ? [base.overlay] : []),
        ...(base.occluder ? [base.occluder.asset, ...(base.occluder.skinMask ? [base.occluder.skinMask] : [])] : []),
      ]),
      ...(figure.parts ?? []).map((part) => part.asset),
    ]),
  ),
];
