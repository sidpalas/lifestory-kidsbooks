import { checkPhoto, drawPage, makeBook, previewLikeness, releaseBook, reviseLikeness } from "./photo-books.ts";
import { renderProof } from "./render-proof.ts";
import { sweepStorage } from "./sweep-storage.ts";

export * from "./photo-books.ts";
export { proofObjectKey, renderProof } from "./render-proof.ts";
export { sweepStorage } from "./sweep-storage.ts";

/** Every task the worker runs. */
export const tasks = [
  renderProof,
  sweepStorage,
  checkPhoto,
  previewLikeness,
  reviseLikeness,
  drawPage,
  makeBook,
  releaseBook,
] as const;
