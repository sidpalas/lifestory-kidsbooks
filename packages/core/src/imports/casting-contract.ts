import { Schema } from "effect";

import { Rect } from "../book-format/manifest.ts";
import { Age, FaceOption, HairOption } from "../looks/vocabulary.ts";
import { ImportResult } from "./contract.ts";

/** Casting is authoring metadata, never part of the published book format. */
export const CastFigure = Schema.Struct({
  id: Schema.String,
  slotId: Schema.String,
  description: Schema.String.check(Schema.isMaxLength(200)),
  box: Rect,
  head: Rect,
  age: Age,
  face: FaceOption,
  hair: Schema.NullOr(HairOption),
  ignored: Schema.Boolean,
});
export type CastFigure = typeof CastFigure.Type;

export const CastingPage = Schema.Struct({
  pageId: Schema.String,
  asset: Schema.String,
  name: Schema.String,
  figures: Schema.Array(CastFigure).check(Schema.isMaxLength(20)),
  approved: Schema.Boolean,
  applied: Schema.Boolean,
  detectionTaskId: Schema.NullOr(Schema.String),
  extractionTaskId: Schema.NullOr(Schema.String),
  results: Schema.Array(ImportResult),
});
export type CastingPage = typeof CastingPage.Type;
export const Casting = Schema.Array(CastingPage).check(Schema.isMaxLength(100));
export type Casting = typeof Casting.Type;

export const CastingOutcome = Schema.Struct({
  storyId: Schema.String,
  figures: Schema.Array(CastFigure),
  results: Schema.Array(ImportResult),
  error: Schema.NullOr(Schema.String),
  provider: Schema.String,
});
export type CastingOutcome = typeof CastingOutcome.Type;

export const CastingStatus = Schema.Struct({
  state: Schema.Literals(["working", "done", "failed"]),
  outcome: Schema.NullOr(CastingOutcome),
  error: Schema.NullOr(Schema.String),
});
