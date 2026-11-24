import { renderProof } from "./render-proof.ts";
import { sweepStorage } from "./sweep-storage.ts";

export { proofObjectKey, renderProof } from "./render-proof.ts";
export { sweepStorage } from "./sweep-storage.ts";

/** Every task the worker runs. */
export const tasks = [renderProof, sweepStorage] as const;
