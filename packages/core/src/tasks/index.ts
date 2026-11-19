import { renderProof } from "./render-proof.ts";
import { writeSampleFile } from "./sample-file.ts";

export { proofObjectKey, renderProof } from "./render-proof.ts";
export { writeSampleFile } from "./sample-file.ts";

/** Every task the worker runs. */
export const tasks = [writeSampleFile, renderProof] as const;
