// Client-safe schemas shared by the web app's server functions and its UI.
// Nothing here may import Node-only modules: the browser bundle imports this file.
import { Schema } from "effect";

export * from "./errors.ts";
export * from "./rpc.ts";

export const StorySummary = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  authorName: Schema.String,
});
export type StorySummary = typeof StorySummary.Type;

export const FamilyMembership = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.String,
});
export type FamilyMembership = typeof FamilyMembership.Type;

export const SampleFileResult = Schema.Struct({
  key: Schema.String,
  contentType: Schema.String,
  bytes: Schema.Number,
});
export type SampleFileResult = typeof SampleFileResult.Type;

export const TaskState = Schema.Literals(["pending", "running", "sleeping", "completed", "failed", "cancelled"]);
export type TaskState = typeof TaskState.Type;
