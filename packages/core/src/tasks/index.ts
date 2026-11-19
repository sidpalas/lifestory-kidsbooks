import { renderProof } from "./render-proof.ts";
import { writeSampleFile } from "./sample-file.ts";
import { sweepStorage } from "./sweep-storage.ts";

export { proofObjectKey, renderProof } from "./render-proof.ts";
export { writeSampleFile } from "./sample-file.ts";
export { sweepStorage } from "./sweep-storage.ts";

/** Every task the worker runs. */
export const tasks = [writeSampleFile, renderProof, sweepStorage] as const;
