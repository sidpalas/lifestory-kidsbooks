import { checkPhoto, drawPage, drawLikenessSheet, makeBook, releaseBook } from "./photo-books.ts";
import { renderProof } from "./render-proof.ts";
import { makeScreenCopies } from "./screen-copies.ts";
import { sweepStorage } from "./sweep-storage.ts";

export * from "./photo-books.ts";
export { proofObjectKey, renderProof } from "./render-proof.ts";
export { makeScreenCopies, spawnScreenCopies, spawnStoryScreenCopies } from "./screen-copies.ts";
export { sweepStorage } from "./sweep-storage.ts";

/** Every task the worker runs. */
export const tasks = [
  renderProof,
  sweepStorage,
  checkPhoto,
  drawLikenessSheet,
  drawPage,
  makeBook,
  releaseBook,
  makeScreenCopies,
] as const;
